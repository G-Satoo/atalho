// ============================================================
// Testes da leitura de User-Agent e Referer
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { lerAgente, lerOrigem } from "../src/servicos/agente.js";

const UA_CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const UA_SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1";

describe("lerAgente", () => {
  it("reconhece um navegador de computador", () => {
    const agente = lerAgente(UA_CHROME_WINDOWS);

    assert.equal(agente.dispositivo, "computador");
    assert.equal(agente.navegador, "Chrome");
    assert.equal(agente.sistema, "Windows");
  });

  it("reconhece um celular", () => {
    // O UA não diz "mobile" em lugar nenhum de forma óbvia — quem
    // deduz é a biblioteca, e é por isso que este teste existe.
    const agente = lerAgente(UA_SAFARI_IPHONE);

    assert.equal(agente.dispositivo, "celular");
    assert.equal(agente.navegador, "Mobile Safari");
    assert.equal(agente.sistema, "iOS");
  });

  it("não quebra sem User-Agent", () => {
    // Requisição de script, de bot ou de cliente antigo. O clique
    // conta do mesmo jeito, só sem os detalhes.
    assert.deepEqual(lerAgente(null), {
      dispositivo: null,
      navegador: null,
      sistema: null
    });
  });

  it("não quebra com User-Agent inventado", () => {
    // Qualquer um pode mandar o que quiser neste cabeçalho.
    const agente = lerAgente("isso aqui não é um user agent");

    assert.equal(agente.dispositivo, "computador");
    assert.doesNotThrow(() => lerAgente("()()()"));
  });
});

describe("lerOrigem", () => {
  it("guarda só o host, não a URL inteira", () => {
    // A URL completa costuma carregar dado pessoal na query string.
    assert.equal(
      lerOrigem("https://www.google.com/search?q=nome+sobrenome+cpf"),
      "www.google.com"
    );
  });

  it("devolve null sem Referer", () => {
    // É o caso mais comum: link colado no WhatsApp ou digitado.
    assert.equal(lerOrigem(null), null);
    assert.equal(lerOrigem(""), null);
  });

  it("devolve null quando o Referer é lixo", () => {
    assert.equal(lerOrigem("não-é-url"), null);
  });
});
