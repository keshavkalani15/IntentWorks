import { Hono } from "hono"

import {
  bulkMemoryInput,
  listMemoriesQuery,
  rescopeMemoryInput,
} from "@workspace/shared"

import type { AppBindings } from "../env"
import { badRequest, notFound } from "../lib/errors"
import { resolveContainers } from "../memory/containers"
import {
  countMemoriesByScope,
  deleteAllMemories,
  deleteMemory,
  getMemory,
  getTimeline,
  listMemories,
  rescopeMemory,
  suppressMemory,
  toMemory,
} from "../memory/store"
import { contextFrom, requireUser } from "../middleware/auth"

/**
 * The user plane. Everything here can commit, so everything here is behind `requireUser`
 * and none of it is reachable by an agent.
 */
export const memoriesRoute = new Hono<AppBindings>()

memoriesRoute.use("*", requireUser)

memoriesRoute.get("/", async (c) => {
  const parsed = listMemoriesQuery.safeParse(c.req.query())
  if (!parsed.success) throw badRequest("invalid_query", "Invalid filters.", parsed.error.issues)

  const ctx = contextFrom(c)
  const [items, counts] = await Promise.all([
    listMemories(ctx, parsed.data),
    countMemoriesByScope(ctx),
  ])
  return c.json({ items, counts })
})

memoriesRoute.get("/:id", async (c) => {
  const ctx = contextFrom(c)
  const row = await getMemory(ctx.db, ctx.userId, c.req.param("id"))
  if (!row) throw notFound("No such memory.")
  return c.json({ memory: toMemory(row) })
})

memoriesRoute.get("/:id/timeline", async (c) => {
  const ctx = contextFrom(c)
  const id = c.req.param("id")
  const row = await getMemory(ctx.db, ctx.userId, id)
  if (!row) throw notFound("No such memory.")

  return c.json({ memory: toMemory(row), events: await getTimeline(ctx, id) })
})

memoriesRoute.patch("/:id/scope", async (c) => {
  const parsed = rescopeMemoryInput.safeParse(await c.req.json())
  if (!parsed.success) throw badRequest("invalid_body", "Invalid scope.", parsed.error.issues)

  const ctx = contextFrom(c)
  const id = c.req.param("id")
  const existing = await getMemory(ctx.db, ctx.userId, id)
  if (!existing) throw notFound("No such memory.")

  // Re-scoping to `session` needs a context to attach to; re-use the memory's own if it has
  // one. Without that the memory would land in a scope nothing can ever read.
  const containers = await resolveContainers(ctx.db, ctx.userId, {}, { create: false })
  const updated = await rescopeMemory(ctx, id, parsed.data.scope, {
    projectId: containers.projectId ?? existing.projectId,
    contextId: containers.contextId ?? existing.contextId,
  })
  if (!updated) throw notFound("No such memory.")

  return c.json({ memory: updated })
})

memoriesRoute.post("/:id/suppress", async (c) => {
  const ctx = contextFrom(c)
  const id = c.req.param("id")
  if (!(await getMemory(ctx.db, ctx.userId, id))) throw notFound("No such memory.")

  await suppressMemory(ctx, id)
  return c.json({ ok: true })
})

memoriesRoute.delete("/:id", async (c) => {
  const ctx = contextFrom(c)
  const id = c.req.param("id")
  if (!(await getMemory(ctx.db, ctx.userId, id))) throw notFound("No such memory.")

  await deleteMemory(ctx, id)
  return c.json({ ok: true })
})

memoriesRoute.post("/bulk", async (c) => {
  const parsed = bulkMemoryInput.safeParse(await c.req.json())
  if (!parsed.success) throw badRequest("invalid_body", "Invalid bulk action.", parsed.error.issues)
  if (parsed.data.action === "rescope" && !parsed.data.scope) {
    throw badRequest("invalid_body", "A scope is required to re-scope.")
  }

  const ctx = contextFrom(c)
  const containers = await resolveContainers(ctx.db, ctx.userId, {}, { create: false })

  let changed = 0
  for (const id of parsed.data.ids) {
    const existing = await getMemory(ctx.db, ctx.userId, id)
    if (!existing) continue

    if (parsed.data.action === "rescope") {
      await rescopeMemory(ctx, id, parsed.data.scope!, {
        projectId: containers.projectId ?? existing.projectId,
        contextId: containers.contextId ?? existing.contextId,
      })
    } else if (parsed.data.action === "suppress") {
      await suppressMemory(ctx, id)
    } else {
      await deleteMemory(ctx, id)
    }
    changed++
  }

  return c.json({ ok: true, changed })
})

memoriesRoute.get("/export/all", async (c) => {
  const ctx = contextFrom(c)
  const items = await listMemories(ctx, { status: "active", limit: 100, offset: 0 })
  return c.json({ exportedAt: Date.now(), count: items.length, memories: items })
})

/**
 * Erase everything, including tombstones.
 *
 * Deliberately total: leaving the tombstones behind would mean facts the user declined stay
 * on record after they asked for a clean slate, and would silently keep suppressing
 * proposals they may now want.
 */
memoriesRoute.delete("/", async (c) => {
  const ctx = contextFrom(c)
  const deleted = await deleteAllMemories(ctx)
  return c.json({ ok: true, deleted })
})
