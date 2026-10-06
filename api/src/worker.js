// ============================================================
// Worker de cliques (consumidor da fila)
//
// Rode com:  npm run worker
//
// Processo separado da API, de propósito: ele pode ser reiniciado,
// escalado ou ficar minutos parado sem que ninguém deixe de ser
// redirecionado. A fila segura os eventos enquanto isso.
//
// O que ele faz com cada clique:
//   1. lê o User-Agent e transforma em dispositivo/navegador/sistema
//   2. junta com outros cliques que chegaram junto
//   3. grava o lote no Postgres num INSERT só
//
// Por que em lote: 500 cliques em 500 INSERTs são 500 idas e
// voltas ao banco. Num INSERT com 500 linhas é uma. A diferença
// aparece exatamente quando importa, que é no pico.
// ============================================================

import { Worker } from "bullmq";
import "dotenv/config";

import { pool } from "../db/pool.js";
import { criarConexaoRedis } from "./redis.js";
import { NOME_FILA } from "./servicos/fila.js";
import { lerAgente, lerOrigem } from "./servicos/agente.js";

// Quantos cliques agrupar antes de gravar, e quanto tempo esperar
// no máximo por eles. O prazo existe para o movimento fraco: com
// três cliques por minuto, esperar encher um lote de 100 deixaria
// o painel horas atrasado.
const TAMANHO_LOTE = 100;
const PRAZO_LOTE_MS = 2000;

let lote = [];
let cronometro = null;

// Cada job fica com a sua promessa: o BullMQ só pode marcar o job
// como concluído depois que a linha estiver no Postgres. Se
// respondêssemos "ok" ao receber, um worker que morresse antes de
// gravar perderia os cliques em silêncio — e é justamente isso
// que a fila existe para evitar.
let pendentes = [];

/**
 * Grava o lote acumulado.
 *
 * Monta um INSERT com N linhas usando placeholders numerados
 * ($1,$2,$3...) — os valores continuam sendo parâmetros, nada é
 * concatenado no SQL.
 */
async function gravarLote() {
  if (cronometro) {
    clearTimeout(cronometro);
    cronometro = null;
  }

  if (lote.length === 0) return;

  // Troca as listas ANTES do await: enquanto o INSERT roda, novos
  // jobs continuam chegando e precisam ir para o próximo lote, não
  // para este que já está sendo gravado.
  const linhas = lote;
  const aguardando = pendentes;
  lote = [];
  pendentes = [];

  const valores = [];
  const grupos = linhas.map((linha, indice) => {
    const base = indice * 6;
    valores.push(
      linha.linkId, linha.ocorridoEm, linha.dispositivo,
      linha.navegador, linha.sistema, linha.origem
    );

    // Os tipos vão explícitos na primeira linha porque, dentro de um
    // VALUES usado como subconsulta, o Postgres não tem coluna de
    // destino para inferir o tipo de um parâmetro. As demais linhas
    // herdam os tipos desta.
    const tipos = indice === 0
      ? ["::int", "::timestamptz", "::text", "::text", "::text", "::text"]
      : ["", "", "", "", "", ""];

    return `($${base + 1}${tipos[0]}, $${base + 2}${tipos[1]}, $${base + 3}${tipos[2]}, ` +
           `$${base + 4}${tipos[3]}, $${base + 5}${tipos[4]}, $${base + 6}${tipos[5]})`;
  });

  try {
    // O WHERE EXISTS descarta, dentro do próprio INSERT, os cliques
    // cujo link já não existe.
    //
    // Por que isso é necessário: entre o clique entrar na fila e o
    // worker gravá-lo passam segundos — e nesse intervalo o dono pode
    // ter apagado o link. Aí a chave estrangeira link_id recusa a
    // linha, e como o lote é um INSERT só, a recusa de UMA linha
    // derrubava as outras 99 junto. Um clique órfão envenenava o
    // lote inteiro, e cliques legítimos acabavam em "failed".
    //
    // Descartar é a resposta certa aqui: o link foi apagado e, com
    // ele, todo o histórico dele (ON DELETE CASCADE). Guardar a
    // estatística de algo que não existe mais não serviria a ninguém.
    const resultado = await pool.query(
      `INSERT INTO cliques
         (link_id, ocorrido_em, dispositivo, navegador, sistema, origem)
       SELECT v.link_id, v.ocorrido_em, v.dispositivo, v.navegador, v.sistema, v.origem
         FROM (VALUES ${grupos.join(", ")})
              AS v(link_id, ocorrido_em, dispositivo, navegador, sistema, origem)
        WHERE EXISTS (SELECT 1 FROM links l WHERE l.id = v.link_id)`,
      valores
    );

    for (const job of aguardando) job.resolver();

    const descartados = linhas.length - resultado.rowCount;
    console.log(
      `${resultado.rowCount} clique(s) gravado(s)` +
      (descartados > 0 ? ` (${descartados} de link apagado, descartado(s))` : "")
    );
  } catch (erro) {
    console.error("Falha ao gravar lote:", erro.message);

    // Sobrou para cá o que não é esperado — banco fora do ar, por
    // exemplo. O lote inteiro falha e o BullMQ tenta de novo, com
    // espera crescente (ver servicos/fila.js). Gravar duas vezes o
    // mesmo clique é possível numa falha parcial rara; para contagem
    // de acesso isso é aceitável, e o custo de evitar (chave de
    // idempotência por clique) não se paga aqui.
    for (const job of aguardando) job.rejeitar(erro);
  }
}

const conexao = criarConexaoRedis();

export const worker = new Worker(
  NOME_FILA,
  async (job) => {
    const { linkId, ocorridoEm, userAgent, referer } = job.data;
    const agente = lerAgente(userAgent);

    return new Promise((resolver, rejeitar) => {
      lote.push({
        linkId,
        ocorridoEm,
        dispositivo: agente.dispositivo,
        navegador: agente.navegador,
        sistema: agente.sistema,
        origem: lerOrigem(referer)
      });
      pendentes.push({ resolver, rejeitar });

      if (lote.length >= TAMANHO_LOTE) {
        gravarLote();
      } else if (!cronometro) {
        // O primeiro do lote dá a partida no relógio.
        cronometro = setTimeout(gravarLote, PRAZO_LOTE_MS);
      }
    });
  },
  {
    connection: conexao,

    // Sem isto o BullMQ processa um job por vez e o lote nunca
    // encheria — cada job ficaria esperando o anterior, que está
    // esperando o lote, que está esperando jobs. Trava de verdade.
    concurrency: TAMANHO_LOTE * 2
  }
);

worker.on("failed", (job, erro) => {
  console.error(`Job ${job?.id} falhou:`, erro.message);
});

/**
 * Desliga o worker com cuidado: para de aceitar trabalho novo,
 * grava o lote que ficou em aberto e fecha as conexões.
 *
 * Exportado porque quem desliga não é só o Ctrl+C — os testes de
 * integração também precisam encerrar sem deixar conexão aberta
 * segurando o processo.
 */
export async function encerrar() {
  await worker.close();
  await gravarLote();
  await conexao.quit();
}

console.log("Worker de cliques rodando. Ctrl+C para parar.");

// ----- Desligar com cuidado -----
// Ctrl+C ou o "docker stop" mandam um sinal. Sem tratar, o
// processo morre na hora e o que estava no lote (já tirado da
// fila, ainda não gravado) some. Aqui ele para de aceitar
// trabalho novo, grava o que tem e só então sai.
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    console.log(`\n${sinal} recebido, finalizando o lote em aberto...`);

    await encerrar();
    await pool.end();

    process.exit(0);
  });
}
