import type { Db } from "./db/client"
import { createDb } from "./db/client"
import type { Env } from "./env"
import { VectorStore } from "./memory/vector"

/**
 * Everything a domain function needs, assembled once per request.
 *
 * `userId` and `clientId` are the only identity in the system, and they are resolved from
 * the authenticated session before any handler body runs. No domain function ever reads a
 * header, a cookie or a request body to decide who is asking.
 */
export interface RequestContext {
  db: Db
  vectors: VectorStore | null
  userId: string
  /** `web` today. A verified OAuth client id once MCP clients can connect. */
  clientId: string
  /** Defers index maintenance past the response. Absent in tests. */
  waitUntil: (promise: Promise<unknown>) => void
}

export function createRequestContext(input: {
  env: Env
  userId: string
  clientId?: string
  waitUntil?: (promise: Promise<unknown>) => void
}): RequestContext {
  return {
    db: createDb(input.env.DB),
    vectors: VectorStore.from(input.env),
    userId: input.userId,
    clientId: input.clientId ?? "web",
    waitUntil: input.waitUntil ?? (() => {}),
  }
}
