-- OAuth 2.1 authorization server + JWT signing keys
--
-- Mirrors the tables added to src/db/schema.ts for @better-auth/oauth-provider and
-- better-auth's jwt plugin. This is what lets an external MCP client hold a scoped,
-- audience-locked access token instead of a session cookie.
--
-- Array and JSON columns are TEXT: better-auth's Drizzle adapter reports
-- `supportsJSON: false` / `supportsArrays: false` for every provider but Postgres, so it
-- JSON-encodes those values itself. Timestamps are stored the same way as the Better Auth
-- core tables above — unix milliseconds via `integer({ mode: "timestamp" })`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_client (
  id                          TEXT PRIMARY KEY,
  client_id                   TEXT NOT NULL UNIQUE,
  client_secret               TEXT,
  disabled                    INTEGER DEFAULT 0,
  skip_consent                INTEGER,
  enable_end_session          INTEGER,
  subject_type                TEXT,
  scopes                      TEXT,
  user_id                     TEXT REFERENCES user(id) ON DELETE CASCADE,
  created_at                  INTEGER,
  updated_at                  INTEGER,
  name                        TEXT,
  uri                         TEXT,
  icon                        TEXT,
  contacts                    TEXT,
  tos                         TEXT,
  policy                      TEXT,
  software_id                 TEXT,
  software_version            TEXT,
  software_statement          TEXT,
  redirect_uris               TEXT NOT NULL,
  post_logout_redirect_uris   TEXT,
  token_endpoint_auth_method  TEXT,
  grant_types                 TEXT,
  response_types              TEXT,
  is_public                   INTEGER,
  type                        TEXT,
  require_pkce                INTEGER,
  reference_id                TEXT,
  metadata                    TEXT
);
CREATE INDEX IF NOT EXISTS idx_oauth_client_user ON oauth_client(user_id);

CREATE TABLE IF NOT EXISTS oauth_refresh_token (
  id           TEXT PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  client_id    TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  session_id   TEXT REFERENCES session(id) ON DELETE SET NULL,
  user_id      TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  reference_id TEXT,
  expires_at   INTEGER,
  created_at   INTEGER,
  revoked      INTEGER,
  auth_time    INTEGER,
  scopes       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_client  ON oauth_refresh_token(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_session ON oauth_refresh_token(session_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_user    ON oauth_refresh_token(user_id);

CREATE TABLE IF NOT EXISTS oauth_access_token (
  id           TEXT PRIMARY KEY,
  token        TEXT UNIQUE,
  client_id    TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  session_id   TEXT REFERENCES session(id) ON DELETE SET NULL,
  user_id      TEXT REFERENCES user(id) ON DELETE CASCADE,
  reference_id TEXT,
  refresh_id   TEXT REFERENCES oauth_refresh_token(id) ON DELETE CASCADE,
  expires_at   INTEGER,
  created_at   INTEGER,
  scopes       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_client  ON oauth_access_token(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_session ON oauth_access_token(session_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_user    ON oauth_access_token(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_refresh ON oauth_access_token(refresh_id);

CREATE TABLE IF NOT EXISTS oauth_consent (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES user(id) ON DELETE CASCADE,
  reference_id TEXT,
  scopes       TEXT NOT NULL,
  created_at   INTEGER,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oauth_consent_client ON oauth_consent(client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_consent_user   ON oauth_consent(user_id);

CREATE TABLE IF NOT EXISTS jwks (
  id          TEXT PRIMARY KEY,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER
);
