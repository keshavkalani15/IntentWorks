import { z } from "zod"

/**
 * A connected MCP client, as the Connections tab shows it.
 *
 * The counters are the point. Anyone can list which applications hold a grant; what actually
 * helps someone decide whether to keep one is its record — how often it asks, and how often
 * they agreed. `proposed` versus `saved` is a judgement score for an agent, and it is only
 * available because `negotiations.client_id` and `memories.origin_client` record the
 * proposer rather than whoever happened to commit the write.
 */
export const mcpConnectionSchema = z.object({
  clientId: z.string(),
  /** Client-chosen at registration, so untrusted display text. Escape it. */
  name: z.string().nullable(),
  scopes: z.array(z.string()),
  connectedAt: z.number().nullable(),
  /** Last time this client proposed anything. Null if it has only ever read. */
  lastActiveAt: z.number().nullable(),
  proposed: z.number(),
  saved: z.number(),
  declined: z.number(),
  /** Proposals still waiting on an answer right now. */
  pending: z.number(),
})
export type McpConnection = z.infer<typeof mcpConnectionSchema>

export const connectionsResponseSchema = z.object({
  items: z.array(mcpConnectionSchema),
  /** The URL a client connects to. Sent by the server so the UI never has to guess it. */
  endpoint: z.string(),
  scopesSupported: z.array(z.string()),
})
export type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>
