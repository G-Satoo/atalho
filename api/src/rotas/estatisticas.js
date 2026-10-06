// ============================================================
// Rotas de estatísticas
// Prefixo: /api/links/:id/estatisticas  (exige login)
//
// É a parte que justifica guardar clique a clique em vez de só
// incrementar um contador: dá para cortar por dia, por
// dispositivo e por origem depois, sem ter decidido isso antes.
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { lerInteiro } from "../util/validacao.js";

// mergeParams: sem isso o :id do caminho de cima não chega aqui —
// cada Router do Express tem os próprios params por padrão.
const router = Router({ mergeParams: true });

router.use(exigirLogin);

/**
 * Confere que o link existe E é deste usuário, numa consulta só.
 * Devolve o id ou null.
 *
 * Sem esta checagem, trocar o id na URL leria a estatística de
 * qualquer link do sistema. Como todas as consultas abaixo
 * filtram por link_id, é aqui que a permissão é decidida.
 */
async function linkDoUsuario(linkId, usuarioId) {
  const { rows } = await pool.query(
    "SELECT id, codigo, destino, titulo FROM links WHERE id = $1 AND usuario_id = $2",
    [linkId, usuarioId]
  );

  return rows[0] ?? null;
}

/**
 * GET /api/links/:id/estatisticas?dias=30
 *
 * Devolve tudo que o painel de um link precisa, numa resposta só:
 * totais, série por dia, dispositivos e origens. São quatro
 * consultas no servidor, mas uma ida à rede para o navegador —
 * quatro requisições separadas deixariam a tela montando aos
 * pedaços.
 */
router.get("/", async (req, res, next) => {
  try {
    const linkId = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (linkId === null) return res.status(400).json({ erro: "Id inválido" });

    const link = await linkDoUsuario(linkId, req.usuarioId);
    if (!link) return res.status(404).json({ erro: "Link não encontrado" });

    const dias = lerInteiro(req.query.dias, { padrao: 30, minimo: 1, maximo: 365 });

    // make_interval($2) e não a concatenação "INTERVAL '" + dias +
    // " days'": intervalo montado com string é o caminho mais curto
    // para uma injeção de SQL. Com make_interval o valor continua
    // sendo parâmetro.
    const desde = `now() - make_interval(days => $2::int)`;

    const [totais, porDia, porDispositivo, porOrigem] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS cliques,
           COUNT(*) FILTER (WHERE ocorrido_em >= ${desde})::int AS cliques_periodo,
           MAX(ocorrido_em) AS ultimo_clique
         FROM cliques
         WHERE link_id = $1`,
        [linkId, dias]
      ),

      // generate_series à esquerda e LEFT JOIN: um dia sem clique
      // nenhum precisa aparecer como zero. Sem isso o gráfico "pula"
      // os dias vazios e uma queda de tráfego vira uma linha reta
      // mentirosa.
      pool.query(
        `SELECT
           d.dia::date AS dia,
           COUNT(c.id)::int AS cliques
         FROM generate_series(
                (${desde})::date,
                now()::date,
                '1 day'
              ) AS d(dia)
         LEFT JOIN cliques c
           ON c.link_id = $1
          AND c.ocorrido_em::date = d.dia::date
         GROUP BY d.dia
         ORDER BY d.dia`,
        [linkId, dias]
      ),

      pool.query(
        `SELECT
           COALESCE(dispositivo, 'desconhecido') AS dispositivo,
           COUNT(*)::int AS cliques
         FROM cliques
         WHERE link_id = $1 AND ocorrido_em >= ${desde}
         GROUP BY 1
         ORDER BY cliques DESC`,
        [linkId, dias]
      ),

      // 'direto' = sem Referer: link colado no WhatsApp, digitado,
      // aberto de um PDF. Costuma ser a maior fatia e não é um erro.
      pool.query(
        `SELECT
           COALESCE(origem, 'direto') AS origem,
           COUNT(*)::int AS cliques
         FROM cliques
         WHERE link_id = $1 AND ocorrido_em >= ${desde}
         GROUP BY 1
         ORDER BY cliques DESC
         LIMIT 10`,
        [linkId, dias]
      )
    ]);

    res.json({
      link,
      dias,
      totais: totais.rows[0],
      por_dia: porDia.rows,
      por_dispositivo: porDispositivo.rows,
      por_origem: porOrigem.rows
    });
  } catch (erro) {
    next(erro);
  }
});

export default router;
