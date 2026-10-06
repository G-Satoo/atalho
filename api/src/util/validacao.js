// ============================================================
// Validação de entrada
//
// Tudo que chega em req.body é texto que um desconhecido
// escreveu. Cada função aqui devolve null quando está tudo bem
// ou a mensagem de erro — o mesmo formato em todas para as rotas
// poderem encadear sem pensar.
// ============================================================

// Não existe regex que valide e-mail de verdade (a gramática do
// RFC 5322 é maior do que parece, e mesmo um endereço válido pode
// não existir). Esta só barra o que é claramente lixo; quem
// confirma o endereço de fato é um e-mail de verificação.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarEmail(email) {
  if (typeof email !== "string" || email.trim() === "") {
    return "Informe o e-mail";
  }

  if (!FORMATO_EMAIL.test(email.trim())) {
    return "E-mail inválido";
  }

  return null;
}

export function validarSenha(senha) {
  if (typeof senha !== "string" || senha === "") {
    return "Informe a senha";
  }

  if (senha.length < 8) {
    return "A senha precisa de pelo menos 8 caracteres";
  }

  // scrypt processa a senha inteira; sem teto, uma senha de 10 MB
  // vira um jeito barato de ocupar CPU do servidor.
  if (senha.length > 200) {
    return "A senha é longa demais";
  }

  return null;
}

/**
 * Valida a URL de destino.
 *
 * Só http e https: `javascript:` e `data:` executam código no
 * navegador de quem clica, o que transformaria o encurtador em
 * ferramenta de ataque — e é por isso que encurtadores são
 * bloqueados por aí quando não filtram isso.
 */
export function validarDestino(destino) {
  if (typeof destino !== "string" || destino.trim() === "") {
    return "Informe o link de destino";
  }

  if (destino.length > 2000) {
    return "O link de destino é longo demais";
  }

  let url;
  try {
    url = new URL(destino.trim());
  } catch {
    return "Link inválido — inclua http:// ou https://";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Só aceitamos links http:// ou https://";
  }

  return null;
}

/**
 * Lê um inteiro de query string com limites. Query string sempre
 * chega como texto — ou como array, se o parâmetro vier repetido
 * na URL, e aí Number() de um array daria NaN silencioso.
 */
export function lerInteiro(valor, { padrao, minimo, maximo }) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  if (typeof valor !== "string") return padrao;

  // A regex antes do Number() não é redundante: Number("1e5") é
  // 100000 e Number("0x10") é 16 — ambos passariam por
  // Number.isInteger. Quem digita isso numa query string não está
  // pedindo uma página, está testando o parser.
  if (!/^-?\d+$/.test(valor.trim())) return padrao;

  const numero = Number(valor);

  if (!Number.isInteger(numero)) return padrao;
  if (numero < minimo) return minimo;
  if (numero > maximo) return maximo;

  return numero;
}
