import { and, eq, gt, inArray, sql } from "drizzle-orm"

import type { MemoryCategory, RetrievedMemory } from "@workspace/shared"
import { visibleScopeKeys } from "@workspace/shared"

import type { RequestContext } from "../context"
import type { MemoryRow } from "../db/schema"
import { memories } from "../db/schema"
import { now } from "../lib/time"
import { toMemory } from "./store"

/** Reciprocal-rank-fusion constant. 60 is the value from the original RRF paper. */
const RRF_K = 60

/** Over-fetch from each arm so fusion has something to work with before truncating. */
const CANDIDATE_MULTIPLIER = 4

/**
 * Minimum similarity for a semantic hit to count as a hit.
 *
 * Vectorize returns the nearest `topK` with NO relevance floor — it ranks everything and
 * hands back the top slice. On a small memory store that means every query returns the
 * entire store, so a greeting pulls in your whole history and the model is told those facts
 * are relevant when they are not.
 *
 * Measured against google/gemini-embedding-2 at 1536 dimensions, on real memories:
 *
 *   unrelated  "hi darling", "what is the weather"      peaked at 0.58
 *   related    "what sweets do I like?", "my name?"     bottomed at 0.65
 *
 * 0.62 sits in that gap. THIS NUMBER IS MODEL-SPECIFIC: embedding models have completely
 * different score distributions, so re-measure it if OPENROUTER_EMBEDDING_MODEL changes.
 * Raise it if unrelated facts leak in; lower it if obvious matches go missing.
 */
const MIN_SEMANTIC_SCORE = 0.62

/**
 * How long the semantic arm gets before the turn moves on without it.
 *
 * This arm makes two network calls — an embedding request and a Vectorize query — on a path
 * a user is actively waiting on. Unbounded, a slow index does not degrade retrieval, it
 * freezes the entire conversation: `Promise.all` below waits forever while the UI shows a
 * spinner. Keyword results are already good enough to answer with, so a late semantic result
 * is worth less than a prompt reply.
 */
const SEMANTIC_TIMEOUT_MS = 2500

/** Resolves to `fallback` if `work` has not finished in time. The work is abandoned, not cancelled. */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`${label} exceeded ${ms}ms — continuing without it`)
          resolve(fallback)
        }, ms)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Words that match nearly every stored fact and so contribute no signal, only noise.
 * Deliberately tiny — an aggressive stoplist hurts recall more than it helps precision.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "you", "your", "was", "are", "what", "who", "how", "why",
  "does", "did", "with", "that", "this", "have", "has", "his", "her", "its",
  "about", "from", "they", "them", "our", "can", "will", "would", "should",
])

/**
 * Turn free text into a safe FTS5 MATCH expression.
 *
 * Every term is quoted, which is what stops a user query containing `AND`, `*`, `:` or an
 * unbalanced quote from either erroring or being reinterpreted as FTS5 syntax. Terms are
 * OR-ed with a prefix wildcard so "prefer" finds "preference".
 */
function toMatchExpression(input: string): string | null {
  const terms = (input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
    .slice(0, 12)

  if (terms.length === 0) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" OR ")
}

export interface SearchOptions {
  query: string
  projectId: string | null
  contextId: string | null
  categories?: MemoryCategory[]
  limit: number
}

/**
 * THE retrieval path. Everything a model is allowed to see comes through here.
 *
 * Scope is enforced in SQL, before ranking, on both arms — never by asking a model to
 * behave. The predicate is an ALLOW-list of scope keys: `suppressed` has no arm, so
 * declined facts are unreachable by construction rather than by remembering to exclude
 * them, and a scope added later stays invisible until someone adds an arm here.
 */
export async function searchMemories(
  ctx: RequestContext,
  options: SearchOptions
): Promise<RetrievedMemory[]> {
  const timestamp = now()
  const scopeKeys = visibleScopeKeys({
    projectId: options.projectId,
    contextId: options.contextId,
  })
  const candidates = options.limit * CANDIDATE_MULTIPLIER

  const [keywordHits, semanticHits] = await Promise.all([
    keywordSearch(ctx, options.query, scopeKeys, timestamp, candidates),
    withTimeout(
      semanticSearch(ctx, options.query, scopeKeys, timestamp, candidates),
      SEMANTIC_TIMEOUT_MS,
      [],
      "semantic search"
    ),
  ])

  const fused = fuse([
    { source: "keyword" as const, ids: keywordHits },
    { source: "semantic" as const, ids: semanticHits },
  ])
  if (fused.length === 0) return []

  // Authoritative re-check against D1. The keyword arm is already filtered, but a Vectorize
  // hit may be seconds stale — deletes there are asynchronous — so a memory suppressed a
  // moment ago can still come back from the index. This is where that is caught.
  const rows = await fetchVisible(
    ctx,
    fused.map((entry) => entry.id),
    scopeKeys,
    timestamp,
    options.categories
  )
  const byId = new Map(rows.map((row) => [row.id, row]))

  return fused
    .flatMap((entry) => {
      const row = byId.get(entry.id)
      if (!row) return []
      return [{ ...toMemory(row), score: entry.score, matchedBy: entry.matchedBy }]
    })
    .slice(0, options.limit)
}

/**
 * Keyword arm, over D1's FTS5 index.
 *
 * The FTS mirror is written in the same `db.batch()` as the memory itself, so this arm never
 * lags — which is what gives the app read-your-writes even while the vector index catches up.
 */
async function keywordSearch(
  ctx: RequestContext,
  query: string,
  scopeKeys: string[],
  timestamp: number,
  limit: number
): Promise<string[]> {
  const match = toMatchExpression(query)
  if (!match) return []

  const keys = sql.join(
    scopeKeys.map((key) => sql`${key}`),
    sql`, `
  )

  try {
    const result = await ctx.db.all<{ id: string }>(sql`
      SELECT memories_fts.memory_id AS id
      FROM memories_fts
      JOIN memories m ON m.id = memories_fts.memory_id
      WHERE memories_fts MATCH ${match}
        AND m.user_id    = ${ctx.userId}
        AND m.status     = 'active'
        AND m.expires_at > ${timestamp}
        AND m.scope_key IN (${keys})
      ORDER BY bm25(memories_fts)
      LIMIT ${limit}
    `)
    return result.map((row) => row.id)
  } catch (error) {
    // A malformed MATCH expression must degrade to "no keyword hits", never to a 500 that
    // takes the whole chat turn down with it. Logged, because silently returning nothing
    // looks identical to "the user has no memories".
    console.error("keyword search failed", { query, error })
    return []
  }
}

/** Semantic arm. Absent whenever Vectorize is not bound. */
async function semanticSearch(
  ctx: RequestContext,
  query: string,
  scopeKeys: string[],
  timestamp: number,
  limit: number
): Promise<string[]> {
  const vectors = ctx.vectors
  if (!vectors) return []

  try {
    // Timed separately: the two calls fail and stall for completely different reasons, and a
    // single combined number cannot tell you which one to go and fix.
    const startedEmbed = Date.now()
    const vector = await vectors.embed(query)
    const embedMs = Date.now() - startedEmbed

    const startedQuery = Date.now()
    const hits = await vectors.query(vector, { userId: ctx.userId, scopeKeys, now: timestamp }, limit)
    const queryMs = Date.now() - startedQuery

    const relevant = hits.filter((hit) => hit.score >= MIN_SEMANTIC_SCORE)

    if (embedMs + queryMs > 1000) {
      console.warn("semantic search slow", { embedMs, queryMs })
    }
    return relevant.map((hit) => hit.id)
  } catch (error) {
    // Vectorize or the embedding API being unreachable degrades recall to keyword-only,
    // which is survivable — but it must be visible, not silent.
    console.error("semantic search failed", { error })
    return []
  }
}

interface FusedEntry {
  id: string
  score: number
  matchedBy: RetrievedMemory["matchedBy"]
}

/**
 * Reciprocal rank fusion.
 *
 * Chosen over score normalisation because bm25 and cosine live on incomparable scales, and
 * any attempt to map them onto one another needs constants that drift with the corpus.
 * RRF only needs the ranks.
 */
function fuse(
  lists: Array<{ source: "keyword" | "semantic"; ids: string[] }>
): FusedEntry[] {
  const scores = new Map<string, FusedEntry>()

  for (const list of lists) {
    list.ids.forEach((id, index) => {
      const existing = scores.get(id)
      const contribution = 1 / (RRF_K + index + 1)
      if (existing) {
        existing.score += contribution
        if (!existing.matchedBy.includes(list.source)) existing.matchedBy.push(list.source)
      } else {
        scores.set(id, { id, score: contribution, matchedBy: [list.source] })
      }
    })
  }

  return [...scores.values()].sort((a, b) => b.score - a.score)
}

/**
 * The scope predicate, applied to a candidate set. The single security boundary of retrieval.
 *
 * Built with the query builder rather than raw SQL specifically so the returned rows carry
 * Drizzle's camelCase field names. A `SELECT *` here yields snake_case columns, and the
 * camelCase reads in `toMemory` would silently resolve to `undefined` — dropping
 * provenance from every result without failing anywhere.
 */
async function fetchVisible(
  ctx: RequestContext,
  memoryIds: string[],
  scopeKeys: string[],
  timestamp: number,
  categories?: MemoryCategory[]
): Promise<MemoryRow[]> {
  if (memoryIds.length === 0) return []

  const filters = [
    eq(memories.userId, ctx.userId),
    eq(memories.status, "active"),
    gt(memories.expiresAt, timestamp),
    inArray(memories.scopeKey, scopeKeys),
    inArray(memories.id, memoryIds),
  ]
  if (categories && categories.length > 0) {
    filters.push(inArray(memories.category, categories))
  }

  return ctx.db
    .select()
    .from(memories)
    .where(and(...filters))
}

/**
 * Nearest stored fact to a proposed one, used to offer a merge instead of a near-duplicate.
 * Returns null when semantic search is unavailable — a missed merge is a cosmetic loss.
 */
export async function findNearDuplicate(
  ctx: RequestContext,
  fact: string,
  containers: { projectId: string | null; contextId: string | null },
  threshold = 0.9
): Promise<{ id: string; fact: string } | null> {
  const vectors = ctx.vectors
  if (!vectors) return null

  try {
    const timestamp = now()
    const vector = await withTimeout(vectors.embed(fact), SEMANTIC_TIMEOUT_MS, null, "near-duplicate embed")
    if (!vector) return null
    const hits = await vectors.query(
      vector,
      { userId: ctx.userId, scopeKeys: visibleScopeKeys(containers), now: timestamp },
      1
    )

    const best = hits[0]
    if (!best || best.score < threshold) return null

    const rows = await fetchVisible(ctx, [best.id], visibleScopeKeys(containers), timestamp)
    const row = rows[0]
    return row ? { id: row.id, fact: row.fact } : null
  } catch (error) {
    console.error("near-duplicate lookup failed", { error })
    return null
  }
}
