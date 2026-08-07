import { and, desc, eq, gte, sql } from "drizzle-orm"

import type { ActivityEntry, Stats } from "@workspace/shared"

import type { RequestContext } from "../context"
import { conversations, memories, memoryEvents, negotiations } from "../db/schema"
import { DAY, now } from "../lib/time"

/** Trailing window for the activity chart. */
const WINDOW_DAYS = 30
const RECENT_EVENTS = 25

function countBy(rows: Array<{ key: string | null; count: number }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (row.key) acc[row.key] = Number(row.count)
    return acc
  }, {})
}

/**
 * Everything the home dashboard shows, in one round trip.
 *
 * The interesting number here is the acceptance rate — it is the only place the product
 * reports on itself. A very high rate means the agent is only proposing the obvious; a very
 * low one means it is pestering. Neither is visible from a memory count alone.
 */
export async function getStats(ctx: RequestContext): Promise<Stats> {
  const timestamp = now()
  const windowStart = timestamp - WINDOW_DAYS * DAY

  const [byStatus, byScope, byCategory, bounds, byNegotiation, conversationCount, added, recent] =
    await Promise.all([
      ctx.db
        .select({ key: memories.status, count: sql<number>`count(*)` })
        .from(memories)
        .where(eq(memories.userId, ctx.userId))
        .groupBy(memories.status),

      ctx.db
        .select({ key: memories.scope, count: sql<number>`count(*)` })
        .from(memories)
        .where(and(eq(memories.userId, ctx.userId), eq(memories.status, "active")))
        .groupBy(memories.scope),

      ctx.db
        .select({ key: memories.category, count: sql<number>`count(*)` })
        .from(memories)
        .where(and(eq(memories.userId, ctx.userId), eq(memories.status, "active")))
        .groupBy(memories.category),

      ctx.db
        .select({
          first: sql<number | null>`min(${memories.createdAt})`,
          latest: sql<number | null>`max(${memories.createdAt})`,
        })
        .from(memories)
        .where(and(eq(memories.userId, ctx.userId), eq(memories.status, "active"))),

      ctx.db
        .select({ key: negotiations.status, count: sql<number>`count(*)` })
        .from(negotiations)
        .where(eq(negotiations.userId, ctx.userId))
        .groupBy(negotiations.status),

      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(conversations)
        .where(eq(conversations.userId, ctx.userId)),

      // Bucketed in JS rather than SQL: SQLite date maths would need the millisecond epoch
      // divided and floored, and D1's SQLite version is unpublished. A month of rows is tiny.
      ctx.db
        .select({ createdAt: memories.createdAt })
        .from(memories)
        .where(
          and(
            eq(memories.userId, ctx.userId),
            eq(memories.status, "active"),
            gte(memories.createdAt, windowStart)
          )
        ),

      ctx.db
        .select({
          id: memoryEvents.id,
          event: memoryEvents.event,
          actor: memoryEvents.actor,
          at: memoryEvents.at,
          memoryId: memoryEvents.memoryId,
          toValue: memoryEvents.toValue,
          fact: memories.fact,
          scope: memories.scope,
        })
        .from(memoryEvents)
        // Left join: a decline records the fact but never creates a memory row to join to.
        .leftJoin(memories, eq(memories.id, memoryEvents.memoryId))
        .where(eq(memoryEvents.userId, ctx.userId))
        .orderBy(desc(memoryEvents.at))
        .limit(RECENT_EVENTS),
    ])

  const statuses = countBy(byStatus)
  const negotiationStatuses = countBy(byNegotiation)

  const accepted = negotiationStatuses.accepted ?? 0
  const declined = negotiationStatuses.declined ?? 0
  const cancelled = negotiationStatuses.cancelled ?? 0
  const answered = accepted + declined

  return {
    memories: {
      active: statuses.active ?? 0,
      suppressed: statuses.suppressed ?? 0,
      superseded: statuses.superseded ?? 0,
      byScope: countBy(byScope),
      byCategory: countBy(byCategory),
      firstAt: bounds[0]?.first ?? null,
      latestAt: bounds[0]?.latest ?? null,
    },
    proposals: {
      total: Object.values(negotiationStatuses).reduce((sum, value) => sum + value, 0),
      accepted,
      declined,
      cancelled,
      pending: negotiationStatuses.pending ?? 0,
      // Dismissals are excluded: "not now" is not a judgement on the fact.
      acceptanceRate: answered > 0 ? accepted / answered : null,
    },
    conversations: Number(conversationCount[0]?.count ?? 0),
    activityByDay: bucketByDay(
      added.map((row) => row.createdAt),
      timestamp
    ),
    recent: recent.map(
      (row): ActivityEntry => ({
        id: row.id,
        event: row.event as ActivityEntry["event"],
        actor: row.actor,
        at: row.at,
        memoryId: row.memoryId,
        fact: row.fact ?? row.toValue,
        scope: (row.scope as ActivityEntry["scope"]) ?? null,
      })
    ),
  }
}

/** One bucket per day across the whole window, so empty days still render as gaps. */
function bucketByDay(timestamps: number[], nowMs: number): Array<{ day: number; added: number }> {
  const startOfToday = Math.floor(nowMs / DAY) * DAY
  const buckets = new Map<number, number>()

  for (let index = WINDOW_DAYS - 1; index >= 0; index--) {
    buckets.set(startOfToday - index * DAY, 0)
  }

  for (const timestamp of timestamps) {
    const day = Math.floor(timestamp / DAY) * DAY
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }

  return [...buckets.entries()].map(([day, added]) => ({ day, added }))
}
