/**
 * Worker bindings.
 *
 * `VECTORIZE` is optional on purpose: it has no local emulator, so leaving it unbound keeps
 * `wrangler dev` working offline. Retrieval degrades to keyword-only when it is absent —
 * see memory/vector.ts. Embeddings come from OpenRouter over plain HTTP, so they need no
 * binding at all and behave identically in dev and production.
 */
export interface Env {
  DB: D1Database
  VECTORIZE?: VectorizeIndex

  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  WEB_ORIGIN: string

  /**
   * HMAC key for the multi-round-trip `requestState` the MCP server hands to clients and
   * reads back on retry. At least 32 bytes — `createRequestStateCodec` throws below that.
   *
   * Separate from `BETTER_AUTH_SECRET` on purpose: this one is minted into a value that
   * every connected MCP client holds and can base64-decode, so it should be rotatable
   * without invalidating every session cookie. Rotating it only invalidates consent prompts
   * that are open at that moment, which clients recover from by re-proposing.
   */
  MCP_REQUEST_STATE_SECRET: string

  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL?: string
  OPENROUTER_TRANSCRIBE_MODEL?: string
  OPENROUTER_EMBEDDING_MODEL?: string
}

export type AppBindings = {
  Bindings: Env
  Variables: {
    user: { id: string; email: string; name: string; image: string | null }
    session: { id: string }
  }
}
