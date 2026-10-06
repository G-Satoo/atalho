// ============================================================
// Detalhe de um link: números e gráficos
// ============================================================

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { api } from "../api.js";

const PERIODOS = [7, 30, 90];

export default function DetalheLink({ link, aoVoltar }) {
  const [dados, setDados] = useState(null);
  const [dias, setDias] = useState(30);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let atual = true;

    api
      .estatisticas(link.id, dias)
      .then((resposta) => {
        // Trocar de período rápido dispara duas buscas; sem esta
        // guarda, a resposta antiga pode chegar depois da nova e
        // sobrescrever a tela com o período errado.
        if (atual) setDados(resposta);
      })
      .catch((erro) => atual && setErro(erro.message));

    return () => {
      atual = false;
    };
  }, [link.id, dias]);

  if (erro) return <div className="erro">{erro}</div>;
  if (!dados) return <div className="vazio">Carregando…</div>;

  const porDia = dados.por_dia.map((ponto) => ({
    ...ponto,
    // "22/09" em vez de "2026-09-22": o eixo tem pouco espaço e o
    // ano é o mesmo em todos os pontos.
    rotulo: new Date(ponto.dia).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit"
    })
  }));

  const totalPeriodo = dados.totais.cliques_periodo;
  const mediaDiaria = (totalPeriodo / dados.dias).toFixed(1);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <button className="discreto" onClick={aoVoltar}>
          ← Voltar
        </button>

        <strong style={{ fontFamily: "var(--mono)" }}>/{link.codigo}</strong>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {PERIODOS.map((opcao) => (
            <button
              key={opcao}
              className={opcao === dias ? "" : "discreto"}
              onClick={() => setDias(opcao)}
            >
              {opcao}d
            </button>
          ))}
        </div>
      </div>

      <div className="destino" style={{ marginBottom: 8 }}>
        {link.titulo ? `${link.titulo} — ` : ""}
        <a href={link.destino} target="_blank" rel="noreferrer noopener">
          {link.destino}
        </a>
      </div>

      <div className="cartoes-numero">
        <div className="numero">
          <div className="valor">{dados.totais.cliques}</div>
          <div className="rotulo">cliques no total</div>
        </div>

        <div className="numero">
          <div className="valor">{totalPeriodo}</div>
          <div className="rotulo">nos últimos {dados.dias} dias</div>
        </div>

        <div className="numero">
          <div className="valor">{mediaDiaria}</div>
          <div className="rotulo">média por dia</div>
        </div>

        <div className="numero">
          <div className="valor" style={{ fontSize: 15, paddingTop: 8 }}>
            {dados.totais.ultimo_clique
              ? new Date(dados.totais.ultimo_clique).toLocaleString("pt-BR")
              : "—"}
          </div>
          <div className="rotulo">último clique</div>
        </div>
      </div>

      <div className="graficos">
        <div className="cartao grafico-largo">
          <h2 className="titulo-secao">Cliques por dia</h2>

          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={porDia} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#2f3541" vertical={false} />

              {/* interval="preserveStartEnd": com 90 dias, mostrar
                  toda data vira uma mancha preta ilegível. */}
              <XAxis
                dataKey="rotulo"
                stroke="#99a1b3"
                fontSize={11}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis stroke="#99a1b3" fontSize={11} tickLine={false} allowDecimals={false} />

              <Tooltip
                contentStyle={{
                  background: "#242832",
                  border: "1px solid #2f3541",
                  borderRadius: 8
                }}
                labelStyle={{ color: "#99a1b3" }}
                formatter={(valor) => [valor, "cliques"]}
              />

              <Area
                type="monotone"
                dataKey="cliques"
                stroke="#4ea3ff"
                fill="#4ea3ff"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="cartao">
          <h2 className="titulo-secao">Dispositivos</h2>

          {dados.por_dispositivo.length === 0 ? (
            <div className="vazio" style={{ padding: 24 }}>
              Sem cliques no período
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={dados.por_dispositivo}
                layout="vertical"
                margin={{ left: 20, right: 12 }}
              >
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="dispositivo"
                  stroke="#99a1b3"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={80}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{
                    background: "#242832",
                    border: "1px solid #2f3541",
                    borderRadius: 8
                  }}
                  formatter={(valor) => [valor, "cliques"]}
                />
                <Bar dataKey="cliques" fill="#48c78e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="cartao">
          <h2 className="titulo-secao">De onde vieram</h2>

          {dados.por_origem.length === 0 ? (
            <div className="vazio" style={{ padding: 24 }}>
              Sem cliques no período
            </div>
          ) : (
            dados.por_origem.map((origem) => (
              <div key={origem.origem} className="barra-origem">
                <span>{origem.origem}</span>
                <span>{origem.cliques}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
