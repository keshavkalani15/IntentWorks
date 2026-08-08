import { and, eq, sql } from "drizzle-orm"
import { Hono } from "hono"

import type { McpConnection } from "@workspace/shared"

import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
} from "../db/schema"
import type { AppBindings } from "../env"
import { now } from "../lib/time"
import { MCP_SCOPES, mcpResource, resolveOrigin } from "../mcp/config"
import { contextFrom, requireUser } from "../middleware/auth"

/**
 * The human plane's view of the agent plane: which applications hold a grant on this
 * account, what each one has actually done with it, and how to cut one off.
 *
 * Behind `requireUser`, so cookie-only. An agent cannot enumerate its siblings, and — more
 * to the point — cannot revoke them.
 */
export const connectionsRoute = new Hono<AppBindings>()

connectionsRoute.use("*", requireUser)

connectionsRoute.get("/", async (c) => {
  const ctx = contextFrom(c)
  const origin = resolveOrigin(c.env.BETTER_AUTH_URL, c.req.url)
  const timestamp = now()

  /**
   * Three small queries rather than one join with correlated subqueries. The stats are
   * grouped aggregates over different tables with different keys (`client_id` on
   * negotiations, `origin_client` on memories), and merging them in JS is both clearer and
   * cheaper on D1 than teaching SQL to do it in one pass.
   */
  const [grants, asks, outcomes] = await Promise.all([
    ctx.db
      .select({
        clientId: oauthConsent.clientId,
        scopes: oauthConsent.scopes,
        createdAt: oauthConsent.createdAt,
        name: oauthClient.name,
        disabled: oauthClient.disabled,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
      .where(eq(oauthConsent.userId, ctx.userId)),

    ctx.db.all<{ clientId: string; proposed: number; pending: number; lastActiveAt: number }>(sql`
      SELECT client_id AS clientId,
             COUNT(*)  AS proposed,
             SUM(CASE WHEN status = 'pending' AND expires_at > ${timestamp} THEN 1 ELSE 0 END) AS pending,
             MAX(created_at) AS lastActiveAt
      FROM negotiations
      WHERE user_id = ${ctx.userId}
      GROUP BY client_id
    `),

    ctx.db.all<{ originClient: string; saved: number; declined: number }>(sql`
      SELECT origin_client AS originClient,
             SUM(CASE WHEN status = 'active'     THEN 1 ELSE 0 END) AS saved,
             SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END) AS declined
      FROM memories
      WHERE user_id = ${ctx.userId}
      GROUP BY origin_client
    `),
  ])

  const asksBy = new Map(asks.map((row) => [row.clientId, row]))
  const outcomesBy = new Map(outcomes.map((row) => [row.originClient, row]))

  const items: McpConnection[] = grants
    // A disabled client cannot obtain a token, so listing it would offer the user a
    // "disconnect" for something already inert.
    .filter((grant) => !grant.disabled)
    .map((grant) => {
      const ask = asksBy.get(grant.clientId)
      const outcome = outcomesBy.get(grant.clientId)

      return {
        clientId: grant.clientId,
        name: grant.name ?? null,
        scopes: parseScopes(grant.scopes),
        // Drizzle hands back a Date for `mode: "timestamp"` columns; the rest of the API
        // speaks unix milliseconds, so normalise here rather than in the UI.
        connectedAt: grant.createdAt ? grant.createdAt.getTime() : null,
        lastActiveAt: ask?.lastActiveAt ?? null,
        proposed: Number(ask?.proposed ?? 0),
        saved: Number(outcome?.saved ?? 0),
        declined: Number(outcome?.declined ?? 0),
        pending: Number(ask?.pending ?? 0),
      }
    })
    .sort((a, b) => (b.lastActiveAt ?? b.connectedAt ?? 0) - (a.lastActiveAt ?? a.connectedAt ?? 0))

  return c.json({
    items,
    endpoint: mcpResource(origin),
    scopesSupported: [...MCP_SCOPES],
  })
})

/**
 * Disconnect a client.
 *
 * Deleting the consent row is what makes this immediate: `tokenVerifier` checks that a live
 * consent exists on every MCP request, so an access token that has not yet expired stops
 * working the moment this returns. Without that check, "Disconnect" would mean "in up to an
 * hour", which is not what the button says.
 *
 * The stored tokens go too, so nothing can be refreshed back into life.
 */
connectionsRoute.delete("/:clientId", async (c) => {
  const ctx = contextFrom(c)
  const clientId = c.req.param("clientId")

  await ctx.db.batch([
    ctx.db
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, ctx.userId), eq(oauthConsent.clientId, clientId))),
    ctx.db
      .delete(oauthAccessToken)
      .where(
        and(eq(oauthAccessToken.userId, ctx.userId), eq(oauthAccessToken.clientId, clientId))
      ),
    ctx.db
      .delete(oauthRefreshToken)
      .where(
        and(eq(oauthRefreshToken.userId, ctx.userId), eq(oauthRefreshToken.clientId, clientId))
      ),
  ])

  return c.json({ ok: true } as const)
})

/** Better Auth stores `string[]` columns as JSON text on SQLite. */
function parseScopes(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : []
  } catch {
    return raw.split(/[\s,]+/).filter(Boolean)
  }
}
