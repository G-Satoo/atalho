// ============================================================
// Testes do redirecionamento, do cache e da fila
//
// É o caminho mais importante do sistema — e o que tem mais
// partes móveis: Redis na frente, Postgres atrás, fila do lado.
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";
import { redis } from "../../src/redis.js";
import { filaCliques } from "../../src/servicos/fila.js";

let servidor;
let cliente;

before(async () => {
  await prepararBanco();
  ({ servidor, cliente } = await subirServidor());
});

beforeEach(async () => {
  await limpar();
  await filaCliques.drain(); // tira o que sobrou de outro teste
  await cliente.post("/api/usuarios", {
    email: "dono@exemplo.com",
    senha: "uma-senha-boa"
  });
});

after(async () => {
  servidor.close();
  await encerrarConexoes();
});

async function criarLink(dados) {
  const resposta = await cliente.post("/api/links", dados);
  return resposta.dados.link;
}

describe("GET /:codigo", () => {
  it("redireciona para o destino com 302", async () => {
    const link = await criarLink({ destino: "https://exemplo.com/destino" });

    const resposta = await cliente.get(`/${link.codigo}`);

    assert.equal(resposta.status, 302);
    assert.equal(resposta.cabecalhos.get("location"), "https://exemplo.com/destino");
  });

  it("usa 302 e não 301", async () => {
    // Com 301 o navegador guarda para sempre: a pessoa nunca mais
    // passaria por aqui, a estatística pararia de contar e editar o
    // destino deixaria de ter efeito para quem já clicou.
    const link = await criarLink({ destino: "https://exemplo.com" });

    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.status, 302);
  });

  it("responde 404 para código que não existe", async () => {
    const resposta = await cliente.get("/nao-existe-mesmo");
    assert.equal(resposta.status, 404);
  });

  it("não engole /health nem /api", async () => {
    // A rota do redirecionamento casa com qualquer caminho de um
    // nível. É a ordem de registro no server.js que a segura.
    const saude = await cliente.get("/health");
    assert.equal(saude.status, 200);

    const links = await cliente.get("/api/links");
    assert.equal(links.status, 200);
  });

  it("recusa link desativado", async () => {
    const link = await criarLink({ destino: "https://exemplo.com" });
    await cliente.patch(`/api/links/${link.id}`, { ativo: false });

    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.status, 404);
  });

  it("recusa link vencido", async () => {
    const link = await criarLink({
      destino: "https://exemplo.com",
      expira_em: new Date(Date.now() - 1000).toISOString()
    });

    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.status, 404);
  });
});

describe("cache", () => {
  it("guarda o destino no Redis no primeiro acesso", async () => {
    const link = await criarLink({ destino: "https://exemplo.com/cacheado" });

    assert.equal(await redis.get(`link:${link.codigo}`), null);

    await cliente.get(`/${link.codigo}`);

    const guardado = await redis.get(`link:${link.codigo}`);
    assert.ok(guardado?.includes("https://exemplo.com/cacheado"));
  });

  it("redireciona sem tocar no banco quando está em cache", async () => {
    const link = await criarLink({ destino: "https://exemplo.com" });

    await cliente.get(`/${link.codigo}`); // esquenta o cache

    // Apaga o link do banco por baixo e mantém o cache. Se o
    // segundo acesso ainda redirecionar, é prova de que a consulta
    // não aconteceu — é justamente esse o ganho do cache.
    await pool.query("DELETE FROM links WHERE id = $1", [link.id]);

    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.status, 302);
  });

  it("guarda também o código inexistente, com prazo curto", async () => {
    // Cache negativo: sem ele, varrer códigos aleatórios faz cada
    // requisição bater no Postgres.
    await cliente.get("/codigo-que-nao-existe");

    const guardado = await redis.get("link:codigo-que-nao-existe");
    assert.equal(guardado, "0");

    const prazo = await redis.ttl("link:codigo-que-nao-existe");
    assert.ok(prazo > 0 && prazo <= 60, `prazo era ${prazo}`);
  });

  it("limpa o cache quando o destino muda", async () => {
    const link = await criarLink({ destino: "https://antigo.com" });

    await cliente.get(`/${link.codigo}`); // esquenta com o destino antigo

    await cliente.patch(`/api/links/${link.id}`, { destino: "https://novo.com" });

    // Sem a invalidação, o Redis mandaria gente para o site antigo
    // por até uma hora depois da edição.
    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.cabecalhos.get("location"), "https://novo.com");
  });

  it("limpa o cache quando o link é apagado", async () => {
    const link = await criarLink({ destino: "https://exemplo.com" });

    await cliente.get(`/${link.codigo}`);
    await cliente.delete(`/api/links/${link.id}`);

    const resposta = await cliente.get(`/${link.codigo}`);
    assert.equal(resposta.status, 404);
  });
});

describe("fila de cliques", () => {
  it("enfileira o clique em vez de gravar na hora", async () => {
    const link = await criarLink({ destino: "https://exemplo.com" });

    await cliente.get(`/${link.codigo}`);

    // A resposta já foi enviada quando o evento é enfileirado —
    // pequena espera para o trabalho de fundo acontecer.
    await esperarFila(1);

    // Nada no banco: quem grava é o worker, que não está rodando
    // nestes testes.
    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM cliques");
    assert.equal(rows[0].total, 0);

    const jobs = await filaCliques.getJobs(["waiting", "delayed", "active"]);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].data.linkId, link.id);
  });

  it("carimba o horário do clique, não o da gravação", async () => {
    const link = await criarLink({ destino: "https://exemplo.com" });
    const antes = Date.now();

    await cliente.get(`/${link.codigo}`);
    await esperarFila(1);

    const [job] = await filaCliques.getJobs(["waiting", "delayed", "active"]);
    const carimbo = new Date(job.data.ocorridoEm).getTime();

    // Se a fila atrasar, o gráfico ainda mostra a hora certa.
    assert.ok(carimbo >= antes && carimbo <= Date.now());
  });

  it("não enfileira nada quando o código não existe", async () => {
    await cliente.get("/nao-existe");
    await esperarFila(0);

    const jobs = await filaCliques.getJobs(["waiting", "delayed", "active"]);
    assert.equal(jobs.length, 0);
  });
});

/**
 * Espera a fila ter a quantidade esperada de jobs.
 *
 * Melhor do que um setTimeout fixo: aqui o teste termina assim
 * que o evento chega, e falha por tempo só quando de fato não
 * chegou — em vez de passar por sorte numa máquina rápida e
 * falhar no CI.
 */
async function esperarFila(quantidade, limiteMs = 2000) {
  // Esperar "zero job" é o caso invertido: não dá para detectar a
  // ausência de algo que ainda não chegou. Aqui só uma espera fixa
  // resolve — curta, e o suficiente para o trabalho de fundo do
  // redirecionamento ter acontecido se fosse para acontecer.
  if (quantidade === 0) {
    await new Promise((resolver) => setTimeout(resolver, 300));
    return;
  }

  const fim = Date.now() + limiteMs;

  while (Date.now() < fim) {
    const jobs = await filaCliques.getJobs(["waiting", "delayed", "active"]);
    if (jobs.length >= quantidade) return;
    await new Promise((resolver) => setTimeout(resolver, 25));
  }

  throw new Error(`A fila não recebeu ${quantidade} job(s) em ${limiteMs}ms`);
}
