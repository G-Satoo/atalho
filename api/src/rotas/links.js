// ============================================================
// Rotas de links
// Prefixo: /api/links  (todas exigem login)
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import * as cache from "../servicos/cache.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { limitar } from "../middlewares/limite.js";
import { gerarCodigo, validarCodigoPersonalizado } from "../util/codigo.js";
import { lerInteiro, validarDestino } from "../util/validacao.js";

const router = Router();

// Tudo daqui para baixo é do dono dos links.
router.use(exigirLogin);

const URL_BASE = process.env.URL_BASE || "http://localhost:3002";

/**
 * Monta o objeto que a API devolve. O front não deveria precisar
 * saber montar a URL curta — se um dia o domínio mudar, muda aqui.
 */
function formatar(link) {
  return { ...link, url_curta: `${URL_BASE}/${link.codigo}` };
}

/**
 * GET /api/links?pagina=1&por_pagina=20
 *
 * Lista os links do usuário com o total de cliques de cada um.
 */
router.get("/", async (req, res, next) => {
  try {
    const pagina = lerInteiro(req.query.pagina, { padrao: 1, minimo: 1, maximo: 10000 });
    const porPagina = lerInteiro(req.query.por_pagina, { padrao: 20, minimo: 1, maximo: 100 });

    // LEFT JOIN + GROUP BY agruparia a tabela de cliques inteira
    // para depois jogar fora o que não é deste usuário. A
    // subconsulta correlacionada só conta o que interessa, usando
    // o índice idx_cliques_link.
    const { rows } = await pool.query(
      `SELECT
         l.id, l.codigo, l.destino, l.titulo, l.ativo,
         l.expira_em, l.criado_em,
         (SELECT COUNT(*) FROM cliques c WHERE c.link_id = l.id)::int AS cliques
       FROM links l
       WHERE l.usuario_id = $1
       ORDER BY l.criado_em DESC
       LIMIT $2 OFFSET $3`,
      [req.usuarioId, porPagina, (pagina - 1) * porPagina]
    );

    const { rows: totais } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM links WHERE usuario_id = $1",
      [req.usuarioId]
    );

    res.json({
      links: rows.map(formatar),
      pagina,
      por_pagina: porPagina,
      total: totais[0].total
    });
  } catch (erro) {
    next(erro);
  }
});

/**
 * POST /api/links
 * body: { destino, titulo?, codigo?, expira_em? }
 */
router.post(
  "/",
  limitar({
    nome: "criar-link",
    max: 60,
    janela: 60 * 60,
    // Por usuário, não por IP: um escritório inteiro sai pelo
    // mesmo IP, e não é para um colega gastar o limite do outro.
    chave: (req) => req.usuarioId
  }),
  async (req, res, next) => {
    try {
      const { destino, titulo, codigo, expira_em: expiraEm } = req.body ?? {};

      const erro = validarDestino(destino);
      if (erro) return res.status(400).json({ erro });

      if (codigo !== undefined && codigo !== null && codigo !== "") {
        const erroCodigo = validarCodigoPersonalizado(codigo);
        if (erroCodigo) return res.status(400).json({ erro: erroCodigo });
      }

      let expiraEmData = null;
      if (expiraEm) {
        expiraEmData = new Date(expiraEm);
        if (Number.isNaN(expiraEmData.getTime())) {
          return res.status(400).json({ erro: "Data de expiração inválida" });
        }
      }

      const link = codigo
        ? await inserirComCodigoFixo(req.usuarioId, codigo, destino, titulo, expiraEmData)
        : await inserirComCodigoGerado(req.usuarioId, destino, titulo, expiraEmData);

      if (link === "codigo-em-uso") {
        return res.status(409).json({ erro: "Este código já está em uso" });
      }

      res.status(201).json({ link: formatar(link) });
    } catch (erro) {
      next(erro);
    }
  }
);

// 23505 é o código do Postgres para violação de UNIQUE. Usamos o
// código, e não o texto da mensagem, porque a mensagem muda com a
// versão e com o idioma do servidor.
const VIOLACAO_UNIQUE = "23505";

async function inserirComCodigoFixo(usuarioId, codigo, destino, titulo, expiraEm) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO links (usuario_id, codigo, destino, titulo, expira_em)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, codigo, destino, titulo, ativo, expira_em, criado_em`,
      [usuarioId, codigo, destino.trim(), titulo?.trim() || null, expiraEm]
    );

    return { ...rows[0], cliques: 0 };
  } catch (erro) {
    if (erro.code === VIOLACAO_UNIQUE) return "codigo-em-uso";
    throw erro;
  }
}

/**
 * Sorteia um código e tenta inserir; se colidir, sorteia outro.
 *
 * Não existe "checar antes se está livre": entre a checagem e o
 * INSERT, outra requisição pode pegar o mesmo código. Deixamos o
 * UNIQUE do banco decidir e tratamos a colisão.
 *
 * Com 57^7 combinações, colidir é raro — mas raro não é nunca, e
 * fica menos raro conforme a tabela cresce (paradoxo do
 * aniversário). Cinco tentativas tornam a falha desprezível.
 */
async function inserirComCodigoGerado(usuarioId, destino, titulo, expiraEm) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const resultado = await inserirComCodigoFixo(
      usuarioId, gerarCodigo(), destino, titulo, expiraEm
    );

    if (resultado !== "codigo-em-uso") return resultado;
  }

  // Cinco colisões seguidas não é azar, é sinal de que o espaço de
  // códigos está saturado (ou de que algo está muito errado).
  throw new Error("Não foi possível gerar um código livre após 5 tentativas");
}

/**
 * PATCH /api/links/:id
 * body: { destino?, titulo?, ativo? }
 *
 * PATCH e não PUT: o painel manda só o campo que mudou.
 */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { destino, titulo, ativo } = req.body ?? {};

    if (destino !== undefined) {
      const erro = validarDestino(destino);
      if (erro) return res.status(400).json({ erro });
    }

    // COALESCE($1, coluna): quando o parâmetro vem null, mantém o
    // valor atual. Evita montar um SQL diferente para cada
    // combinação de campos enviados — que é justamente onde se
    // abre brecha de injeção ao concatenar string.
    const { rows } = await pool.query(
      `UPDATE links
          SET destino = COALESCE($1, destino),
              titulo  = COALESCE($2, titulo),
              ativo   = COALESCE($3, ativo)
        WHERE id = $4 AND usuario_id = $5
        RETURNING id, codigo, destino, titulo, ativo, expira_em, criado_em`,
      [
        destino?.trim() ?? null,
        titulo?.trim() ?? null,
        typeof ativo === "boolean" ? ativo : null,
        id,
        // O usuario_id no WHERE é o que impede alguém de editar o
        // link de outra pessoa trocando o id na URL. Sem ele, estar
        // logado bastaria para mexer em qualquer link do sistema.
        req.usuarioId
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Link não encontrado" });
    }

    // O destino mudou (ou o link foi desativado): o Redis ainda tem
    // o valor antigo e mandaria gente para lá por até uma hora.
    await cache.invalidar(rows[0].codigo);

    res.json({ link: formatar(rows[0]) });
  } catch (erro) {
    next(erro);
  }
});

/**
 * DELETE /api/links/:id
 *
 * Apaga de verdade — os cliques vão junto pelo ON DELETE CASCADE.
 * Quem quer manter o histórico usa ativo = false no PATCH.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = lerInteiro(req.params.id, { padrao: null, minimo: 1, maximo: 2147483647 });
    if (id === null) return res.status(400).json({ erro: "Id inválido" });

    const { rows } = await pool.query(
      "DELETE FROM links WHERE id = $1 AND usuario_id = $2 RETURNING codigo",
      [id, req.usuarioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Link não encontrado" });
    }

    await cache.invalidar(rows[0].codigo);

    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
});

export default router;
