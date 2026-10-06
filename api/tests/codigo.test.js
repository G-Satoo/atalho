// ============================================================
// Testes da geração e validação de código
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  gerarCodigo,
  validarCodigoPersonalizado,
  TAMANHO_PADRAO
} from "../src/util/codigo.js";

describe("gerarCodigo", () => {
  it("respeita o tamanho pedido", () => {
    assert.equal(gerarCodigo().length, TAMANHO_PADRAO);
    assert.equal(gerarCodigo(12).length, 12);
  });

  it("não usa caracteres que as pessoas confundem", () => {
    // 0/O, 1/l/I são os pares que geram "o link não abre" quando
    // alguém copia de um slide ou de um papel.
    const amostra = Array.from({ length: 500 }, () => gerarCodigo(20)).join("");

    for (const proibido of ["0", "O", "1", "l", "I"]) {
      assert.ok(
        !amostra.includes(proibido),
        `o caractere ${proibido} não deveria aparecer no alfabeto`
      );
    }
  });

  it("não repete códigos em uso normal", () => {
    // Não prova ausência de colisão (isso é estatística, e o UNIQUE
    // do banco é quem garante) — pega um gerador quebrado que
    // devolve sempre a mesma coisa.
    const codigos = new Set(Array.from({ length: 1000 }, () => gerarCodigo()));

    assert.equal(codigos.size, 1000);
  });
});

describe("validarCodigoPersonalizado", () => {
  it("aceita códigos comuns", () => {
    for (const valido of ["promo", "black-friday", "curso_2026", "abc"]) {
      assert.equal(validarCodigoPersonalizado(valido), null, valido);
    }
  });

  it("recusa o que quebraria a URL", () => {
    for (const invalido of ["ab", "com espaço", "com/barra", "acentuação", "a".repeat(33)]) {
      assert.ok(validarCodigoPersonalizado(invalido), invalido);
    }
  });

  it("recusa códigos que colidem com as rotas do sistema", () => {
    // Um link chamado "api" tornaria /api/links inalcançável.
    for (const reservado of ["api", "API", "health", "painel", "favicon.ico"]) {
      assert.ok(validarCodigoPersonalizado(reservado), reservado);
    }
  });
});
