import { and, eq } from "drizzle-orm"

import type { Db } from "../db/client"
import { contexts, projects } from "../db/schema"
import { ids } from "../lib/id"
import { CONTEXT_IDLE_TTL, now } from "../lib/time"

export interface ResolvedContainers {
  projectId: string | null
  contextId: string | null
}

/**
 * Resolve a project key to an id, scoped to the owner.
 *
 * The lookup is conjoined with `userId`, which is what makes a model-supplied `projectKey`
 * safe: it can never reach another user's project. It *can* still name a different project
 * of the same user — the one genuine authorisation gap here, and the reason a future
 * multi-tenant version should hand out opaque project handles instead of raw keys.
 */
export async function resolveProject(
  db: Db,
  userId: string,
  key: string | undefined,
  options: { create: boolean }
): Promise<string | null> {
  if (!key) return null
  const normalized = key.trim().toLowerCase()
  if (!normalized) return null

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.userId, userId), eq(projects.key, normalized)),
    columns: { id: true },
  })
  if (existing) return existing.id
  if (!options.create) return null

  const id = ids.project()
  await db.insert(projects).values({ id, userId, key: normalized, label: key.trim(), createdAt: now() })
  return id
}

/**
 * Map a conversation to its session context, creating one on first use.
 *
 * The chat app owns `conversationId` and passes it server-side, so the model never sees or
 * manages a context. That is deliberate: if the agent had to carry a handle it would
 * sometimes forget, and a forgotten handle silently changes what "session" means.
 */
export async function ensureContext(
  db: Db,
  userId: string,
  conversationId: string
): Promise<string> {
  const timestamp = now()
  const existing = await db.query.contexts.findFirst({
    where: and(eq(contexts.userId, userId), eq(contexts.conversationId, conversationId)),
    columns: { id: true },
  })

  if (existing) {
    await db
      .update(contexts)
      .set({ lastSeenAt: timestamp, expiresAt: timestamp + CONTEXT_IDLE_TTL })
      .where(eq(contexts.id, existing.id))
    return existing.id
  }

  const id = ids.context()
  await db.insert(contexts).values({
    id,
    userId,
    conversationId,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    expiresAt: timestamp + CONTEXT_IDLE_TTL,
  })
  return id
}

/** Read-only lookup — used on the retrieval path, where a missing context must not create one. */
export async function findContext(
  db: Db,
  userId: string,
  conversationId: string | undefined
): Promise<string | null> {
  if (!conversationId) return null
  const row = await db.query.contexts.findFirst({
    where: and(eq(contexts.userId, userId), eq(contexts.conversationId, conversationId)),
    columns: { id: true },
  })
  return row?.id ?? null
}

export async function resolveContainers(
  db: Db,
  userId: string,
  input: { conversationId?: string; projectKey?: string },
  options: { create: boolean }
): Promise<ResolvedContainers> {
  const [projectId, contextId] = await Promise.all([
    resolveProject(db, userId, input.projectKey, options),
    options.create && input.conversationId
      ? ensureContext(db, userId, input.conversationId)
      : findContext(db, userId, input.conversationId),
  ])
  return { projectId, contextId }
}
