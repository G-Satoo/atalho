// ============================================================
// Conversa com a API
//
// Um lugar só para montar requisição e tratar erro. Sem isto,
// cada componente repete fetch, JSON.stringify e checagem de
// status — e cada um trata erro de um jeito diferente.
// ============================================================

const BASE = import.meta.env.VITE_API || "http://localhost:3002";

/**
 * Erro com o status HTTP junto, para quem chama conseguir
 * diferenciar "não está logado" (401) de "deu ruim" sem ler
 * mensagem de texto.
 */
export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.status = status;
  }
}

async function pedir(metodo, caminho, corpo) {
  let resposta;

  try {
    resposta = await fetch(BASE + caminho, {
      method: metodo,
      headers: corpo === undefined ? {} : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),

      // Sem isto o navegador não manda o cookie de sessão para
      // outra porta, e tudo responde 401. É o par do
      // credentials: true no CORS da API.
      credentials: "include"
    });
  } catch {
    // fetch só lança quando nem chegou a falar com o servidor.
    throw new ErroApi("Não consegui falar com a API. Ela está rodando?", 0);
  }

  if (resposta.status === 204) return null;

  let dados = null;
  if (resposta.headers.get("content-type")?.includes("application/json")) {
    dados = await resposta.json();
  }

  if (!resposta.ok) {
    throw new ErroApi(dados?.erro ?? "Erro inesperado", resposta.status);
  }

  return dados;
}

export const api = {
  cadastrar: (email, senha) => pedir("POST", "/api/usuarios", { email, senha }),
  entrar: (email, senha) => pedir("POST", "/api/sessoes", { email, senha }),
  sair: () => pedir("DELETE", "/api/sessoes"),
  eu: () => pedir("GET", "/api/usuarios/eu"),

  listarLinks: () => pedir("GET", "/api/links"),
  criarLink: (dados) => pedir("POST", "/api/links", dados),
  atualizarLink: (id, dados) => pedir("PATCH", `/api/links/${id}`, dados),
  apagarLink: (id) => pedir("DELETE", `/api/links/${id}`),

  estatisticas: (id, dias = 30) =>
    pedir("GET", `/api/links/${id}/estatisticas?dias=${dias}`)
};
