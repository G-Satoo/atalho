// ============================================================
// Redirecionamento
// Rota: GET /:codigo   (pública, sem login)
//
// É a rota mais importante do sistema e a única que precisa ser
// rápida de verdade — é a que a pessoa espera acontecer.
//
// Caminho feliz: uma leitura no Redis, um 302, e o clique vai
// para a fila. O Postgres não entra.
//
// Ordem das coisas, que aqui é uma decisão e não um detalhe:
// respondemos primeiro e enfileiramos depois. Nenhuma estatística
// vale atrasar o redirecionamento.
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import * as cache from "../servicos/cache.js";
import { registrarClique } from "../servicos/fila.js";

const router = Router();

/**
 * Busca o link: primeiro no cache, depois no banco.
 *
 * Devolve { linkId, destino } ou null.
 */
async function resolver(codigo) {
  const doCache = await cache.buscar(codigo);

  if (doCache === "inexistente") return null;
  if (doCache) return doCache;

  // Cache miss. Vai ao banco e guarda o resultado para as
  // próximas — inclusive o resultado negativo.
  const { rows } = await pool.query(
    `SELECT id, destino
       FROM links
      WHERE codigo = $1
        AND ativo = TRUE
        AND (expira_em IS NULL OR expira_em > now())`,
    [codigo]
  );

  if (rows.length === 0) {
    await cache.guardarInexistente(codigo);
    return null;
  }

  const link = { linkId: rows[0].id, destino: rows[0].destino };
  await cache.guardar(codigo, link.linkId, link.destino);

  return link;
}

router.get("/:codigo", async (req, res, next) => {
  try {
    const { codigo } = req.params;

    const link = await resolver(codigo);

    if (!link) {
      return res.status(404).type("text/plain").send("Link não encontrado");
    }

    // 302 e não 301: o 301 é permanente e o navegador guarda para
    // sempre: quem já clicou uma vez nunca mais passaria por aqui,
    // e a estatística morreria junto. Editar o destino do link
    // também deixaria de ter efeito para essas pessoas.
    res.redirect(302, link.destino);

    // Daqui para baixo a resposta já foi enviada. O trabalho que
    // sobra não atrasa ninguém.
    //
    // O horário é carimbado aqui, não no worker: se a fila
    // acumular, o gráfico ainda mostra a hora em que o clique
    // aconteceu de verdade.
    registrarClique({
      linkId: link.linkId,
      ocorridoEm: new Date().toISOString(),
      userAgent: req.get("user-agent") ?? null,
      referer: req.get("referer") ?? null
    });
  } catch (erro) {
    next(erro);
  }
});

export default router;
