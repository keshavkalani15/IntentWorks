import type { Env } from "../env"

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"

/**
 * Embedding configuration.
 *
 * `EMBEDDING_DIMENSIONS` is IMMUTABLE once the Vectorize index exists — the index is created
 * with a fixed width and cannot be altered, so changing this means a new index and a full
 * re-embed. 1536 is both Vectorize's ceiling and one of Gemini's recommended Matryoshka
 * truncation points, so it is the most head-room available without wasting any.
 *
 * The model natively returns 3072; `dimensions` truncates it server-side.
 */
export const EMBEDDING_MODEL = "google/gemini-embedding-2"
export const EMBEDDING_DIMENSIONS = 1536

/** Texts per request. The endpoint accepts an array, so this is round trips, not tokens. */
const MAX_BATCH = 32

/** Vectorize caps `getByIds` at 100 ids per call. */
const MAX_FETCH = 100

export interface VectorHit {
  id: string
  score: number
}

export interface VectorScopeFilter {
  userId: string
  scopeKeys: string[]
  now: number
}

/**
 * Vector storage and search.
 *
 * Embeddings come from OpenRouter over plain HTTP, which means the only binding this needs is
 * Vectorize itself — no second AI provider, no second key, and embedding works identically in
 * local dev and production.
 *
 * `from()` returns null when Vectorize is not bound. Every caller must handle that: retrieval
 * then runs keyword-only, which costs recall but never correctness, because D1 remains the
 * source of truth.
 */
export class VectorStore {
  private constructor(
    private readonly index: VectorizeIndex,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly referer: string
  ) {}

  static from(env: Env): VectorStore | null {
    if (!env.VECTORIZE || !env.OPENROUTER_API_KEY) return null
    return new VectorStore(
      env.VECTORIZE,
      env.OPENROUTER_API_KEY,
      env.OPENROUTER_EMBEDDING_MODEL || EMBEDDING_MODEL,
      env.WEB_ORIGIN
    )
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text])
    if (!vector) throw new Error("Embedding model returned no vector.")
    return vector
  }

  /** Embeds up to `MAX_BATCH` texts per request, preserving input order. */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const out: number[][] = []
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH) {
      out.push(
        ...(await this.requestEmbeddings(
          texts.slice(offset, offset + MAX_BATCH)
        ))
      )
    }
    return out
  }

  private async requestEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.referer,
        "X-Title": "Negotiated Memory",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(
        `Embedding request failed (${response.status}). ${detail.slice(0, 300)}`
      )
    }

    const body = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>
      error?: { message?: string }
    }
    if (body.error?.message) throw new Error(body.error.message)

    const rows = body.data ?? []
    if (rows.length !== texts.length) {
      throw new Error(
        `Expected ${texts.length} embeddings, received ${rows.length}.`
      )
    }

    // The API returns an `index` per row; sort by it rather than trusting array order, or a
    // batch could silently attach the wrong vector to the wrong memory.
    const ordered = [...rows]
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding)

    for (const vector of ordered) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `${this.model} returned ${vector.length} dimensions, but the index expects ${EMBEDDING_DIMENSIONS}.`
        )
      }
    }
    return ordered
  }

  async upsert(input: {
    id: string
    vector: number[]
    userId: string
    scopeKey: string
    status: string
    expiresAt: number
  }): Promise<void> {
    await this.index.upsert([
      {
        id: input.id,
        values: input.vector,
        // Only these four are metadata-indexed in Vectorize. Indexes cannot be backfilled,
        // so adding a fifth filterable field later means re-upserting every vector.
        metadata: {
          user_id: input.userId,
          scope_key: input.scopeKey,
          status: input.status,
          expires_at: input.expiresAt,
        },
      },
    ])
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.index.deleteByIds(ids)
  }

  /**
   * Read stored vectors back out, for comparing memories against each other.
   *
   * `query()` cannot do this job: it ranks a *probe* vector against the index and returns ids
   * only (`returnValues: false`), so building an all-pairs picture through it would cost one
   * round trip per memory. `getByIds` fetches the values themselves in batches.
   *
   * Ids with no stored vector are simply absent from the result — a memory whose `index_state`
   * is `pending` or `failed` has nothing to compare, and that is not an error.
   */
  async fetchVectors(ids: string[]): Promise<Map<string, number[]>> {
    const found = new Map<string, number[]>()

    for (let offset = 0; offset < ids.length; offset += MAX_FETCH) {
      const rows = await this.index.getByIds(
        ids.slice(offset, offset + MAX_FETCH)
      )
      for (const row of rows) {
        if (row.values) found.set(row.id, Array.from(row.values))
      }
    }
    return found
  }

  /**
   * Vectorize has no `$or`; multiple keys are implicitly AND-ed. The scope disjunction
   * survives only because it was denormalised onto `scope_key` at write time, so
   * `(global OR project=X OR session=Y)` becomes one `$in` over mutually exclusive values.
   *
   * Metadata filtering here is a genuine PRE-filter — the docs are explicit that `filter` is
   * applied first and `topK` is drawn from the filtered set — so scope is enforced before
   * ranking, not after.
   */
  async query(
    vector: number[],
    filter: VectorScopeFilter,
    topK: number
  ): Promise<VectorHit[]> {
    const result = await this.index.query(vector, {
      topK,
      returnMetadata: "none",
      returnValues: false,
      filter: {
        user_id: { $eq: filter.userId },
        status: { $eq: "active" },
        expires_at: { $gt: filter.now },
        scope_key: { $in: filter.scopeKeys },
      } as never,
    })

    return result.matches.map((match) => ({ id: match.id, score: match.score }))
  }
}
