// ============================================================
// Raiz do painel
//
// Decide entre três telas: entrada (login/cadastro), lista de
// links e detalhe de um link. Sem biblioteca de rotas — são três
// estados, e uma dependência a mais aqui não pagaria o que
// resolve.
// ============================================================

import { useEffect, useState } from "react";

import { api, ErroApi } from "./api.js";
import Entrada from "./componentes/Entrada.jsx";
import ListaLinks from "./componentes/ListaLinks.jsx";
import DetalheLink from "./componentes/DetalheLink.jsx";

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [linkAberto, setLinkAberto] = useState(null);

  // Ao abrir, pergunta à API quem está logado. O cookie é
  // httpOnly: o JavaScript não consegue ler a sessão, então a
  // única forma de saber é perguntando.
  useEffect(() => {
    api
      .eu()
      .then((dados) => setUsuario(dados.usuario))
      .catch((erro) => {
        // 401 aqui é o normal de quem ainda não entrou, não um
        // problema para mostrar na tela.
        if (!(erro instanceof ErroApi) || erro.status !== 401) {
          console.error(erro);
        }
      })
      .finally(() => setCarregando(false));
  }, []);

  async function sair() {
    await api.sair();
    setUsuario(null);
    setLinkAberto(null);
  }

  if (carregando) {
    return <div className="vazio">Carregando…</div>;
  }

  if (!usuario) {
    return <Entrada aoEntrar={setUsuario} />;
  }

  return (
    <>
      <header className="cabecalho">
        <div className="marca">
          atalho<span>.</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--texto-fraco)", fontSize: 13 }}>
            {usuario.email}
          </span>
          <button className="discreto" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      <main className="conteudo">
        {linkAberto ? (
          <DetalheLink link={linkAberto} aoVoltar={() => setLinkAberto(null)} />
        ) : (
          <ListaLinks aoAbrir={setLinkAberto} />
        )}
      </main>
    </>
  );
}
