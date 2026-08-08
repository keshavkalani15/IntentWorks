import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider"
import { Hono } from "hono"

import { createAuth } from "../auth"
import type { AppBindings } from "../env"
import { MCP_SCOPES, mcpIssuer, mcpResource, resolveOrigin } from "./config"

/**
 * The four public discovery documents, mounted under `/.well-known`.
 *
 * All of them are unauthenticated by design — a client fetches these precisely because it
 * does not yet have a token. They carry no user data, so they are served with permissive,
 * non-credentialed CORS: a browser-based MCP client has to be able to read them
 * cross-origin, and without `Access-Control-Allow-Origin` it silently cannot.
 *
 * NOTE: every path here must be covered by `run_worker_first` in wrangler.jsonc. Miss one
 * and the asset store answers instead, returning index.html with a 200 — a client then gets
 * a web page where it expected JSON, and the Worker never sees the request at all.
 */
export const discoveryRoute = new Hono<AppBindings>()

const PUBLIC_JSON = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  // Discovery documents change only on deploy. Let clients and edges hold them briefly.
  "Cache-Control": "public, max-age=3600",
} as const

function origin(c: {
  env: { BETTER_AUTH_URL: string }
  req: { url: string }
}): string {
  return resolveOrigin(c.env.BETTER_AUTH_URL, c.req.url)
}

/** Preflight for the browser-based clients that read these cross-origin. */
discoveryRoute.options("/*", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  })
)

/**
 * RFC 9728 Protected Resource Metadata — the document that tells a client which
 * authorization server guards `/mcp`. This is the entry point to the whole flow: the 401
 * challenge from `/mcp` points here, and everything else is discovered from it.
 *
 * `offline_access` is deliberately absent from `scopes_supported`. Refresh tokens are a
 * client convenience, not something this resource requires, and the spec says a protected
 * resource SHOULD NOT ask for them.
 */
function protectedResourceMetadata(base: string): Response {
  return Response.json(
    {
      resource: mcpResource(base),
      authorization_servers: [mcpIssuer(base)],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Negotiated Memory",
    },
    { headers: PUBLIC_JSON }
  )
}

/**
 * Served at both legal locations for the same resource. A client that received the 401
 * challenge uses the exact `resource_metadata` URL from the header; one that is probing
 * blind tries the path-inserted form first and the root second, so both answer.
 */
discoveryRoute.get("/oauth-protected-resource/mcp", (c) =>
  protectedResourceMetadata(origin(c))
)
discoveryRoute.get("/oauth-protected-resource", (c) =>
  protectedResourceMetadata(origin(c))
)

/**
 * RFC 8414 authorization server metadata, and its OIDC sibling.
 *
 * Better Auth would otherwise serve these beneath its own base path (`/api/auth/...`),
 * which is not where a client looks. We pin the issuer to the bare origin (mcp/config.ts)
 * and re-export the plugin's own documents here at the root, which is the first URL the
 * spec's probe order tries for a path-less issuer.
 */
discoveryRoute.get("/oauth-authorization-server", (c) =>
  oauthProviderAuthServerMetadata(createAuth(c.env, origin(c)), {
    headers: PUBLIC_JSON,
  })(c.req.raw)
)

discoveryRoute.get("/openid-configuration", (c) =>
  oauthProviderOpenIdConfigMetadata(createAuth(c.env, origin(c)), {
    headers: PUBLIC_JSON,
  })(c.req.raw)
)
