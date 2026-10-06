// ============================================================
// Servidor da API e do redirecionador
//
// Rode com:  npm run dev
// Abre em:   http://localhost:3002
//
// Lembre que o worker é um processo separado — sem ele o sistema
// redireciona normalmente, mas nenhum clique aparece no painel:
//   npm run worker
//
// `app` é exportado separado do `.listen()` — os testes de
// integração importam `app` e sobem um servidor efêmero numa
// porta aleatória (app.listen(0)) contra o banco de teste, sem
// disputar a porta 3002.
// ============================================================

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";
import { fileURLToPath } from "node:url";

import { pool } from "../db/pool.js";
import { redis } from "./redis.js";

import rotasUsuarios from "./rotas/usuarios.js";
import rotasSessoes from "./rotas/sessoes.js";
import rotasLinks from "./rotas/links.js";
import rotasEstatisticas from "./rotas/estatisticas.js";
import rotasRedirecionar from "./rotas/redirecionar.js";

export const app = express();

// ----- Middlewares -----

// O painel roda em outra porta e manda cookie de sessão junto.
// credentials: true é o que permite isso — e obriga a listar a
// origem exata, porque o navegador recusa "*" com credenciais.
app.use(
  cors({
    origin: process.env.ORIGEM_PAINEL || "http://localhost:5174",
    credentials: true
  })
);

app.use(express.json({ limit: "32kb" })); // corpo maior que isso aqui é abuso
app.use(cookieParser());

// Atrás de proxy (Render, Fly, nginx), req.ip vira o IP do proxy e
// o rate limit passaria a contar o mundo inteiro como uma pessoa
// só. Com isto o Express passa a ler o X-Forwarded-For.
if (process.env.CONFIAR_PROXY === "true") {
  app.set("trust proxy", 1);
}

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ----- Rotas -----

// Endpoint padrão de saúde. Serviços de deploy usam para saber se
// a instância pode receber tráfego — por isso ele checa as
// dependências de verdade em vez de só responder "ok".
app.get("/health", async (req, res) => {
  const saude = { status: "ok", banco: "conectado", redis: "conectado" };

  try {
    await pool.query("SELECT 1");
  } catch {
    saude.status = "erro";
    saude.banco = "indisponível";
  }

  try {
    await redis.ping();
  } catch {
    // Sem Redis o serviço fica lento, mas continua redirecionando
    // (o cache cai para o banco). Por isso "degradado" e não "erro".
    saude.status = saude.status === "erro" ? "erro" : "degradado";
    saude.redis = "indisponível";
  }

  res.status(saude.status === "ok" ? 200 : 503).json(saude);
});

app.use("/api/usuarios", rotasUsuarios);
app.use("/api/sessoes", rotasSessoes);
app.use("/api/links/:id/estatisticas", rotasEstatisticas);
app.use("/api/links", rotasLinks);

// Por último, e de propósito: esta rota casa com QUALQUER caminho
// de um nível só (/abc123). Se viesse antes, engoliria /health e
// /api. É a ordem de registro que separa as duas coisas.
app.use("/", rotasRedirecionar);

app.use((req, res) => {
  res.status(404).json({ erro: "Rota não encontrada" });
});

// ----- Tratamento de erro -----
// Middleware de erro tem 4 parâmetros. É assim que o Express o
// reconhece. Qualquer erro lançado nas rotas cai aqui.
app.use((erro, req, res, next) => {
  console.error("Erro não tratado:", erro);

  // res.headersSent: no redirecionamento a resposta já saiu antes
  // do trabalho de fundo. Tentar responder de novo lança outro
  // erro e derruba o processo.
  if (res.headersSent) return;

  res.status(500).json({ erro: "Erro interno do servidor" });
});

// Só sobe o servidor de verdade quando este arquivo é executado
// diretamente (node src/server.js). Um teste que importa `app`
// não deve abrir a porta 3002.
const executadoDiretamente = process.argv[1] === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  const PORTA = process.env.PORT || 3002;

  app.listen(PORTA, () => {
    console.log(`\nAPI rodando em http://localhost:${PORTA}`);
    console.log(`Saúde:  http://localhost:${PORTA}/health`);
    console.log(`Lembre do worker:  npm run worker\n`);
  });
}
