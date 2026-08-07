import { and, desc, eq, inArray, like, sql } from "drizzle-orm"

import type {
  Memory,
  MemoryCategory,
  MemoryEventKind,
  MemoryScope,
  SelectableScope,
} from "@workspace/shared"
import {
  NEVER_EXPIRES,
  projectScopeKey,
  sessionScopeKey,
} from "@workspace/shared"

import type { RequestContext } from "../context"
import type { Db } from "../db/client"
import type { MemoryRow } from "../db/schema"
import {
  memories,
  memoriesFts,
  memoryEvents,
  negotiationCooldowns,
} from "../db/schema"
import { ids } from "../lib/id"
import { EMBEDDING_MODEL } from "./vector"
import { now } from "../lib/time"

export function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    fact: row.fact,
    category: (row.category as MemoryCategory | null) ?? null,
    scope: row.scope as MemoryScope,
    projectId: row.projectId,
    contextId: row.contextId,
    status: row.status as Memory["status"],
    confidence: row.confidence,
    originClient: row.originClient,
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
    lastConfirmed: row.lastConfirmed,
    expiresAt: row.expiresAt,
  }
}

/** Recompute the scope key exactly as the generated column does, for the vector metadata. */
export function scopeKeyFor(row: {
  scope: MemoryScope
  projectId: string | null
  contextId: string | null
}): string {
  if (row.scope === "global") return "global"
  if (row.scope === "project") return projectScopeKey(row.projectId ?? "")
  if (row.scope === "session") return sessionScopeKey(row.contextId ?? "")
  return "suppressed"
}

function eventRow(input: {
  userId: string
  memoryId: string | null
  actor: string
  event: MemoryEventKind
  from?: string | null
  to?: string | null
  at: number
}) {
  return {
    memoryId: input.memoryId,
    userId: input.userId,
    actor: input.actor,
    event: input.event,
    fromValue: input.from ?? null,
    toValue: input.to ?? null,
    at: input.at,
  }
}

// ---------------------------------------------------------------------------
// Lookups used by the negotiation guards
// ---------------------------------------------------------------------------

/** Has the user already declined this exact fact? Tombstones are permanent by design. */
export async function findTombstone(db: Db, userId: string, factFp: string) {
  return db.query.memories.findFirst({
    where: and(
      eq(memories.userId, userId),
      eq(memories.factFp, factFp),
      eq(memories.status, "suppressed")
    ),
    columns: { id: true, fact: true },
  })
}

export async function findActiveByFingerprint(
  db: Db,
  userId: string,
  factFp: string
) {
  return db.query.memories.findFirst({
    where: and(
      eq(memories.userId, userId),
      eq(memories.factFp, factFp),
      eq(memories.status, "active")
    ),
  })
}

export async function getMemory(db: Db, userId: string, id: string) {
  return db.query.memories.findFirst({
    where: and(eq(memories.id, id), eq(memories.userId, userId)),
  })
}

// ---------------------------------------------------------------------------
// Writes
//
// D1 has no interactive transactions — `BEGIN` errors — so `db.batch()` is the only
// atomicity primitive. Every write below keeps the memory row, its FTS mirror and its
// audit event in one batch, so those three can never disagree.
// ---------------------------------------------------------------------------

export interface CommitMemoryInput {
  fact: string
  factFp: string
  category: MemoryCategory
  scope: SelectableScope
  projectId: string | null
  contextId: string | null
  confidence: number | null
  negotiationId: string
  supersedes?: string | null
  /**
   * Which client PROPOSED this fact — not who approved it.
   *
   * The two are never the same over MCP: an external agent proposes, and the human approves
   * from a browser, so `ctx.clientId` at commit time is always `web`. Taking the origin from
   * the context would therefore record every MCP-proposed memory as having come from the web
   * app, quietly erasing the provenance that `memories.origin_client` exists to hold.
   *
   * Passed explicitly from the frozen negotiation row, which recorded the real proposer at
   * phase one.
   */
  originClient: string
}

export async function commitMemory(
  ctx: RequestContext,
  input: CommitMemoryInput
): Promise<Memory> {
  const id = ids.memory()
  const timestamp = now()

  const row: MemoryRow = {
    id,
    userId: ctx.userId,
    fact: input.fact,
    factFp: input.factFp,
    category: input.category,
    scope: input.scope,
    projectId: input.scope === "project" ? input.projectId : null,
    contextId: input.scope === "session" ? input.contextId : null,
    scopeKey: scopeKeyFor({
      scope: input.scope,
      projectId: input.projectId,
      contextId: input.contextId,
    }),
    status: "active",
    confidence: input.confidence,
    originClient: input.originClient,
    sourceRefs: null,
    supersededBy: null,
    negotiationId: input.negotiationId,
    createdAt: timestamp,
    lastConfirmed: timestamp,
    expiresAt: NEVER_EXPIRES,
    indexState: "pending",
    indexedAt: null,
    embedModel: null,
  }

  // `negotiation_id` is UNIQUE, so a replayed resolve cannot produce a second memory —
  // and, more importantly, cannot land at a wider scope than the first one did.
  const { scopeKey: _generated, ...insertable } = row

  await ctx.db.batch([
    ctx.db.insert(memories).values(insertable),
    ctx.db.insert(memoriesFts).values({ memoryId: id, fact: input.fact }),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: id,
        actor: "user",
        event: "accepted",
        to: input.scope,
        at: timestamp,
      })
    ),
  ])

  if (input.supersedes) {
    await supersede(ctx, input.supersedes, id)
  }

  scheduleIndex(ctx, row)
  return toMemory(row)
}

/**
 * Record that the user declined a fact.
 *
 * Stored as a real row with `status='suppressed'` rather than a separate tombstone table so
 * that dedupe, the timeline and "what have I refused?" all read from one place. It never
 * reaches retrieval: the scope predicate is an allow-list with no `suppressed` arm.
 */
export async function tombstone(
  ctx: RequestContext,
  input: {
    fact: string
    factFp: string
    category: MemoryCategory
    negotiationId: string
    /** The client that proposed the refused fact — see `CommitMemoryInput.originClient`. */
    originClient: string
  }
): Promise<void> {
  const timestamp = now()
  await ctx.db.batch([
    ctx.db.insert(memories).values({
      id: ids.memory(),
      userId: ctx.userId,
      fact: input.fact,
      factFp: input.factFp,
      category: input.category,
      scope: "suppressed",
      projectId: null,
      contextId: null,
      status: "suppressed",
      confidence: null,
      originClient: input.originClient,
      sourceRefs: null,
      supersededBy: null,
      negotiationId: input.negotiationId,
      createdAt: timestamp,
      lastConfirmed: null,
      expiresAt: NEVER_EXPIRES,
      indexState: "tombstoned",
      indexedAt: null,
      embedModel: null,
    }),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: null,
        actor: "user",
        event: "declined",
        to: input.fact,
        at: timestamp,
      })
    ),
  ])
}

export async function suppressMemory(
  ctx: RequestContext,
  id: string
): Promise<void> {
  const timestamp = now()
  await ctx.db.batch([
    ctx.db
      .update(memories)
      .set({
        status: "suppressed",
        scope: "suppressed",
        indexState: "tombstoned",
      })
      .where(and(eq(memories.id, id), eq(memories.userId, ctx.userId))),
    ctx.db.delete(memoriesFts).where(eq(memoriesFts.memoryId, id)),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: id,
        actor: "user",
        event: "suppressed",
        at: timestamp,
      })
    ),
  ])

  // The vector may survive for seconds after this returns — Vectorize deletes are async.
  // Retrieval re-checks every hit against D1 precisely so that window cannot leak.
  ctx.waitUntil(ctx.vectors?.remove([id]) ?? Promise.resolve())
}

export async function rescopeMemory(
  ctx: RequestContext,
  id: string,
  scope: SelectableScope,
  containers: { projectId: string | null; contextId: string | null }
): Promise<Memory | null> {
  const existing = await getMemory(ctx.db, ctx.userId, id)
  if (!existing) return null

  const timestamp = now()
  const projectId =
    scope === "project" ? (containers.projectId ?? existing.projectId) : null
  const contextId =
    scope === "session" ? (containers.contextId ?? existing.contextId) : null

  await ctx.db.batch([
    ctx.db
      .update(memories)
      .set({ scope, projectId, contextId, indexState: "pending" })
      .where(and(eq(memories.id, id), eq(memories.userId, ctx.userId))),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: id,
        actor: "user",
        event: "rescoped",
        from: existing.scope,
        to: scope,
        at: timestamp,
      })
    ),
  ])

  const updated: MemoryRow = {
    ...existing,
    scope,
    projectId,
    contextId,
    indexState: "pending",
  }
  updated.scopeKey = scopeKeyFor({ scope, projectId, contextId })
  scheduleIndex(ctx, updated)
  return toMemory(updated)
}

async function supersede(
  ctx: RequestContext,
  oldId: string,
  newId: string
): Promise<void> {
  const timestamp = now()
  await ctx.db.batch([
    ctx.db
      .update(memories)
      .set({ status: "superseded", supersededBy: newId })
      .where(and(eq(memories.id, oldId), eq(memories.userId, ctx.userId))),
    ctx.db.delete(memoriesFts).where(eq(memoriesFts.memoryId, oldId)),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: oldId,
        actor: "user",
        event: "superseded",
        to: newId,
        at: timestamp,
      })
    ),
  ])
  ctx.waitUntil(ctx.vectors?.remove([oldId]) ?? Promise.resolve())
}

/** Wipe every memory, its FTS mirror, tombstones and cooldowns. Returns how many went. */
export async function deleteAllMemories(ctx: RequestContext): Promise<number> {
  const rows = await ctx.db
    .select({ id: memories.id })
    .from(memories)
    .where(eq(memories.userId, ctx.userId))
  if (rows.length === 0) return 0

  const ids = rows.map((row) => row.id)

  await ctx.db.batch([
    ctx.db.delete(memories).where(eq(memories.userId, ctx.userId)),
    ctx.db.delete(memoriesFts).where(inArray(memoriesFts.memoryId, ids)),
    // Cooldowns outliving their memories would keep blocking proposals for facts that no
    // longer exist, which reads as the assistant refusing to learn.
    ctx.db
      .delete(negotiationCooldowns)
      .where(eq(negotiationCooldowns.userId, ctx.userId)),
    ctx.db.insert(memoryEvents).values(
      eventRow({
        userId: ctx.userId,
        memoryId: null,
        actor: "user",
        event: "suppressed",
        to: `Erased ${ids.length} memories`,
        at: now(),
      })
    ),
  ])

  ctx.waitUntil(ctx.vectors?.remove(ids) ?? Promise.resolve())
  return ids.length
}

export async function deleteMemory(
  ctx: RequestContext,
  id: string
): Promise<void> {
  await ctx.db.batch([
    ctx.db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, ctx.userId))),
    ctx.db.delete(memoriesFts).where(eq(memoriesFts.memoryId, id)),
  ])
  ctx.waitUntil(ctx.vectors?.remove([id]) ?? Promise.resolve())
}

/**
 * Embed and index, off the response path.
 *
 * When Vectorize is not bound the row simply stays `index_state='pending'`, which is the
 * honest state: enabling semantic search later means backfilling exactly those rows.
 */
function scheduleIndex(ctx: RequestContext, row: MemoryRow): void {
  const vectors = ctx.vectors
  if (!vectors || row.status !== "active") return

  ctx.waitUntil(
    (async () => {
      try {
        const vector = await vectors.embed(row.fact)
        await vectors.upsert({
          id: row.id,
          vector,
          userId: row.userId,
          scopeKey: row.scopeKey ?? scopeKeyFor(row as never),
          status: row.status,
          expiresAt: row.expiresAt,
        })
        await ctx.db
          .update(memories)
          .set({
            indexState: "indexed",
            indexedAt: now(),
            embedModel: EMBEDDING_MODEL,
          })
          .where(eq(memories.id, row.id))
      } catch (error) {
        // The memory itself is already committed to D1 — only its vector is missing. The row
        // is marked so a later backfill can find it, and the cause is logged rather than lost.
        console.error("indexing failed", { memoryId: row.id, error })
        await ctx.db
          .update(memories)
          .set({ indexState: "failed" })
          .where(eq(memories.id, row.id))
      }
    })()
  )
}

// ---------------------------------------------------------------------------
// Reads for the dashboard
// ---------------------------------------------------------------------------

export async function listMemories(
  ctx: RequestContext,
  query: {
    scope?: MemoryScope
    status: Memory["status"]
    category?: MemoryCategory
    q?: string
    limit: number
    offset: number
  }
): Promise<Memory[]> {
  const filters = [
    eq(memories.userId, ctx.userId),
    eq(memories.status, query.status),
  ]
  if (query.scope) filters.push(eq(memories.scope, query.scope))
  if (query.category) filters.push(eq(memories.category, query.category))
  if (query.q) filters.push(like(memories.fact, `%${query.q}%`))

  const rows = await ctx.db
    .select()
    .from(memories)
    .where(and(...filters))
    .orderBy(desc(memories.createdAt))
    .limit(query.limit)
    .offset(query.offset)

  return rows.map(toMemory)
}

export async function countMemoriesByScope(ctx: RequestContext) {
  const rows = await ctx.db
    .select({ scope: memories.scope, count: sql<number>`count(*)` })
    .from(memories)
    .where(and(eq(memories.userId, ctx.userId), eq(memories.status, "active")))
    .groupBy(memories.scope)

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.scope] = Number(row.count)
    return acc
  }, {})
}

export async function getTimeline(ctx: RequestContext, memoryId: string) {
  return ctx.db
    .select()
    .from(memoryEvents)
    .where(
      and(
        eq(memoryEvents.userId, ctx.userId),
        eq(memoryEvents.memoryId, memoryId)
      )
    )
    .orderBy(memoryEvents.at)
}
