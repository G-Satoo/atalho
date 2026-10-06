// ============================================================
// Geração do código curto
//
// O código é o que vai depois da barra: atl.ho/<codigo>.
// ============================================================

import { randomInt } from "node:crypto";

// Sem 0/O/1/l/I: são os pares que as pessoas erram ao copiar um
// link de um papel ou de um slide. Perder 5 caracteres do
// alfabeto custa pouco (57^7 ainda são 1,9 quatrilhões de
// combinações) e evita um suporte inteiro de "o link não abre".
const ALFABETO = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

export const TAMANHO_PADRAO = 7;

/**
 * Gera um código aleatório.
 *
 * randomInt do node:crypto, e não Math.random(): Math.random é
 * previsível a partir de saídas anteriores. Com ela, alguém que
 * criasse alguns links conseguiria adivinhar os códigos gerados
 * em seguida para outras pessoas — e links curtos costumam
 * apontar para coisas que não são públicas.
 */
export function gerarCodigo(tamanho = TAMANHO_PADRAO) {
  let codigo = "";

  for (let i = 0; i < tamanho; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }

  return codigo;
}

// Códigos personalizados são mais permissivos que os gerados
// (aceitam qualquer letra, número, hífen e sublinhado), mas não
// podem colidir com as rotas da API nem com arquivos que o
// navegador pede sozinho.
const RESERVADOS = new Set([
  "api", "health", "admin", "painel", "login", "entrar", "sair",
  "cadastro", "assets", "static", "favicon.ico", "robots.txt"
]);

const FORMATO_PERSONALIZADO = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Valida um código escolhido pelo usuário. Devolve null se estiver
 * ok, ou a mensagem de erro.
 */
export function validarCodigoPersonalizado(codigo) {
  if (!FORMATO_PERSONALIZADO.test(codigo)) {
    return "O código deve ter de 3 a 32 caracteres, usando apenas letras, números, hífen e sublinhado";
  }

  if (RESERVADOS.has(codigo.toLowerCase())) {
    return "Este código é reservado pelo sistema";
  }

  return null;
}
