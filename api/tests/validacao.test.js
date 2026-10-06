// ============================================================
// Testes de validação de entrada
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validarEmail,
  validarSenha,
  validarDestino,
  lerInteiro
} from "../src/util/validacao.js";

describe("validarEmail", () => {
  it("aceita endereços normais", () => {
    for (const email of ["a@b.co", "gustavo.alves@exemplo.com.br", "x+tag@dominio.io"]) {
      assert.equal(validarEmail(email), null, email);
    }
  });

  it("recusa o que claramente não é e-mail", () => {
    for (const invalido of ["", "   ", "sem-arroba.com", "a@b", "a b@c.com", null, 42]) {
      assert.ok(validarEmail(invalido));
    }
  });
});

describe("validarSenha", () => {
  it("exige pelo menos 8 caracteres", () => {
    assert.ok(validarSenha("curta12"));
    assert.equal(validarSenha("oito1234"), null);
  });

  it("tem teto de tamanho", () => {
    // Sem teto, uma senha enorme vira um jeito barato de ocupar a
    // CPU do servidor: o scrypt processa tudo que chega.
    assert.ok(validarSenha("a".repeat(201)));
  });
});

describe("validarDestino", () => {
  it("aceita http e https", () => {
    assert.equal(validarDestino("https://exemplo.com/artigo?id=3"), null);
    assert.equal(validarDestino("http://localhost:3000"), null);
  });

  it("recusa esquemas que executam código no navegador de quem clica", () => {
    // É o que separa um encurtador de uma ferramenta de ataque.
    assert.ok(validarDestino("javascript:alert(1)"));
    assert.ok(validarDestino("data:text/html,<script>alert(1)</script>"));
    assert.ok(validarDestino("file:///C:/Windows/System32"));
  });

  it("recusa texto que não é URL", () => {
    for (const invalido of ["", "   ", "exemplo.com", "isso é uma frase", null]) {
      assert.ok(validarDestino(invalido));
    }
  });
});

describe("lerInteiro", () => {
  it("usa o padrão quando o valor não veio", () => {
    assert.equal(lerInteiro(undefined, { padrao: 30, minimo: 1, maximo: 365 }), 30);
    assert.equal(lerInteiro("", { padrao: 30, minimo: 1, maximo: 365 }), 30);
  });

  it("prende o valor nos limites em vez de recusar", () => {
    assert.equal(lerInteiro("9999", { padrao: 30, minimo: 1, maximo: 365 }), 365);
    assert.equal(lerInteiro("-5", { padrao: 30, minimo: 1, maximo: 365 }), 1);
  });

  it("ignora o que não é inteiro", () => {
    for (const lixo of ["abc", "3.5", "1e5", "0x10", " "]) {
      assert.equal(lerInteiro(lixo, { padrao: 30, minimo: 1, maximo: 365 }), 30, lixo);
    }
  });

  it("ignora parâmetro repetido na query string", () => {
    // ?dias=10&dias=20 chega como array no Express. Number([]) daria
    // NaN e, sem esta guarda, NaN passaria adiante silenciosamente.
    assert.equal(lerInteiro(["10", "20"], { padrao: 30, minimo: 1, maximo: 365 }), 30);
  });
});
