import {
  bearerAuthChallengeResponse,
  verifyBearerToken,
} from "@modelcontextprotocol/server"
import { Hono } from "hono"

import type { AppBindings } from "../env"
import { resourceMetadataUrl, scopeFromHeaders, tokenVerifier } from "./auth"
import { resolveOrigin } from "./config"
import { createHandler } from "./handler"

/**
 * `POST /mcp` — the MCP endpoint.
 *
 * Every request is authenticated, every request is independent. There is no session to
 * establish and nothing to keep warm: `2026-07-28` made the protocol stateless, so any
 * isolate can serve any request.
 */
export const mcpRoute = new Hono<AppBindings>()

/**
 * CORS for the agent plane, deliberately separate from the app's `/api/*` policy.
 *
 * `Access-Control-Expose-Headers: WWW-Authenticate` is the line that matters. A browser
 * hides response headers from script unless they are named here, so without it a
 * browser-based MCP client receives the 401 but cannot read the `resource_metadata` pointer
 * inside it — discovery dead-ends with no error that explains why.
 *
 * `credentials` is off and the origin is `*`: this surface authenticates with a bearer token
 * and must never accept an ambient cookie. That asymmetry with `/api/*` is the whole point.
 */
mcpRoute.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Param-*",
      "Access-Control-Expose-Headers": "WWW-Authenticate",
      "Access-Control-Max-Age": "86400",
    })
  }

  await next()
  c.res.headers.set("Access-Control-Allow-Origin", "*")
  c.res.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate")
})

/**
 * 2025-era session operations. A client from that era may try to open a standalone SSE
 * stream with GET or tear a session down with DELETE; neither exists any more, and the spec
 * says to answer `405` rather than pretend.
 */
mcpRoute.on(["GET", "DELETE"], "/", (c) =>
  c.json(
    {
      error: {
        code: "method_not_allowed",
        message: "The MCP endpoint accepts POST.",
      },
    },
    405,
    {
      Allow: "POST, OPTIONS",
    }
  )
)

mcpRoute.post("/", async (c) => {
  // Not the request's own origin — see `resolveOrigin`. The issuer and audience checked
  // below have to be the same strings the authorization server minted into the token.
  const origin = resolveOrigin(c.env.BETTER_AUTH_URL, c.req.url)
  const resourceMetadata = resourceMetadataUrl(origin)

  /**
   * The scope this particular call needs, read from the routing headers.
   *
   * Reading authorization off headers is safe here because the SDK rejects any request whose
   * headers disagree with its body (`-32020`), so a client cannot claim one tool and invoke
   * another. It buys a correct `403 insufficient_scope` challenge, which a check inside the
   * tool could not produce — the tool can only return a result, not a status line.
   *
   * The tools assert their own scope regardless. This is the polite answer; that is the
   * boundary.
   */
  const requiredScopes = scopeFromHeaders(c.req.raw.headers)

  let authInfo
  try {
    authInfo = await verifyBearerToken(c.req.header("Authorization"), {
      verifier: tokenVerifier(c.env, origin),
      requiredScopes,
      resourceMetadataUrl: resourceMetadata,
    })
  } catch (error) {
    // 401 with `WWW-Authenticate: Bearer resource_metadata="…"` for an absent or invalid
    // token, 403 `insufficient_scope` for a valid one that is missing a scope. That header
    // is the entire discovery entry point: a client with no prior knowledge of this server
    // finds its authorization server by following it.
    return bearerAuthChallengeResponse(error, {
      requiredScopes,
      resourceMetadataUrl: resourceMetadata,
    })
  }

  const handler = createHandler(c.env, (promise) =>
    c.executionCtx.waitUntil(promise)
  )
  try {
    return await handler.fetch(c.req.raw, { authInfo })
  } finally {
    // Releases the per-request instance. The response has already been produced (or is a
    // stream the transport owns), so this does not truncate anything.
    c.executionCtx.waitUntil(handler.close())
  }
})
