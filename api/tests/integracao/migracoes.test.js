// ============================================================
// Testes do runner de migrações
//
// Este arquivo roda contra o banco de teste, que nasce vazio a
// cada restart do container — então ele exercita de verdade o
// caminho "banco do zero até o schema atual".
// ============================================================

import "../ajuda/ambiente-teste.js";

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepararBanco, encerrarConexoes } from "../ajuda/banco.js";
import { migrar } from "../../db/migrar.js";
import { pool } from "../../db/pool.js";

before(prepararBanco);

after(encerrarConexoes);

describe("migrações", () => {
  it("cria todas as tabelas do sistema", async () => {
    const { rows } = await pool.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`
    );

    const tabelas = rows.map((linha) => linha.table_name);

    for (const esperada of ["cliques", "links", "migracoes", "usuarios"]) {
      assert.ok(tabelas.includes(esperada), `faltou a tabela ${esperada}`);
    }
  });

  it("rodar de novo não faz nada", async () => {
    // É a propriedade que permite chamar `npm run migrar` em todo
    // deploy sem pensar. Sem ela, o segundo deploy quebraria com
    // "tabela já existe".
    const aplicadas = await migrar();

    assert.deepEqual(aplicadas, []);
  });

  it("registra cada migração aplicada", async () => {
    const { rows } = await pool.query("SELECT nome FROM migracoes ORDER BY nome");

    assert.deepEqual(
      rows.map((linha) => linha.nome),
      ["001-usuarios-e-links.sql", "002-cliques.sql"]
    );
  });

  it("cria os índices que as consultas do painel dependem", async () => {
    // Sem eles o sistema funciona igual — e fica lento devagar,
    // conforme a tabela de cliques cresce. É o tipo de coisa que
    // some num refactor de migração e ninguém percebe.
    const { rows } = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    );

    const indices = rows.map((linha) => linha.indexname);

    assert.ok(indices.includes("idx_links_usuario"));
    assert.ok(indices.includes("idx_cliques_link"));
  });

  it("garante código único no banco, não só na aplicação", async () => {
    // Checar antes de inserir não resolve: duas requisições
    // simultâneas passam na checagem juntas. A única garantia real
    // é a restrição do banco.
    const { rows } = await pool.query(
      `INSERT INTO usuarios (email, senha_hash)
       VALUES ('unico@exemplo.com', 'x') RETURNING id`
    );
    const usuarioId = rows[0].id;

    await pool.query(
      "INSERT INTO links (usuario_id, codigo, destino) VALUES ($1, 'duplicado', 'https://a.com')",
      [usuarioId]
    );

    await assert.rejects(
      pool.query(
        "INSERT INTO links (usuario_id, codigo, destino) VALUES ($1, 'duplicado', 'https://b.com')",
        [usuarioId]
      ),
      (erro) => erro.code === "23505"
    );

    await pool.query("DELETE FROM usuarios WHERE id = $1", [usuarioId]);
  });
});
