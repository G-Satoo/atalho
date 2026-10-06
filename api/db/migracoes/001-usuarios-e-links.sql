-- ============================================================
-- 001 - Usuarios e links
--
-- Primeira migracao: o minimo para alguem se cadastrar e
-- encurtar uma URL.
-- ============================================================

CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,

  -- CITEXT seria mais elegante para e-mail (comparacao sem
  -- diferenciar maiuscula), mas exige extensao. Guardamos sempre
  -- em minusculo pela aplicacao e o UNIQUE resolve.
  email       TEXT        NOT NULL UNIQUE,

  -- Nunca a senha em si. O formato guardado e
  -- "scrypt$<salt em hex>$<hash em hex>" - ver src/servicos/senha.js.
  senha_hash  TEXT        NOT NULL,

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE links (
  id          SERIAL PRIMARY KEY,

  -- ON DELETE CASCADE: apagar o usuario apaga os links dele.
  usuario_id  INTEGER     NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  -- O pedaco que vai depois da barra: atl.ho/<codigo>.
  -- UNIQUE no banco e a unica garantia real contra dois links com
  -- o mesmo codigo; checar antes de inserir nao basta, porque duas
  -- requisicoes simultaneas passariam na checagem juntas.
  codigo      TEXT        NOT NULL UNIQUE,

  destino     TEXT        NOT NULL,
  titulo      TEXT,

  -- Link desativado responde 410 em vez de redirecionar. Preferimos
  -- desativar a apagar: os cliques ja registrados continuam fazendo
  -- sentido no historico.
  ativo       BOOLEAN     NOT NULL DEFAULT TRUE,

  -- NULL = nao expira.
  expira_em   TIMESTAMPTZ,

  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A tela do painel lista "meus links, do mais novo para o mais
-- velho". Sem este indice isso vira varredura na tabela inteira.
CREATE INDEX idx_links_usuario ON links (usuario_id, criado_em DESC);
