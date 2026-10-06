// ============================================================
// Rotas de usuário
// Prefixo: /api/usuarios
// ============================================================

import { Router } from "express";

import { pool } from "../../db/pool.js";
import { gerarHash } from "../servicos/senha.js";
import { criarSessao, NOME_COOKIE, opcoesCookie } from "../servicos/sessao.js";
import { limitar } from "../middlewares/limite.js";
import { exigirLogin } from "../middlewares/autenticacao.js";
import { validarEmail, validarSenha } from "../util/validacao.js";

const router = Router();

/**
 * POST /api/usuarios
 * body: { email, senha }
 *
 * Cadastra e já deixa a pessoa logada — pedir para fazer login
 * logo depois de criar a conta é um passo sem motivo.
 */
router.post(
  "/",
  limitar({ nome: "cadastro", max: 5, janela: 60 * 60 }),
  async (req, res, next) => {
    try {
      const { email, senha } = req.body ?? {};

      const erro = validarEmail(email) ?? validarSenha(senha);
      if (erro) return res.status(400).json({ erro });

      const emailNormalizado = email.trim().toLowerCase();
      const senhaHash = await gerarHash(senha);

      // ON CONFLICT DO NOTHING em vez de "SELECT para ver se já
      // existe, depois INSERT": entre o SELECT e o INSERT, outra
      // requisição pode inserir o mesmo e-mail. Quem decide é o
      // UNIQUE da tabela, que não tem essa janela.
      const { rows } = await pool.query(
        `INSERT INTO usuarios (email, senha_hash)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, criado_em`,
        [emailNormalizado, senhaHash]
      );

      if (rows.length === 0) {
        return res.status(409).json({ erro: "Este e-mail já está cadastrado" });
      }

      const usuario = rows[0];
      const token = await criarSessao(usuario.id);
      res.cookie(NOME_COOKIE, token, opcoesCookie());

      res.status(201).json({ usuario });
    } catch (erro) {
      next(erro);
    }
  }
);

/**
 * GET /api/usuarios/eu
 *
 * Quem está logado. O painel chama ao abrir para decidir entre
 * mostrar a tela de login ou a lista de links.
 */
router.get("/eu", exigirLogin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, criado_em FROM usuarios WHERE id = $1",
      [req.usuarioId]
    );

    // A sessão existe no Redis mas o usuário sumiu do banco
    // (conta apagada com sessão aberta). Tratar como não logado.
    if (rows.length === 0) {
      return res.status(401).json({ erro: "Faça login para continuar" });
    }

    res.json({ usuario: rows[0] });
  } catch (erro) {
    next(erro);
  }
});

export default router;
