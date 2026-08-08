import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import type { McpHttpHandler } from "@modelcontextprotocol/server"

import type { Env } from "../env"
import { proposalStateCodec, requestStateSecret } from "./state"
import { registerMemoryTools } from "./tools"

/**
 * One MCP server instance per request.
 *
 * `2026-07-28` removed protocol sessions, so there is nothing to keep between requests and a
 * fresh instance per request is the intended shape — which happens to be exactly what a
 * Worker isolate wants anyway. All durable state lives in D1.
 *
 * `legacy: 'stateless'` is left at its default so clients still speaking 2025-era MCP are
 * served too. They get the same two tools; the only difference they see is that
 * `propose_memory` hands back a consent link as text rather than as a URL elicitation,
 * because they never declare the capability for one. See `askForConsent` in tools.ts.
 */
export function createHandler(
  env: Env,
  waitUntil?: (promise: Promise<unknown>) => void
): McpHttpHandler {
  const codec = proposalStateCodec(
    requestStateSecret(env.MCP_REQUEST_STATE_SECRET)
  )

  return createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "negotiated-memory", version: "1.0.0" },
        {
          capabilities: { tools: {} },
          instructions:
            "Long-term memory for this user, with consent built in. `search_memory` reads " +
            "what they have already agreed to store, scoped automatically to the current " +
            "context. `propose_memory` suggests a new fact — it cannot save one. The user " +
            "approves each fact in their browser and chooses how widely it applies, so " +
            "propose freely but never claim something has been saved until a call tells you " +
            "it has.",

          /**
           * The verified `requestState` payload reaches handlers through
           * `ctx.mcpReq.requestState<T>()`. Without this hook the accessor would hand back
           * the raw wire string and the negotiation id inside it would be
           * client-controlled — i.e. anyone could poll anyone's pending proposal.
           */
          requestState: { verify: codec.verify },

          /**
           * The tool list is a compile-time constant here, so let clients cache it. `public`
           * is safe precisely because the list never varies by caller: both tools are always
           * advertised, and what a token may actually *do* is enforced per call by scope, not
           * by hiding tools from `tools/list`.
           */
          cacheHints: {
            "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
          },
        }
      )

      registerMemoryTools(server, { env, codec, waitUntil })
      return server
    },
    {
      onerror: (error) =>
        console.error("mcp handler error", { error: error.message }),
    }
  )
}
