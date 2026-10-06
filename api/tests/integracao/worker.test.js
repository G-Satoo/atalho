// ============================================================
// Testes do worker de cliques
//
// Prova o caminho inteiro, com as peças de verdade:
//   redirecionamento -> fila (Redis) -> worker -> Postgres
//
// É o teste que mais paga o custo de ter containers: nenhum dos
// problemas aqui (job que some, lote que não fecha, User-Agent
// que não vira coluna) aparece em teste com mock.
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";
import { filaCliques } from "../../src/servicos/fila.js";

// Importar o worker já o coloca para rodar — é o que o
// `npm run worker` faz. O encerrar() é exportado para o teste
// poder desligá-lo no fim sem deixar conexão pendurada.
import { encerrar } from "../../src/worker.js";

const UA_CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let servidor;
let cliente;

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
});

after(async () => {
  servidor.close();
  await encerrar();
  await encerrarConexoes();
});

/**
 * Espera as linhas aparecerem na tabela.
 *
 * O worker fecha o lote por tempo (2s) ou por tamanho (100), e
 * quem chama não sabe qual dos dois vai acontecer primeiro. Ficar
 * perguntando ao banco é mais honesto — e mais rápido — do que
 * chutar um setTimeout grande o bastante.
 */
async function esperarCliques(quantidade, limiteMs = 8000) {
  const fim = Date.now() + limiteMs;

  while (Date.now() < fim) {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM cliques");
    if (rows[0].total >= quantidade) return rows[0].total;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }

  const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM cliques");
  throw new Error(
    `Esperava ${quantidade} clique(s) gravado(s), o banco tem ${rows[0].total}`
  );
}

describe("worker de cliques", () => {
  it("grava no banco o clique que passou pela fila", async () => {
    const { dados } = await cliente.post("/api/links", {
      destino: "https://exemplo.com/destino"
    });

    await cliente.get(`/${dados.link.codigo}`);

    await esperarCliques(1);

    const { rows } = await pool.query("SELECT * FROM cliques");
    assert.equal(rows[0].link_id, dados.link.id);
  });

  it("transforma o User-Agent em colunas", async () => {
    const { dados } = await cliente.post("/api/links", { destino: "https://exemplo.com" });

    // Chamada direta com cabeçalhos escolhidos — o cliente de
    // teste manda sempre os mesmos.
    const porta = servidor.address().port;
    await fetch(`http://127.0.0.1:${porta}/${dados.link.codigo}`, {
      redirect: "manual",
      headers: {
        "User-Agent": UA_CHROME_WINDOWS,
        Referer: "https://www.google.com/search?q=alguma+coisa+privada"
      }
    });

    await esperarCliques(1);

    const { rows } = await pool.query("SELECT * FROM cliques");

    assert.equal(rows[0].dispositivo, "computador");
    assert.equal(rows[0].navegador, "Chrome");
    assert.equal(rows[0].sistema, "Windows");

    // Só o host do Referer — a busca da pessoa não é guardada.
    assert.equal(rows[0].origem, "www.google.com");
  });

  it("grava vários cliques que chegam juntos num lote só", async () => {
    const { dados } = await cliente.post("/api/links", { destino: "https://exemplo.com" });
    const porta = servidor.address().port;

    // 30 acessos ao mesmo tempo, como um link que viralizou.
    await Promise.all(
      Array.from({ length: 30 }, () =>
        fetch(`http://127.0.0.1:${porta}/${dados.link.codigo}`, { redirect: "manual" })
      )
    );

    const total = await esperarCliques(30);

    // Nenhum perdido, nenhum duplicado.
    assert.equal(total, 30);
  });

  it("guarda o horário que veio no evento, não o da gravação", async () => {
    const { dados } = await cliente.post("/api/links", { destino: "https://exemplo.com" });

    // Enfileira direto, com um horário de ontem. É o que
    // aconteceria se a fila tivesse ficado parada.
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await filaCliques.add("clique", {
      linkId: dados.link.id,
      ocorridoEm: ontem.toISOString(),
      userAgent: null,
      referer: null
    });

    await esperarCliques(1);

    const { rows } = await pool.query("SELECT ocorrido_em FROM cliques");
    const gravado = new Date(rows[0].ocorrido_em).getTime();

    // Um segundo de tolerância para o arredondamento do banco.
    assert.ok(
      Math.abs(gravado - ontem.getTime()) < 1000,
      `esperava ${ontem.toISOString()}, veio ${rows[0].ocorrido_em}`
    );
  });

  it("aceita clique sem User-Agent nem Referer", async () => {
    // Bots, scripts e clientes antigos. O clique conta do mesmo
    // jeito, com as colunas nulas — o NOT NULL está só no link_id
    // e no horário, de propósito.
    const { dados } = await cliente.post("/api/links", { destino: "https://exemplo.com" });

    await filaCliques.add("clique", {
      linkId: dados.link.id,
      ocorridoEm: new Date().toISOString(),
      userAgent: null,
      referer: null
    });

    await esperarCliques(1);

    const { rows } = await pool.query("SELECT * FROM cliques");
    assert.equal(rows[0].dispositivo, null);
    assert.equal(rows[0].origem, null);
  });
});
