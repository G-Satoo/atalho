-- ============================================================
-- 002 - Cliques
--
-- Uma linha por acesso. E a tabela que mais cresce no projeto -
-- por isso nada aqui e escrito na hora do redirecionamento; quem
-- insere e o worker, em lote, lendo da fila.
-- ============================================================

CREATE TABLE cliques (
  id            BIGSERIAL PRIMARY KEY,

  link_id       INTEGER     NOT NULL REFERENCES links(id) ON DELETE CASCADE,

  -- Quando o clique aconteceu de verdade (carimbado no
  -- redirecionamento), nao quando o worker gravou. A diferenca e
  -- pequena, mas se a fila atrasar o grafico continua correto.
  ocorrido_em   TIMESTAMPTZ NOT NULL,

  -- Derivados do User-Agent pelo worker. Guardamos o resultado
  -- pronto em vez do User-Agent cru porque o painel so agrupa por
  -- isso, e a string crua e grande e quase sempre repetida.
  dispositivo   TEXT,   -- celular | tablet | computador
  navegador     TEXT,
  sistema       TEXT,

  -- So o host do Referer ("google.com"), nao a URL inteira: a URL
  -- completa costuma carregar dado pessoal em query string.
  origem        TEXT
);

-- Todo grafico do painel e "cliques deste link, neste periodo".
CREATE INDEX idx_cliques_link ON cliques (link_id, ocorrido_em DESC);
