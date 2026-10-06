// ============================================================
// Lista de links e criação de link novo
// ============================================================

import { useEffect, useState } from "react";

import { api } from "../api.js";

export default function ListaLinks({ aoAbrir }) {
  const [links, setLinks] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  const [destino, setDestino] = useState("");
  const [codigo, setCodigo] = useState("");
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState(null);

  async function carregar() {
    try {
      const dados = await api.listarLinks();
      setLinks(dados.links);
      setErro(null);
    } catch (erro) {
      setErro(erro.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function criar(evento) {
    evento.preventDefault();
    setErro(null);
    setCriando(true);

    try {
      await api.criarLink({
        destino,
        // String vazia significa "gera um para mim" — mandar ""
        // seria um código inválido.
        codigo: codigo.trim() || undefined
      });

      setDestino("");
      setCodigo("");
      await carregar();
    } catch (erro) {
      setErro(erro.message);
    } finally {
      setCriando(false);
    }
  }

  async function copiar(link) {
    // A área de transferência só funciona em HTTPS ou localhost, e
    // o navegador pode negar a permissão. Sem o try, a tela
    // quebraria em vez de só não copiar.
    try {
      await navigator.clipboard.writeText(link.url_curta);
      setCopiado(link.id);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      setErro("Não consegui copiar — o link é " + link.url_curta);
    }
  }

  async function alternarAtivo(link) {
    await api.atualizarLink(link.id, { ativo: !link.ativo });
    await carregar();
  }

  async function apagar(link) {
    if (!confirm(`Apagar /${link.codigo}? Os cliques registrados vão junto.`)) return;

    await api.apagarLink(link.id);
    await carregar();
  }

  return (
    <>
      <form className="cartao" onSubmit={criar}>
        {erro && <div className="erro">{erro}</div>}

        <div className="linha-formulario">
          <div style={{ flex: 3 }}>
            <label htmlFor="destino">Link para encurtar</label>
            <input
              id="destino"
              type="url"
              placeholder="https://exemplo.com/uma/url/bem/comprida"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="codigo">Código (opcional)</label>
            <input
              id="codigo"
              placeholder="promo-2026"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          </div>

          <button type="submit" disabled={criando}>
            {criando ? "…" : "Encurtar"}
          </button>
        </div>
      </form>

      {carregando ? (
        <div className="vazio">Carregando…</div>
      ) : links.length === 0 ? (
        <div className="vazio">
          Nenhum link ainda. Cole uma URL aí em cima para criar o primeiro.
        </div>
      ) : (
        <div className="lista">
          {links.map((link) => (
            <div key={link.id} className={`item ${link.ativo ? "" : "desativado"}`}>
              <div className="item-principal">
                <button
                  className="codigo"
                  onClick={() => copiar(link)}
                  title="Clique para copiar"
                >
                  /{link.codigo} {copiado === link.id ? "✓ copiado" : ""}
                </button>

                <div className="destino">{link.titulo || link.destino}</div>
              </div>

              <div className="contador">
                {link.cliques}
                <small>cliques</small>
              </div>

              <button className="discreto" onClick={() => aoAbrir(link)}>
                Ver
              </button>

              <button className="discreto" onClick={() => alternarAtivo(link)}>
                {link.ativo ? "Pausar" : "Ativar"}
              </button>

              <button className="discreto" onClick={() => apagar(link)}>
                Apagar
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
