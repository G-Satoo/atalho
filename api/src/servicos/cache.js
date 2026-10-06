// ============================================================
// Cache dos destinos
//
// É a peça que faz o redirecionamento ser rápido: o caminho
// normal de um clique não toca o Postgres.
//
//   GET /:codigo -> Redis tem? redireciona
//                -> não tem?   consulta o banco, guarda, redireciona
//
// Um link curto é lido muito mais vezes do que escrito, e a
// resposta quase nunca muda. É o caso clássico de cache.
//
// Guardamos também o "não existe" (cache negativo). Sem isso,
// alguém varrendo códigos aleatórios faz cada requisição bater no
// banco — um jeito barato de derrubar o serviço. Com TTL curto,
// porque um código que não existe hoje pode ser criado amanhã.
// ============================================================

import { redis } from "../redis.js";

const PREFIXO = "link:";

const TTL = 60 * 60;        // 1 hora para link que existe
const TTL_NEGATIVO = 60;    // 1 minuto para código inexistente

const MARCA_NEGATIVA = "0";

/**
 * Procura no cache.
 *
 * Devolve:
 *   { destino, linkId }  achou
 *   "inexistente"        já sabemos que não existe
 *   null                 não está no cache, precisa consultar o banco
 *
 * Qualquer falha do Redis vira null: se o cache cai, o serviço
 * fica mais lento, não fora do ar.
 */
export async function buscar(codigo) {
  try {
    const valor = await redis.get(PREFIXO + codigo);

    if (valor === null) return null;
    if (valor === MARCA_NEGATIVA) return "inexistente";

    // Guardado como "id|destino" em vez de JSON: são dois campos
    // fixos, e o destino é o único que pode conter o separador —
    // por isso o split tem limite e o resto é remontado.
    const separador = valor.indexOf("|");
    return {
      linkId: Number(valor.slice(0, separador)),
      destino: valor.slice(separador + 1)
    };
  } catch {
    return null;
  }
}

export async function guardar(codigo, linkId, destino) {
  try {
    await redis.set(PREFIXO + codigo, `${linkId}|${destino}`, "EX", TTL);
  } catch {
    // Não conseguir cachear não é motivo para falhar o redirecionamento.
  }
}

export async function guardarInexistente(codigo) {
  try {
    await redis.set(PREFIXO + codigo, MARCA_NEGATIVA, "EX", TTL_NEGATIVO);
  } catch {
    // idem
  }
}

/**
 * Tira o código do cache. Precisa ser chamado sempre que o link
 * muda de destino, é desativado ou apagado — senão o Redis
 * continua mandando gente para o destino antigo por até uma hora.
 */
export async function invalidar(codigo) {
  try {
    await redis.del(PREFIXO + codigo);
  } catch {
    // idem
  }
}
