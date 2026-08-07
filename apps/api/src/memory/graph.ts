import { and, desc, eq } from "drizzle-orm"

import type {
  GraphGroup,
  GraphLink,
  GraphNode,
  MemoryCategory,
  MemoryGraph,
  MemoryScope,
} from "@workspace/shared"

import type { RequestContext } from "../context"
import { contexts, conversations, memories, projects } from "../db/schema"

/** Above this the layout stops being readable long before it stops being fast. */
const MAX_MEMORIES = 400

/**
 * Build the provenance graph for one user.
 *
 * NOTE: this deliberately does NOT apply the retrieval scope predicate. That predicate exists
 * to constrain *agents* — it is what stops a model in one conversation seeing another's
 * session memories. This is the owner looking at their own data through the user plane, the
 * same as the memory dashboard, which already lists everything. Reusing `visibleScopeKeys()`
 * here by reflex would silently hide most of the graph for no reason a user could work out.
 *
 * The payload is deliberately thin: a node per memory, a group per boundary, and an edge only
 * where one memory replaced another. Everything else the client needs to place a node — which
 * shell, which sector — it derives from `scope` and `group`.
 */
export async function buildGraph(ctx: RequestContext): Promise<MemoryGraph> {
  const rows = await ctx.db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, ctx.userId), eq(memories.status, "active")))
    .orderBy(desc(memories.createdAt))
    .limit(MAX_MEMORIES + 1)

  const truncated = rows.length > MAX_MEMORIES
  const active = rows.slice(0, MAX_MEMORIES)

  // Look up display names so groups read as "acme" and "Tell me about pnpm" rather than as
  // opaque ids. Superseded memories are fetched too: a supersession edge whose source has been
  // replaced still needs a node to point from.
  const [projectRows, contextRows, conversationRows, supersededRows] =
    await Promise.all([
      ctx.db.select().from(projects).where(eq(projects.userId, ctx.userId)),
      ctx.db.select().from(contexts).where(eq(contexts.userId, ctx.userId)),
      ctx.db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, ctx.userId)),
      ctx.db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.userId, ctx.userId),
            eq(memories.status, "superseded")
          )
        ),
    ])

  const projectName = new Map(
    projectRows.map((row) => [row.id, row.label ?? row.key])
  )
  const conversationTitle = new Map(
    conversationRows.map((row) => [row.id, row.title])
  )
  const contextLabel = new Map(
    contextRows.map((row) => [
      row.id,
      row.label ??
        (row.conversationId
          ? conversationTitle.get(row.conversationId)
          : null) ??
        "Untitled conversation",
    ])
  )

  const nodes: GraphNode[] = [
    {
      id: "user",
      kind: "user",
      label: "You",
      scope: null,
      category: null,
      group: null,
      createdAt: null,
      weight: 26,
    },
  ]
  const links: GraphLink[] = []
  const groupCounts = new Map<string, number>()

  /**
   * Which sector a memory belongs to, or null for no sector.
   *
   * Global memories are intentionally ungrouped — "everywhere" has no origin to subdivide by.
   * A project- or session-scoped row missing its owning id is also ungrouped rather than
   * skipped: it is still a real memory the owner should see, and dropping it made the graph
   * quietly disagree with the memory list.
   */
  function groupFor(row: (typeof active)[number]): string | null {
    if (row.scope === "project" && row.projectId)
      return `project:${row.projectId}`
    if (row.scope === "session" && row.contextId)
      return `session:${row.contextId}`
    return null
  }

  const present = new Set<string>()

  for (const row of active) {
    const group = groupFor(row)
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1)

    nodes.push({
      id: row.id,
      kind: "memory",
      label: row.fact,
      scope: row.scope as MemoryScope,
      category: row.category as MemoryCategory | null,
      group,
      createdAt: row.createdAt,
      weight: 4,
    })
    present.add(row.id)
  }

  // Split on the first colon only — a project or context id is opaque and may contain one.
  const groups: GraphGroup[] = [...groupCounts].map(([id, count]) => {
    const separator = id.indexOf(":")
    const kind = id.slice(0, separator)
    const ref = id.slice(separator + 1)

    return {
      id,
      label:
        kind === "project"
          ? (projectName.get(ref) ?? "Project")
          : (contextLabel.get(ref) ?? "Conversation"),
      scope: kind === "project" ? "project" : "session",
      count,
    }
  })

  // Supersession chains. The replaced memory carries no group — it is no longer in scope
  // anywhere, and its only remaining meaning is "this became that", so the client parks it
  // just outside its replacement rather than on any shell.
  for (const old of supersededRows) {
    if (!old.supersededBy || !present.has(old.supersededBy)) continue

    nodes.push({
      id: old.id,
      kind: "memory",
      label: old.fact,
      scope: "suppressed",
      category: old.category as MemoryCategory | null,
      group: null,
      createdAt: old.createdAt,
      weight: 3,
    })
    links.push({ source: old.id, target: old.supersededBy, kind: "supersedes" })
  }

  return { nodes, links, groups, truncated }
}
