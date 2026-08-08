/**
 * The identifiers that tie the authorization server and the resource server together.
 *
 * Every one of these appears in at least two places — a token's `aud`, a discovery
 * document, a `WWW-Authenticate` challenge — and a mismatch between any two of them
 * produces a client that cannot connect and an error message that does not say why. So they
 * are derived here, once, from the request origin.
 */

/** The MCP endpoint path. Also the resource identifier's path component (RFC 8707). */
export const MCP_PATH = "/mcp"

/**
 * The one origin every identifier is built from.
 *
 * `BETTER_AUTH_URL` wins over the request's own host, and that ordering is load-bearing
 * rather than tidiness. Three values have to agree exactly — the `resource` we advertise in
 * the metadata document, the `aud` the authorization server mints into tokens, and the `aud`
 * this resource server accepts — and only the configured value is stable. A Worker is
 * reachable on more than one hostname (its `*.workers.dev` name, the custom domain, and
 * whatever `wrangler dev` decides locally), so deriving from the request would let a client
 * that arrived on one hostname be issued a token for another and be rejected on every call,
 * with a 401 that says nothing about why.
 *
 * The consent URL follows the same rule for a related reason: it must point at the host whose
 * session cookie the user actually holds.
 */
export function resolveOrigin(
  configured: string | undefined,
  requestUrl: string
): string {
  const base = configured?.trim() || new URL(requestUrl).origin
  return base.replace(/\/+$/, "")
}

/**
 * OAuth scopes, one per tool.
 *
 * There is deliberately no write scope. No client can write to `memories` — only a
 * cookie-authenticated human can, through `POST /api/negotiations/:id/resolve` — so there
 * is nothing for a write scope to grant. If you find yourself adding one, the thing to
 * change is not this list.
 */
export const SCOPE_READ = "memory:read"
export const SCOPE_PROPOSE = "memory:propose"
export const MCP_SCOPES = [SCOPE_READ, SCOPE_PROPOSE] as const
export type McpScope = (typeof MCP_SCOPES)[number]

/**
 * How each scope is described on the OAuth consent screen.
 *
 * This is the one moment the user is told what an external agent can and cannot do, so
 * `memory:propose` says plainly that it cannot save. A consent screen that read "write to
 * your memories" would be describing a permission this server does not grant, and the user
 * would be agreeing to something worse than what actually happens.
 */
export const SCOPE_COPY: Record<string, { title: string; detail: string }> = {
  [SCOPE_READ]: {
    title: "Read your memories",
    detail:
      "Search the facts you have saved. Only ever the ones in scope for the request.",
  },
  [SCOPE_PROPOSE]: {
    title: "Suggest new memories",
    detail:
      "Propose facts for you to save. It cannot save anything itself — every suggestion " +
      "comes back to you here for approval, and you choose how widely it applies.",
  },
  offline_access: {
    title: "Stay connected",
    detail:
      "Keep access without signing in again. You can revoke this at any time.",
  },
}

/**
 * The canonical resource identifier clients must send as `resource`, and the only `aud` the
 * resource server accepts. No trailing slash, no fragment — RFC 8707 §2.
 */
export function mcpResource(origin: string): string {
  return `${origin.replace(/\/$/, "")}${MCP_PATH}`
}

/**
 * The authorization server's issuer identifier: the bare origin.
 *
 * Better Auth defaults this to its own base path (`/api/auth`), which would make clients
 * probe `/.well-known/oauth-authorization-server/api/auth` — the path-insertion form. Both
 * forms are spec-legal, but the bare origin keeps discovery to a single well-known route at
 * the root, so we pin the JWT plugin's issuer to this and serve the document there.
 *
 * The two must agree: RFC 8414 §3.3 requires the `issuer` in the document to be identical
 * to the identifier the client used to build the URL it fetched, and a client MUST reject
 * the document otherwise.
 */
export function mcpIssuer(origin: string): string {
  return origin.replace(/\/$/, "")
}

/**
 * Where the RFC 9728 Protected Resource Metadata document lives. The resource's path is
 * inserted after the well-known prefix, so `https://host/mcp` advertises
 * `https://host/.well-known/oauth-protected-resource/mcp`.
 */
export function protectedResourceMetadataPath(): string {
  return `/.well-known/oauth-protected-resource${MCP_PATH}`
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${protectedResourceMetadataPath()}`
}
