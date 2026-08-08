import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"
import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server"
import { and, eq } from "drizzle-orm"
import { createLocalJWKSet, errors as joseErrors, jwtVerify } from "jose"
import type { JWK } from "jose"

import type { RequestContext } from "../context"
import { createRequestContext } from "../context"
import type { Db } from "../db/client"
import { createDb } from "../db/client"
import { jwks as jwksTable, oauthConsent } from "../db/schema"
import type { Env } from "../env"
import {
  MCP_PATH,
  SCOPE_PROPOSE,
  SCOPE_READ,
  mcpIssuer,
  mcpResource,
} from "./config"

/**
 * THE AGENT PLANE. Bearer tokens only.
 *
 * The counterpart to `requireUser` in src/middleware/auth.ts, and mutually exclusive with
 * it: that one reads cookies and can reach `resolve()`; this one reads `Authorization` and
 * cannot. Keeping them as two separate functions with no shared code path is deliberate —
 * the moment one of them can satisfy the other, an agent can approve its own proposals.
 */

/**
 * Signing keys, read from D1.
 *
 * NOT fetched from our own `/api/auth/jwks`. That was the first implementation and it fails
 * in production: a Worker making a subrequest to its own custom domain does not come back
 * with the document, and `createRemoteJWKSet` reports
 * `Expected 200 OK from the JSON Web Key Set HTTP response` — so every single MCP call 401s
 * while the token itself is perfectly valid. It works under `wrangler dev`, where the
 * loopback is local, which is exactly what makes it a trap.
 *
 * Reading the table removes the network hop entirely. The cost is that we compose the JWK
 * ourselves rather than reusing the endpoint's composition: the row stores a bare JWK
 * (`kty`, `crv`, `x`) and the `kid` is the row id. We deliberately do not inject `alg` —
 * jose matches on `kid` and takes the algorithm from the JWT header, so leaving it out keeps
 * this working if the key type is ever reconfigured.
 */
interface CachedKeys {
  kids: string
  set: ReturnType<typeof createLocalJWKSet>
}

/**
 * Cached per isolate. Rotation is handled by re-reading on a no-matching-key error rather
 * than by a timer: a new key only matters once a token signed with it actually arrives, and
 * at that point the miss tells us precisely when to refresh.
 */
let cachedKeys: CachedKeys | null = null

async function loadKeySet(db: Db): Promise<CachedKeys> {
  const rows = await db
    .select({ id: jwksTable.id, publicKey: jwksTable.publicKey })
    .from(jwksTable)

  const keys: JWK[] = []
  for (const row of rows) {
    try {
      keys.push({ ...(JSON.parse(row.publicKey) as JWK), kid: row.id })
    } catch {
      // One unreadable row must not take down verification for every other key.
      console.error("jwks row is not valid JSON", { kid: row.id })
    }
  }

  if (keys.length === 0) {
    throw new Error("No signing keys in the jwks table — has a token ever been issued?")
  }

  return { kids: keys.map((key) => key.kid).join(","), set: createLocalJWKSet({ keys }) }
}

async function keySetFor(db: Db, refresh = false): Promise<CachedKeys> {
  if (refresh || !cachedKeys) cachedKeys = await loadKeySet(db)
  return cachedKeys
}

function invalidToken(detail: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, detail)
}

/**
 * Verifies an access token for this resource server.
 *
 * Audience validation is the load-bearing check, not a formality. `jwtVerify` is given the
 * canonical resource URI, so a token our own authorization server minted for a *different*
 * audience is rejected here. That is what stops token passthrough: a client cannot take a
 * token it obtained for some other API and spend it on `/mcp`, and it cannot hand us a
 * token we would then forward anywhere else.
 */
export function tokenVerifier(env: Env, origin: string): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const resource = mcpResource(origin)
      const db = createDb(env.DB)
      const options = { issuer: mcpIssuer(origin), audience: resource }

      let payload
      try {
        try {
          ;({ payload } = await jwtVerify(token, (await keySetFor(db)).set, options))
        } catch (error) {
          // The cached set predates this token's key: the authorization server has rotated.
          // Re-read once and retry, so a rotation costs one extra query rather than an
          // outage until every isolate happens to recycle.
          if (!(error instanceof joseErrors.JWKSNoMatchingKey)) throw error
          ;({ payload } = await jwtVerify(token, (await keySetFor(db, true)).set, options))
        }
      } catch (error) {
        // The reason is logged, never returned: "signature failed" versus "wrong audience"
        // is a probing oracle. The client gets an opaque 401 and the discovery URL.
        console.warn("mcp token rejected", { error: (error as Error).message })
        throw invalidToken("The access token is not valid for this resource.")
      }

      const sub = typeof payload.sub === "string" ? payload.sub : null
      if (!sub) throw invalidToken("The access token has no subject.")

      // `exp` is required, not merely used: the SDK's bearer gate refuses any token whose
      // `expiresAt` it cannot determine, and a non-expiring agent credential is not
      // something this server should ever honour.
      if (typeof payload.exp !== "number")
        throw invalidToken("The access token has no expiry.")

      /**
       * `azp` (authorized party) is the OAuth `client_id`. It becomes `RequestContext.clientId`
       * and therefore lands in `negotiations.clientId`, `memories.origin_client` and
       * `memory_events.actor` — which is what turns the existing per-client proposal quota
       * into a per-agent budget and lets the timeline name who suggested a fact.
       *
       * It comes from a signed token, so it is a verified identity rather than a
       * self-reported name.
       */
      const clientId =
        typeof payload.azp === "string" && payload.azp ? payload.azp : "unknown"

      const scopes =
        typeof payload.scope === "string"
          ? payload.scope.split(/\s+/).filter(Boolean)
          : []

      /**
       * Is the grant still live?
       *
       * A signed JWT is valid until it expires, which would make "Disconnect" in the
       * Connections tab mean "some time within the next hour" — not what the button says,
       * and not an acceptable answer in a product whose whole claim is that the user is in
       * control. So the consent row is checked on every call, and deleting it takes effect
       * on the next request.
       *
       * The cost is one indexed lookup per MCP request. That is the right trade: revocation
       * that does not revoke is worse than a query.
       */
      const grant = await db.query.oauthConsent.findFirst({
        where: and(eq(oauthConsent.userId, sub), eq(oauthConsent.clientId, clientId)),
        columns: { id: true },
      })
      if (!grant) {
        console.warn("mcp token rejected", { error: "consent revoked", clientId })
        throw invalidToken("This application's access has been revoked.")
      }

      return {
        token,
        clientId,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(resource),
        extra: { userId: sub },
      }
    },
  }
}

/**
 * The scope a request needs, decided from the routing headers alone.
 *
 * `Mcp-Method` and `Mcp-Name` are required on every 2026-07-28 request and the SDK rejects
 * any request whose headers disagree with its body (`-32020`). So reading them here is safe
 * — a client cannot claim `search_memory` in the header and call `propose_memory` in the
 * body — and it lets an insufficient-scope failure become a proper `403` with a
 * `WWW-Authenticate` challenge, which it could not if the check happened inside the tool.
 *
 * Returns no requirement for discovery calls (`tools/list`, `ping`) so a freshly authorized
 * client can always enumerate what it may do, and for anything unrecognised — including
 * legacy requests, which carry no such headers at all. That is why the tool handlers assert
 * their own scope as well: this check produces the correct challenge, the handler's check is
 * the boundary that cannot be bypassed.
 */
export function scopeFromHeaders(headers: Headers): string[] {
  if (headers.get("Mcp-Method") !== "tools/call") return []

  switch (headers.get("Mcp-Name")) {
    case "search_memory":
      return [SCOPE_READ]
    case "propose_memory":
      return [SCOPE_PROPOSE]
    default:
      return []
  }
}

/** Whether a verified token carries a scope. The boundary check inside every tool. */
export function hasScope(auth: AuthInfo, scope: string): boolean {
  return auth.scopes.includes(scope)
}

/**
 * Build the domain context for a verified MCP caller.
 *
 * `userId` comes from the token's `sub` — never from a tool argument, a header, or anything
 * the model can write. That is the same rule the web plane follows: identity is resolved
 * once, from the credential, before any domain function runs.
 */
export function contextFromToken(
  env: Env,
  auth: AuthInfo,
  waitUntil?: (promise: Promise<unknown>) => void
): RequestContext {
  const userId = auth.extra?.userId
  if (typeof userId !== "string")
    throw invalidToken("The access token has no subject.")

  return createRequestContext({
    env,
    userId,
    clientId: auth.clientId,
    waitUntil,
  })
}

/** The `resource_metadata` URL advertised in every challenge, per RFC 9728. */
export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`
}
