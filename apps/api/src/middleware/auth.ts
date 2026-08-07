import type { Context } from "hono"
import { createMiddleware } from "hono/factory"

import { createAuth } from "../auth"
import type { RequestContext } from "../context"
import { createRequestContext } from "../context"
import type { AppBindings } from "../env"
import { unauthorized } from "../lib/errors"

/**
 * Resolves identity once, before any handler body runs. THE HUMAN PLANE.
 *
 * This is the only place the system learns who is asking. No domain function reads a header
 * or a cookie, so there is no second path by which a caller could claim to be someone else.
 *
 * Cookie-only, deliberately and load-bearingly. `/api/negotiations/:id/resolve` sits behind
 * this middleware and is the only route that can write to `memories`; an agent that could
 * satisfy it could approve its own proposals, and the two-phase negotiation would become
 * decoration. So a Bearer token is refused here outright rather than merely being ignored.
 *
 * That explicit refusal is the guardrail: `getSession` reads cookies today, but enabling
 * Better Auth's `bearer` plugin — or any future change that teaches it to read an
 * `Authorization` header — would otherwise hand the agent plane a key to this door with no
 * test failing and nothing looking wrong. Agent traffic belongs on `requireBearer`
 * (src/mcp/auth.ts), which is mutually exclusive with this by construction.
 */
export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  if (/^Bearer\s/i.test(c.req.header("Authorization") ?? ""))
    throw unauthorized()

  const auth = createAuth(c.env, new URL(c.req.url).origin)
  const result = await auth.api.getSession({ headers: c.req.raw.headers })

  if (!result?.user) throw unauthorized()

  c.set("user", {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    image: result.user.image ?? null,
  })
  c.set("session", { id: result.session.id })

  await next()
})

/**
 * Build the per-request domain context from an authenticated Hono context.
 *
 * `clientId` is fixed to `web` because everything reaching this function came through
 * `requireUser`, i.e. a browser session. MCP callers never pass through here — they build
 * their context in src/mcp/auth.ts with the verified OAuth `client_id` instead, which is
 * what gives `negotiations.clientId`, `memories.originClient` and the per-client proposal
 * quota real provenance.
 */
export function contextFrom(c: Context<AppBindings>): RequestContext {
  return createRequestContext({
    env: c.env,
    userId: c.get("user").id,
    clientId: "web",
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  })
}
