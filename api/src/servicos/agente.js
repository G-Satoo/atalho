// ============================================================
// Leitura do User-Agent
//
// Transforma a string que o navegador manda em três campos que o
// painel consegue agrupar. Roda no worker, não no
// redirecionamento — é trabalho de CPU que não precisa acontecer
// enquanto alguém espera o 302.
//
// User-Agent é palpite, não fato: navegadores mentem por
// compatibilidade histórica (é por isso que quase todos se dizem
// "Mozilla"), e dá para mandar qualquer coisa ali. Serve para
// saber se o público é mais de celular ou de computador, não para
// decisão que precise de precisão.
// ============================================================

import { UAParser } from "ua-parser-js";

export function lerAgente(userAgent) {
  if (!userAgent) {
    return { dispositivo: null, navegador: null, sistema: null };
  }

  const { browser, os, device } = UAParser(userAgent);

  // A biblioteca só preenche device.type quando NÃO é desktop —
  // computador é a ausência de tipo, não um valor.
  let dispositivo = "computador";
  if (device.type === "mobile") dispositivo = "celular";
  else if (device.type === "tablet") dispositivo = "tablet";

  return {
    dispositivo,
    navegador: browser.name || null,
    sistema: os.name || null
  };
}

/**
 * Do Referer guardamos só o host.
 *
 * A URL completa da página de origem costuma ter dado pessoal em
 * query string (busca, token, id de sessão de outro site) e nós
 * não precisamos disso — a pergunta que o painel responde é "de
 * onde vem meu tráfego", e "google.com" já responde.
 */
export function lerOrigem(referer) {
  if (!referer) return null;

  try {
    return new URL(referer).host || null;
  } catch {
    return null;
  }
}
