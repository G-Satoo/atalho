// ============================================================
// Semeia o banco com dados de demonstração
//
// Rode com:  npm run semear
//
// Cria uma conta de teste, alguns links e cliques espalhados
// pelos últimos 30 dias — sem isso o painel abre vazio e não dá
// para ver se os gráficos funcionam.
//
// Os cliques são inseridos direto no banco, sem passar pela fila:
// aqui queremos histórico pronto, não exercitar o worker.
// ============================================================

import { randomInt } from "node:crypto";
import "dotenv/config";

import { pool } from "../db/pool.js";
import { gerarHash } from "../src/servicos/senha.js";
import { gerarCodigo } from "../src/util/codigo.js";

const EMAIL = "demo@atalho.dev";
const SENHA = "demo12345";

const LINKS = [
  { titulo: "Vaga de desenvolvedor", destino: "https://exemplo.com/vagas/dev-junior", codigo: "vaga-dev" },
  { titulo: "Newsletter de setembro", destino: "https://exemplo.com/newsletter/2026-09" },
  { titulo: "Documentação da API", destino: "https://exemplo.com/docs/api/v1/referencia-completa" },
  { titulo: "Promoção de lançamento", destino: "https://exemplo.com/promo", codigo: "promo" },
  { titulo: "Currículo", destino: "https://github.com/exemplo" }
];

const DISPOSITIVOS = ["celular", "celular", "celular", "computador", "computador", "tablet"];
const NAVEGADORES = ["Chrome", "Chrome", "Safari", "Firefox", "Edge"];
const SISTEMAS = ["Android", "iOS", "Windows", "macOS", "Linux"];
const ORIGENS = [null, null, "www.google.com", "www.linkedin.com", "t.co", "www.instagram.com"];

const sortear = (lista) => lista[randomInt(lista.length)];

async function semear() {
  // Apaga a conta de demonstração inteira antes de recriar (os
  // links e cliques vão junto pelo CASCADE). Assim rodar duas
  // vezes não empilha dados nem falha por e-mail repetido.
  await pool.query("DELETE FROM usuarios WHERE email = $1", [EMAIL]);

  const { rows: usuarios } = await pool.query(
    "INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2) RETURNING id",
    [EMAIL, await gerarHash(SENHA)]
  );
  const usuarioId = usuarios[0].id;

  let totalCliques = 0;

  for (const [indice, definicao] of LINKS.entries()) {
    const { rows } = await pool.query(
      `INSERT INTO links (usuario_id, codigo, destino, titulo)
       VALUES ($1, $2, $3, $4) RETURNING id, codigo`,
      [usuarioId, definicao.codigo ?? gerarCodigo(), definicao.destino, definicao.titulo]
    );

    const link = rows[0];

    // Os primeiros links da lista recebem mais cliques — um painel
    // em que tudo tem o mesmo movimento não mostra nada.
    const media = [40, 25, 12, 6, 2][indice] ?? 3;

    const valores = [];
    const grupos = [];

    for (let dia = 29; dia >= 0; dia--) {
      // Variação diária, com fim de semana mais fraco.
      const fraco = dia % 7 === 0 || dia % 7 === 6;
      const quantidade = Math.max(0, randomInt(media) + (fraco ? -2 : 2));

      for (let i = 0; i < quantidade; i++) {
        const base = valores.length;
        valores.push(
          link.id, dia, randomInt(24),
          sortear(DISPOSITIVOS), sortear(NAVEGADORES), sortear(SISTEMAS), sortear(ORIGENS)
        );
        grupos.push(
          `($${base + 1},
            now() - make_interval(days => $${base + 2}::int, hours => $${base + 3}::int),
            $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
        );
      }
    }

    if (grupos.length > 0) {
      await pool.query(
        `INSERT INTO cliques (link_id, ocorrido_em, dispositivo, navegador, sistema, origem)
         VALUES ${grupos.join(", ")}`,
        valores
      );
    }

    totalCliques += grupos.length;
    console.log(`  /${link.codigo.padEnd(10)} ${grupos.length} cliques  ${definicao.titulo}`);
  }

  console.log(`\n${LINKS.length} links e ${totalCliques} cliques criados.`);
  console.log(`\nEntre no painel com:\n  e-mail: ${EMAIL}\n  senha:  ${SENHA}\n`);
}

try {
  await semear();
} catch (erro) {
  console.error("\nFalha ao semear:", erro.message);
  console.error("O banco está de pé e migrado? Rode: npm run migrar\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
