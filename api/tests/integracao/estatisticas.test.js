// ============================================================
// Testes das estatísticas
//
// Os cliques são inseridos direto no banco aqui: o assunto é a
// consulta que monta o painel, não o caminho da fila (esse tem
// arquivo próprio, worker.test.js).
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";

let servidor;
let cliente;
let linkId;

before(async () => {
  await prepararBanco();
  ({ servidor, cliente } = await subirServidor());
});

beforeEach(async () => {
  await limpar();

  await cliente.post("/api/usuarios", {
    email: "dono@exemplo.com",
    senha: "uma-senha-boa"
  });

  const { dados } = await cliente.post("/api/links", { destino: "https://exemplo.com" });
  linkId = dados.link.id;
});

after(async () => {
  servidor.close();
  await encerrarConexoes();
});

/** Insere um clique com dias de idade. */
async function inserirClique({ diasAtras = 0, dispositivo = null, origem = null } = {}) {
  await pool.query(
    `INSERT INTO cliques (link_id, ocorrido_em, dispositivo, origem)
     VALUES ($1, now() - make_interval(days => $2::int), $3, $4)`,
    [linkId, diasAtras, dispositivo, origem]
  );
}

describe("GET /api/links/:id/estatisticas", () => {
  it("conta o total e o total do período", async () => {
    await inserirClique({ diasAtras: 0 });
    await inserirClique({ diasAtras: 3 });
    await inserirClique({ diasAtras: 100 }); // fora dos 30 dias

    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas?dias=30`);

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.totais.cliques, 3);
    assert.equal(resposta.dados.totais.cliques_periodo, 2);
  });

  it("devolve um ponto por dia, inclusive os dias sem clique", async () => {
    // É o que impede o gráfico de "pular" os dias vazios e
    // desenhar uma linha reta onde houve uma queda de verdade.
    await inserirClique({ diasAtras: 0 });

    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas?dias=7`);

    assert.equal(resposta.dados.por_dia.length, 8); // hoje + 7 dias
    assert.equal(resposta.dados.por_dia.filter((d) => d.cliques === 0).length, 7);
  });

  it("agrupa por dispositivo", async () => {
    await inserirClique({ dispositivo: "celular" });
    await inserirClique({ dispositivo: "celular" });
    await inserirClique({ dispositivo: "computador" });

    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas`);
    const porDispositivo = resposta.dados.por_dispositivo;

    // Ordenado do maior para o menor.
    assert.equal(porDispositivo[0].dispositivo, "celular");
    assert.equal(porDispositivo[0].cliques, 2);
  });

  it("chama de 'direto' o clique sem origem", async () => {
    // Link colado no WhatsApp, digitado ou aberto de um PDF.
    // Costuma ser a maior fatia, e não é um erro.
    await inserirClique({ origem: null });
    await inserirClique({ origem: "www.google.com" });

    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas`);
    const origens = resposta.dados.por_origem.map((o) => o.origem);

    assert.ok(origens.includes("direto"));
    assert.ok(origens.includes("www.google.com"));
  });

  it("não deixa ver a estatística de link de outra pessoa", async () => {
    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      email: "curioso@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas`);
    assert.equal(resposta.status, 404);
  });

  it("prende o parâmetro dias em 365", async () => {
    // Sem teto, ?dias=99999999 faria o generate_series gerar
    // milhões de linhas e travar o banco.
    const resposta = await cliente.get(`/api/links/${linkId}/estatisticas?dias=99999999`);

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.dias, 365);
  });
});
