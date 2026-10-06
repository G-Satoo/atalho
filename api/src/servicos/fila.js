// ============================================================
// Fila de cliques (produtor)
//
// O redirecionamento não grava nada no banco. Ele joga um evento
// aqui e responde o 302 na mesma hora; quem grava é o worker
// (src/worker.js), em outro processo.
//
// Por que não inserir direto no Postgres:
//
//   - Latência. O redirecionamento é a única parte do sistema que
//     a pessoa espera de verdade. Um INSERT coloca o banco no
//     caminho crítico de todo clique.
//   - Pico. Um link que viraliza multiplica os cliques por mil de
//     um minuto para o outro. A fila absorve o pico e o worker
//     grava no ritmo que o banco aguenta, em lote.
//   - Falha. Banco fora do ar com INSERT direto = clique perdido
//     ou erro para quem clicou. Com fila, o evento fica lá e é
//     reprocessado quando o banco volta.
//
// Usamos BullMQ em vez de escrever a fila na mão porque as partes
// difíceis não são o "push/pop": é retry com espera crescente,
// job que morreu no meio do processamento e precisa voltar, e
// fila de descartados. BullMQ resolve isso em cima do Redis.
// ============================================================

import { Queue } from "bullmq";
import { criarConexaoRedis } from "../redis.js";

export const NOME_FILA = "cliques";

// Conexão própria, separada da que serve cache e sessão.
const conexao = criarConexaoRedis();

export const filaCliques = new Queue(NOME_FILA, {
  connection: conexao,

  defaultJobOptions: {
    // Tenta 5 vezes, esperando 1s, 2s, 4s, 8s entre elas. Se o
    // Postgres estiver reiniciando, a fila se recupera sozinha.
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },

    // Sem isto o Redis guarda todo job concluído para sempre e a
    // memória cresce sem parar. Mantemos uma amostra recente para
    // dar para inspecionar o que aconteceu.
    removeOnComplete: { count: 1000 },

    // Os que falharam ficam mais tempo: são eles que você vai
    // querer olhar quando algo der errado.
    removeOnFail: { count: 5000 }
  }
});

/**
 * Enfileira um clique.
 *
 * Nunca lança: se o Redis cair, é melhor perder a estatística do
 * que quebrar o redirecionamento de quem clicou. O clique é o
 * produto; o número dele é o relatório.
 */
export async function registrarClique(evento) {
  try {
    await filaCliques.add("clique", evento);
  } catch (erro) {
    console.error("Não foi possível enfileirar o clique:", erro.message);
  }
}

export async function fecharFila() {
  await filaCliques.close();
  await conexao.quit();
}
