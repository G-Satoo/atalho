// ============================================================
// Testes das rotas de links
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { pool } from "../../db/pool.js";

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
  await encerrarConexoes();
});

describe("POST /api/links", () => {
  it("encurta um link e devolve a URL pronta", async () => {
    const resposta = await cliente.post("/api/links", {
      destino: "https://exemplo.com/um/caminho/bem/comprido",
      titulo: "Artigo"
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.link.destino, "https://exemplo.com/um/caminho/bem/comprido");

    // O front não deveria precisar montar a URL curta na mão.
    assert.equal(
      resposta.dados.link.url_curta,
      `http://localhost:3002/${resposta.dados.link.codigo}`
    );
  });

  it("aceita código personalizado", async () => {
    const resposta = await cliente.post("/api/links", {
      destino: "https://exemplo.com",
      codigo: "promo-2026"
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.link.codigo, "promo-2026");
  });

  it("recusa código já usado com 409", async () => {
    await cliente.post("/api/links", { destino: "https://a.com", codigo: "repetido" });

    const segunda = await cliente.post("/api/links", {
      destino: "https://b.com",
      codigo: "repetido"
    });

    assert.equal(segunda.status, 409);
  });

  it("recusa destino javascript: com 400", async () => {
    // Sem esta barreira o encurtador vira ferramenta de ataque —
    // e o domínio acaba na lista de bloqueio dos navegadores.
    const resposta = await cliente.post("/api/links", {
      destino: "javascript:alert(document.cookie)"
    });

    assert.equal(resposta.status, 400);
  });

  it("gera códigos diferentes para links diferentes", async () => {
    const codigos = new Set();

    for (let i = 0; i < 10; i++) {
      const resposta = await cliente.post("/api/links", {
        destino: `https://exemplo.com/${i}`
      });
      codigos.add(resposta.dados.link.codigo);
    }

    assert.equal(codigos.size, 10);
  });
});

describe("GET /api/links", () => {
  it("lista do mais novo para o mais velho", async () => {
    for (const nome of ["primeiro", "segundo", "terceiro"]) {
      await cliente.post("/api/links", { destino: `https://exemplo.com/${nome}` });
    }

    const resposta = await cliente.get("/api/links");

    assert.equal(resposta.dados.total, 3);
    assert.match(resposta.dados.links[0].destino, /terceiro/);
  });

  it("mostra o total de cliques de cada link", async () => {
    const criado = await cliente.post("/api/links", { destino: "https://exemplo.com" });
    const linkId = criado.dados.link.id;

    // Insere direto no banco: este teste é sobre a CONSULTA, não
    // sobre a fila. O caminho fila -> worker tem teste próprio.
    await pool.query(
      `INSERT INTO cliques (link_id, ocorrido_em) VALUES ($1, now()), ($1, now())`,
      [linkId]
    );

    const resposta = await cliente.get("/api/links");
    assert.equal(resposta.dados.links[0].cliques, 2);
  });

  it("não mostra links de outro usuário", async () => {
    await cliente.post("/api/links", { destino: "https://secreto.com" });

    // Entra como outra pessoa no mesmo servidor.
    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      email: "outro@exemplo.com",
      senha: "uma-senha-boa"
    });

    const resposta = await cliente.get("/api/links");
    assert.equal(resposta.dados.total, 0);
  });
});

describe("PATCH /api/links/:id", () => {
  it("troca o destino", async () => {
    const criado = await cliente.post("/api/links", { destino: "https://antigo.com" });

    const resposta = await cliente.patch(`/api/links/${criado.dados.link.id}`, {
      destino: "https://novo.com"
    });

    assert.equal(resposta.status, 200);
    assert.equal(resposta.dados.link.destino, "https://novo.com");

    // O código não muda — é o que permite trocar o destino de um
    // link já impresso num panfleto.
    assert.equal(resposta.dados.link.codigo, criado.dados.link.codigo);
  });

  it("não deixa editar link de outra pessoa", async () => {
    const criado = await cliente.post("/api/links", { destino: "https://meu.com" });

    cliente.esquecerCookie();
    await cliente.post("/api/usuarios", {
      email: "invasor@exemplo.com",
      senha: "uma-senha-boa"
    });

    // 404 e não 403: dizer "existe, mas não é seu" já entrega que
    // aquele id existe. Para quem não é dono, o link não existe.
    const resposta = await cliente.patch(`/api/links/${criado.dados.link.id}`, {
      destino: "https://site-do-invasor.com"
    });

    assert.equal(resposta.status, 404);
  });

  it("recusa id que não é número", async () => {
    const resposta = await cliente.patch("/api/links/abc", { titulo: "x" });
    assert.equal(resposta.status, 400);
  });
});

describe("DELETE /api/links/:id", () => {
  it("apaga o link e os cliques junto", async () => {
    const criado = await cliente.post("/api/links", { destino: "https://exemplo.com" });
    const linkId = criado.dados.link.id;

    await pool.query("INSERT INTO cliques (link_id, ocorrido_em) VALUES ($1, now())", [linkId]);

    const resposta = await cliente.delete(`/api/links/${linkId}`);
    assert.equal(resposta.status, 204);

    // ON DELETE CASCADE na migração 002. Sem ele, sobrariam
    // cliques apontando para um link que não existe mais.
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM cliques WHERE link_id = $1",
      [linkId]
    );
    assert.equal(rows[0].total, 0);
  });

  it("responde 404 para link que não existe", async () => {
    const resposta = await cliente.delete("/api/links/99999");
    assert.equal(resposta.status, 404);
  });
});
