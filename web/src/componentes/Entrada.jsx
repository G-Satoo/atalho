// ============================================================
// Tela de entrada: login e cadastro no mesmo formulário
//
// São os mesmos dois campos; separar em duas telas só obrigaria
// a pessoa a descobrir em qual das duas ela está.
// ============================================================

import { useState } from "react";

import { api } from "../api.js";

export default function Entrada({ aoEntrar }) {
  const [modo, setModo] = useState("entrar"); // "entrar" | "cadastrar"
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento) {
    // O padrão do formulário é recarregar a página inteira.
    evento.preventDefault();

    setErro(null);
    setEnviando(true);

    try {
      const dados =
        modo === "entrar"
          ? await api.entrar(email, senha)
          : await api.cadastrar(email, senha);

      aoEntrar(dados.usuario);
    } catch (erro) {
      setErro(erro.message);
    } finally {
      // No finally: sem isto, um erro deixaria o botão desativado
      // para sempre e a pessoa não conseguiria tentar de novo.
      setEnviando(false);
    }
  }

  return (
    <div className="cartao cartao-entrada">
      <div className="marca" style={{ marginBottom: 20 }}>
        atalho<span>.</span>
      </div>

      <form onSubmit={enviar}>
        {erro && <div className="erro">{erro}</div>}

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <label htmlFor="senha">Senha</label>
        <input
          id="senha"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          // Diz ao gerenciador de senhas se ele deve oferecer uma
          // senha nova ou a que já está guardada.
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
          required
        />

        <button type="submit" disabled={enviando} style={{ width: "100%" }}>
          {enviando ? "…" : modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <p style={{ textAlign: "center", fontSize: 13, marginBottom: 0 }}>
        <button
          className="discreto"
          style={{ border: "none", background: "none" }}
          onClick={() => {
            setModo(modo === "entrar" ? "cadastrar" : "entrar");
            setErro(null);
          }}
        >
          {modo === "entrar" ? "Não tem conta? Criar uma" : "Já tenho conta"}
        </button>
      </p>
    </div>
  );
}
