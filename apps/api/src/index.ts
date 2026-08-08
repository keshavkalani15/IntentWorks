import { Hono } from "hono"
import { cors } from "hono/cors"

import { createAuth } from "./auth"
import type { AppBindings } from "./env"
import { ApiError } from "./lib/errors"
import { discoveryRoute } from "./mcp/metadata"
import { mcpRoute } from "./mcp"
import { chatRoute } from "./routes/chat"
import { connectionsRoute } from "./routes/connections"
import { consentRoute } from "./routes/consent"
import { conversationsRoute } from "./routes/conversations"
import { memoriesRoute } from "./routes/memories"
import { negotiationsRoute } from "./routes/negotiations"
import { oauthConsentRoute } from "./routes/oauth-consent"
import { graphRoute } from "./routes/graph"
import { statsRoute } from "./routes/stats"
import { transcribeRoute } from "./routes/transcribe"

const app = new Hono<AppBindings>()

/**
 * Cross-origin policy for the app's own API. Only needed in development, where Vite serves
 * the SPA from a different port; in production the app and API share an origin, so no
 * request is ever cross-origin.
 *
 * Scoped to `/api/*` deliberately. `/mcp` must NOT inherit it: this policy reflects a
 * credentialed allow-list built for cookies, and the MCP endpoint is a bearer-token surface
 * with a different set of callers and a different header to expose. It brings its own (see
 * src/mcp/index.ts).
 */
app.use("/api/*", (c, next) =>
  cors({
    origin: [c.env.WEB_ORIGIN, c.env.BETTER_AUTH_URL].filter(Boolean),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })(c, next)
)

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          // Name the offending fields inline. A bare "Invalid message." tells a caller
          // nothing, and the details array rarely makes it as far as the UI.
          message: `${error.message}${describeIssues(error.details)}`,
          details: error.details,
        },
      },
      error.status
    )
  }

  console.error("Unhandled error", error)
  return c.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    500
  )
})

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    // Surfaced so the UI can say "keyword only" honestly rather than silently degrading.
    semanticSearch: Boolean(c.env.VECTORIZE && c.env.OPENROUTER_API_KEY),
    chat: Boolean(c.env.OPENROUTER_API_KEY),
  })
)

// Better Auth owns every method under its base path.
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env, new URL(c.req.url).origin).handler(c.req.raw)
)

// ---------------------------------------------------------------------------
// The agent plane. Bearer tokens only; see src/mcp/auth.ts.
// ---------------------------------------------------------------------------

app.route("/.well-known", discoveryRoute)
app.route("/mcp", mcpRoute)

// ---------------------------------------------------------------------------
// The human plane. Session cookies only.
//
// Both consent screens live here rather than in the SPA: each is opened cold from an
// external application and must decide whether the viewer may see it before rendering
// anything. `/consent/:id` in particular is the load-bearing one — it is the only way a
// memory proposed over MCP can ever be saved.
// ---------------------------------------------------------------------------

app.route("/oauth", oauthConsentRoute)
app.route("/consent", consentRoute)

app.route("/api/connections", connectionsRoute)
app.route("/api/stats", statsRoute)
app.route("/api/graph", graphRoute)
app.route("/api/memories", memoriesRoute)
app.route("/api/negotiations", negotiationsRoute)
app.route("/api/conversations", conversationsRoute)
app.route("/api/chat", chatRoute)
app.route("/api/transcribe", transcribeRoute)

app.notFound((c) =>
  c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404)
)

/** Fold Zod issues into a short " (field: reason)" suffix. */
function describeIssues(details: unknown): string {
  if (!Array.isArray(details)) return ""
  const parts = details.slice(0, 3).map((issue) => {
    const { path, message } = issue as { path?: unknown[]; message?: string }
    const field = path?.join(".") || "body"
    return `${field}: ${message ?? "invalid"}`
  })
  return parts.length > 0 ? ` (${parts.join("; ")})` : ""
}

export default app
