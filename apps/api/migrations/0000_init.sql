-- Negotiated Memory — initial schema
-- Mirrors src/db/schema.ts. Timestamps are unix milliseconds bound from Date.now().

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Better Auth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id         TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  user_id                  TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  INTEGER,
  refresh_token_expires_at INTEGER,
  scope                    TEXT,
  password                 TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- ---------------------------------------------------------------------------
-- Domain
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  label      TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_user_key ON projects(user_id, key);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  meta            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

-- A session-scoped memory belongs to a context. The chat app maps its conversation id
-- here server-side, so the model never sees or manages one.
CREATE TABLE IF NOT EXISTS contexts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  conversation_id TEXT,
  label           TEXT,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contexts_conversation ON contexts(user_id, conversation_id);

CREATE TABLE IF NOT EXISTS memories (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fact           TEXT NOT NULL,
  fact_fp        TEXT NOT NULL,
  category       TEXT,
  scope          TEXT NOT NULL CHECK (scope IN ('session','project','global','suppressed')),
  project_id     TEXT,
  context_id     TEXT,

  -- Denormalised mirror of the scope predicate. Generated, so it cannot drift from `scope`.
  -- Retrieval matches this single key instead of an OR — which is also the only form
  -- Cloudflare Vectorize can express, since it has no $or operator.
  scope_key      TEXT GENERATED ALWAYS AS (
                   CASE scope
                     WHEN 'global'  THEN 'global'
                     WHEN 'project' THEN 'proj:' || COALESCE(project_id, '')
                     WHEN 'session' THEN 'sess:' || COALESCE(context_id, '')
                     ELSE 'suppressed'
                   END) VIRTUAL,

  status         TEXT NOT NULL CHECK (status IN ('active','superseded','suppressed','expired')),
  confidence     REAL,
  origin_client  TEXT NOT NULL DEFAULT 'web',
  source_refs    TEXT,
  superseded_by  TEXT,
  negotiation_id TEXT UNIQUE,

  created_at     INTEGER NOT NULL,
  last_confirmed INTEGER,
  -- NOT NULL with a far-future sentinel so "not expired" is one indexable comparison
  -- in D1 and one $gt filter in Vectorize. Vectorize cannot filter on NULL.
  expires_at     INTEGER NOT NULL DEFAULT 4102444800000,

  index_state    TEXT NOT NULL DEFAULT 'pending'
                   CHECK (index_state IN ('pending','indexed','failed','tombstoned')),
  indexed_at     INTEGER,
  embed_model    TEXT
);
CREATE INDEX IF NOT EXISTS idx_mem_retrieval   ON memories(user_id, status, expires_at, scope_key);
CREATE INDEX IF NOT EXISTS idx_mem_fp          ON memories(user_id, fact_fp);
CREATE INDEX IF NOT EXISTS idx_mem_index_state ON memories(index_state, created_at);

-- Keyword retrieval. A standalone (not external-content) FTS5 table, kept in sync from
-- application code inside the same db.batch() as the memory write. Triggers would be the
-- usual choice, but their BEGIN...END bodies break wrangler's migration SQL splitter, and
-- an explicit write is easier to reason about than an invisible one.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  fact,
  tokenize = 'porter unicode61'
);

-- In-flight consent. A proposal lives here, never in `memories`, until a human accepts.
CREATE TABLE IF NOT EXISTS negotiations (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL DEFAULT 'web',
  conversation_id TEXT,
  fact            TEXT NOT NULL,
  fact_fp         TEXT NOT NULL,
  category        TEXT NOT NULL,
  options         TEXT NOT NULL,
  project_id      TEXT,
  context_id      TEXT,
  near_dup_id     TEXT,
  confidence      REAL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  outcome         TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  resolved_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_neg_pending ON negotiations(user_id, status, expires_at);

-- Stops the cancel loop: propose -> dismiss -> immediately re-propose.
CREATE TABLE IF NOT EXISTS negotiation_cooldowns (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  fact_fp TEXT NOT NULL,
  until   INTEGER NOT NULL,
  reason  TEXT,
  PRIMARY KEY (user_id, fact_fp)
);

-- Append-only. Powers the timeline: the "why does it think this?" answer.
CREATE TABLE IF NOT EXISTS memory_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id  TEXT,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  event      TEXT NOT NULL,
  from_value TEXT,
  to_value   TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_memory ON memory_events(memory_id, at);
CREATE INDEX IF NOT EXISTS idx_events_user   ON memory_events(user_id, at);
