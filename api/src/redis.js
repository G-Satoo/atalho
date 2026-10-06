// ============================================================
// Conexão com o Redis
//
// O Redis faz quatro trabalhos diferentes neste projeto:
//
//   cache:código -> destino     (o redirecionamento não toca o banco)
//   sessao:<token> -> usuário   (login sem JWT, e revogável)
//   limite:<chave>              (rate limit)
//   a fila de cliques           (BullMQ, ver servicos/fila.js)
//
// Tudo no mesmo servidor, separado por prefixo na chave. Em
// produção de verdade a fila costuma ir para uma instância
// própria, porque um cache cheio despejando chaves não pode
// arrastar a fila junto.
// ============================================================

import Redis from "ioredis";
import "dotenv/config";

export const URL_REDIS = process.env.REDIS_URL || "redis://localhost:6380";

/**
 * Cria uma conexão nova.
 *
 * O BullMQ exige conexões separadas das suas (um cliente que está
 * bloqueado esperando trabalho na fila não consegue responder a um
 * GET de cache no meio), então não dá para ter só uma global.
 *
 * maxRetriesPerRequest: null é exigência do BullMQ — com um número,
 * ele desiste de comandos bloqueantes que são justamente como o
 * worker espera por trabalho.
 */
export function criarConexaoRedis(opcoes = {}) {
  return new Redis(URL_REDIS, {
    maxRetriesPerRequest: null,
    // Sem isso o ioredis enfileira comandos enquanto está sem
    // conexão e eles só falham lá na frente, mascarando um Redis
    // fora do ar como se fosse lentidão.
    enableOfflineQueue: false,
    ...opcoes
  });
}

// A conexão de uso geral da API (cache, sessão, rate limit).
export const redis = criarConexaoRedis();

// Sem este handler, um erro de conexão derruba o processo inteiro.
// O Redis aqui é auxiliar: se ele cair, o redirecionamento ainda
// funciona indo direto ao Postgres (ver servicos/cache.js).
redis.on("error", (erro) => {
  console.error("Redis:", erro.message);
});
