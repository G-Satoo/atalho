// ============================================================
// Testes de cadastro, login e sessão
//
// Rode com:
//   docker compose --profile teste up -d db-teste redis-teste
//   npm run test:integracao
// ============================================================

import "../ajuda/ambiente-teste.js"; // precisa vir primeiro — ver o arquivo

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, limpar, encerrarConexoes } from "../ajuda/banco.js";
import { subirServidor } from "../ajuda/servidor.js";
import { NOME_COOKIE } from "../../src/servicos/sessao.js";

let servidor;
let cliente;

before(async () => {
  await prepararBanco();
  ({ servidor, cliente } = await subirServidor());
});

beforeEach(limpar);

after(async () => {
  servidor.close();
  await encerrarConexoes();
});

describe("POST /api/usuarios (cadastro)", () => {
  it("cria a conta e já deixa logado", async () => {
    const resposta = await cliente.post("/api/usuarios", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });

    assert.equal(resposta.status, 201);
    assert.equal(resposta.dados.usuario.email, "gustavo@exemplo.com");

    // Não deveria ser preciso fazer login logo depois de se cadastrar.
    const eu = await cliente.get("/api/usuarios/eu");
    assert.equal(eu.status, 200);
  });

  it("nunca devolve o hash da senha", async () => {
    const resposta = await cliente.post("/api/usuarios", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });

    // O jeito mais comum de vazar isso é um SELECT * que ninguém
    // revisou. Testar o objeto inteiro pega o campo novo que
    // alguém adicionar amanhã.
    assert.deepEqual(
      Object.keys(resposta.dados.usuario).sort(),
      ["criado_em", "email", "id"]
    );
  });

  it("guarda o e-mail em minúsculo", async () => {
    // Senão "Gustavo@" e "gustavo@" viram duas contas, e a pessoa
    // não entende por que o login "parou de funcionar".
    await cliente.post("/api/usuarios", {
      email: "Gustavo@Exemplo.COM",
      senha: "uma-senha-boa"
    });

    const eu = await cliente.get("/api/usuarios/eu");
    assert.equal(eu.dados.usuario.email, "gustavo@exemplo.com");
  });

  it("recusa e-mail repetido com 409", async () => {
    const dados = { email: "gustavo@exemplo.com", senha: "uma-senha-boa" };

    await cliente.post("/api/usuarios", dados);
    const segunda = await cliente.post("/api/usuarios", dados);

    assert.equal(segunda.status, 409);
  });

  it("recusa senha curta com 400", async () => {
    const resposta = await cliente.post("/api/usuarios", {
      email: "gustavo@exemplo.com",
      senha: "curta"
    });

    assert.equal(resposta.status, 400);
  });
});

describe("POST /api/sessoes (login)", () => {
  beforeEach(async () => {
    await cliente.post("/api/usuarios", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });
    cliente.esquecerCookie();
  });

  it("entra com a senha certa", async () => {
    const resposta = await cliente.post("/api/sessoes", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });

    assert.equal(resposta.status, 201);

    const eu = await cliente.get("/api/usuarios/eu");
    assert.equal(eu.status, 200);
  });

  it("manda o cookie como httpOnly", async () => {
    // httpOnly é o que impede um XSS no painel de ler a sessão.
    // É uma linha de configuração fácil de perder num refactor.
    const resposta = await cliente.post("/api/sessoes", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });

    const cookie = resposta.cabecalhos.get("set-cookie");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, new RegExp(NOME_COOKIE));
  });

  it("recusa a senha errada com 401", async () => {
    const resposta = await cliente.post("/api/sessoes", {
      email: "gustavo@exemplo.com",
      senha: "senha-errada-mesmo"
    });

    assert.equal(resposta.status, 401);
  });

  it("dá a mesma resposta para e-mail que não existe", async () => {
    // Respostas diferentes contariam quais e-mails têm conta aqui.
    const inexistente = await cliente.post("/api/sessoes", {
      email: "ninguem@exemplo.com",
      senha: "uma-senha-boa"
    });

    assert.equal(inexistente.status, 401);
    assert.equal(inexistente.dados.erro, "E-mail ou senha incorretos");
  });
});

describe("DELETE /api/sessoes (logout)", () => {
  it("encerra a sessão no servidor, não só no navegador", async () => {
    await cliente.post("/api/usuarios", {
      email: "gustavo@exemplo.com",
      senha: "uma-senha-boa"
    });

    // Guarda o cookie antes de sair, para tentar reusá-lo depois.
    const antes = await cliente.get("/api/usuarios/eu");
    assert.equal(antes.status, 200);

    const cookieRoubado = cliente.cookieAtual;

    const saida = await cliente.delete("/api/sessoes");
    assert.equal(saida.status, 204);

    // É aqui que sessão em Redis ganha do JWT: o token continua
    // existindo e sendo bem formado, mas não vale mais nada.
    cliente.definirCookie(cookieRoubado);
    const depois = await cliente.get("/api/usuarios/eu");
    assert.equal(depois.status, 401);
  });

  it("responde 204 mesmo sem estar logado", async () => {
    cliente.esquecerCookie();

    const resposta = await cliente.delete("/api/sessoes");
    assert.equal(resposta.status, 204);
  });
});

describe("rotas protegidas", () => {
  it("recusam quem não está logado", async () => {
    cliente.esquecerCookie();

    for (const caminho of ["/api/usuarios/eu", "/api/links"]) {
      const resposta = await cliente.get(caminho);
      assert.equal(resposta.status, 401, caminho);
    }
  });

  it("recusam um cookie inventado", async () => {
    cliente.definirCookie(`${NOME_COOKIE}=token-que-eu-inventei`);

    const resposta = await cliente.get("/api/usuarios/eu");
    assert.equal(resposta.status, 401);
  });
});
