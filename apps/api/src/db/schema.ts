import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import { NEVER_EXPIRES } from "@workspace/shared/memory"

// ---------------------------------------------------------------------------
// Better Auth core tables
//
// Names and columns are fixed by Better Auth's Drizzle adapter — do not rename.
// Dates are `integer({ mode: "timestamp" })`; booleans `integer({ mode: "boolean" })`.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
})

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("idx_session_user").on(t.userId)]
)

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("idx_account_user").on(t.userId)]
)

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (t) => [index("idx_verification_identifier").on(t.identifier)]
)

// ---------------------------------------------------------------------------
// Domain
//
// Timestamps are unix milliseconds bound from `Date.now()`. SQLite has no date type,
// and D1 does not publish its SQLite version, so `unixepoch()` (3.38+) is unsafe to
// assume. Binding from JS also lets one `now` reach both D1 and Vectorize in a request.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Better Auth OAuth provider + JWT plugin tables
//
// Shapes are fixed by @better-auth/oauth-provider's schema and better-auth's jwt plugin —
// do not rename the exported keys, which the Drizzle adapter matches against the plugins'
// model names. Column names are ours.
//
// `string[]` and `json` fields are TEXT: the Drizzle adapter sets `supportsJSON: false` and
// `supportsArrays: false` for every provider except Postgres, so it JSON-encodes those
// values on the way in and decodes them on the way out. Storing them as anything else would
// double-encode.
//
// This is the agent plane's identity. It exists so an external MCP client can be issued a
// scoped, audience-locked access token — never a session cookie, which is what keeps the
// consent gate in `negotiations` reachable only by a human. See src/middleware/auth.ts.
// ---------------------------------------------------------------------------

export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    /** Hashed. Absent for public clients (CLIs, desktop apps), which use PKCE instead. */
    clientSecret: text("client_secret"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    public: integer("is_public", { mode: "boolean" }),
    type: text("type"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (t) => [index("idx_oauth_client_user").on(t.userId)]
)

/** Issued only with `offline_access`. Tied to a session so signing out can revoke it. */
export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }),
    revoked: integer("revoked", { mode: "timestamp" }),
    authTime: integer("auth_time", { mode: "timestamp" }),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("idx_oauth_refresh_client").on(t.clientId),
    index("idx_oauth_refresh_session").on(t.sessionId),
    index("idx_oauth_refresh_user").on(t.userId),
  ]
)

/**
 * Opaque access tokens, written only when a token is issued with no audience.
 *
 * MCP clients always send `resource`, so they get audience-locked JWTs that the resource
 * server verifies against JWKS with no database read — this table stays empty on the MCP
 * path. It backs introspection and revocation.
 */
export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("idx_oauth_access_client").on(t.clientId),
    index("idx_oauth_access_session").on(t.sessionId),
    index("idx_oauth_access_user").on(t.userId),
    index("idx_oauth_access_refresh").on(t.refreshId),
  ]
)

/** What the user agreed one client may do. Deleting a row here revokes that connection. */
export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_oauth_consent_client").on(t.clientId),
    index("idx_oauth_consent_user").on(t.userId),
  ]
)

/** Signing keys for the JWT access tokens the MCP resource server verifies. */
export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
})

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("uq_projects_user_key").on(t.userId, t.key)]
)

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_conversations_user").on(t.userId, t.updatedAt)]
)

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** JSON: tool-call trace + which memories were used. Lets a reload look identical. */
    meta: text("meta"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_messages_conversation").on(t.conversationId, t.createdAt)]
)

/**
 * A `session`-scoped memory belongs to a context, not to a transport connection.
 *
 * The chat app owns `conversationId` and maps it here server-side, so the model never
 * sees or manages a context. When MCP lands, external clients get the same row via a
 * hashed handle instead — the table shape does not change.
 */
export const contexts = sqliteTable(
  "contexts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    label: text("label"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_contexts_conversation").on(t.userId, t.conversationId),
  ]
)

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    /** sha256 of the normalised fact. Drives dedupe, tombstone lookup and cooldowns. */
    factFp: text("fact_fp").notNull(),
    category: text("category"),
    scope: text("scope").notNull(),
    projectId: text("project_id"),
    contextId: text("context_id"),

    /**
     * Denormalised mirror of the scope predicate, as a generated column so it can never
     * drift from `scope`. Retrieval matches on this single key instead of an OR — which
     * is also exactly the form Vectorize needs, since it has no `$or` operator.
     */
    scopeKey: text("scope_key").generatedAlwaysAs(
      sql`(CASE scope
             WHEN 'global'  THEN 'global'
             WHEN 'project' THEN 'proj:' || COALESCE(project_id, '')
             WHEN 'session' THEN 'sess:' || COALESCE(context_id, '')
             ELSE 'suppressed' END)`,
      { mode: "virtual" }
    ),

    status: text("status").notNull(),
    confidence: real("confidence"),
    /** Which client proposed this. `web` today; a verified OAuth client_id once MCP lands. */
    originClient: text("origin_client").notNull().default("web"),
    sourceRefs: text("source_refs"),
    supersededBy: text("superseded_by"),
    /** Idempotency anchor: one negotiation can only ever produce one memory. */
    negotiationId: text("negotiation_id").unique(),

    createdAt: integer("created_at").notNull(),
    lastConfirmed: integer("last_confirmed"),
    /** NOT NULL with a far-future sentinel so `expires_at > ?` is one indexable comparison
     *  in D1 and one `$gt` filter in Vectorize. Vectorize cannot filter on NULL. */
    expiresAt: integer("expires_at").notNull().default(NEVER_EXPIRES),

    /** Vectorize sync state. D1 is the source of truth; the vector index is rebuildable. */
    indexState: text("index_state").notNull().default("pending"),
    indexedAt: integer("indexed_at"),
    embedModel: text("embed_model"),
  },
  (t) => [
    index("idx_mem_retrieval").on(t.userId, t.status, t.expiresAt, t.scopeKey),
    index("idx_mem_fp").on(t.userId, t.factFp),
    index("idx_mem_index_state").on(t.indexState, t.createdAt),
  ]
)

/**
 * The FTS5 keyword index.
 *
 * Declared as an ordinary table so Drizzle can insert and delete inside a `db.batch()`
 * alongside the memory row — raw `sql` fragments are not valid batch items, and losing
 * atomicity here would let the index drift from the memories it indexes. The actual
 * `CREATE VIRTUAL TABLE` lives in the migration; nothing here ever reads it, because
 * MATCH queries go through hand-written SQL in memory/retrieval.ts.
 */
export const memoriesFts = sqliteTable("memories_fts", {
  memoryId: text("memory_id").notNull(),
  fact: text("fact").notNull(),
})

/**
 * In-flight consent. A proposal lives here, never in `memories`, until a human accepts.
 *
 * If proposing wrote a durable memory row then an agent could write — a prompt-injected
 * one could spray unconsented facts and the consent gate would degrade into a moderation
 * queue. This table is TTL-swept and never retrievable.
 */
export const negotiations = sqliteTable(
  "negotiations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().default("web"),
    conversationId: text("conversation_id"),
    fact: text("fact").notNull(),
    factFp: text("fact_fp").notNull(),
    category: text("category").notNull(),
    /** JSON array of the scopes actually offered. Round two may not exceed this set. */
    options: text("options").notNull(),
    projectId: text("project_id"),
    contextId: text("context_id"),
    nearDupId: text("near_dup_id"),
    confidence: real("confidence"),
    status: text("status").notNull().default("pending"),
    /** JSON. Replayed verbatim if the same negotiation is resolved twice. */
    outcome: text("outcome"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("idx_neg_pending").on(t.userId, t.status, t.expiresAt)]
)

/**
 * Stops the cancel loop: model proposes, user dismisses, model immediately re-proposes.
 * Prose in a tool result does not reliably stop that. A row keyed on the fact does.
 */
export const negotiationCooldowns = sqliteTable(
  "negotiation_cooldowns",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    factFp: text("fact_fp").notNull(),
    until: integer("until").notNull(),
    reason: text("reason"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.factFp] })]
)

/** Append-only. Powers the timeline view — the "why does it think this?" answer. */
export const memoryEvents = sqliteTable(
  "memory_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memoryId: text("memory_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 'user' | a client id | 'system' */
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    at: integer("at").notNull(),
  },
  (t) => [
    index("idx_events_memory").on(t.memoryId, t.at),
    index("idx_events_user").on(t.userId, t.at),
  ]
)

export const schema = {
  user,
  session,
  account,
  verification,
  oauthClient,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  jwks,
  projects,
  conversations,
  messages,
  contexts,
  memories,
  memoriesFts,
  negotiations,
  negotiationCooldowns,
  memoryEvents,
}

export type MemoryRow = typeof memories.$inferSelect
