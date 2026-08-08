import { and, asc, desc, eq } from "drizzle-orm"

import type { ChatRole, Conversation, StoredMessage } from "@workspace/shared"

import type { RequestContext } from "../context"
import { conversations, messages } from "../db/schema"
import { ids } from "../lib/id"
import { now } from "../lib/time"

/** How much history is replayed to the model. Older turns fall out; memory is what persists. */
const HISTORY_LIMIT = 24

export async function listConversations(ctx: RequestContext): Promise<Conversation[]> {
  return ctx.db
    .select({
      id: conversations.id,
      title: conversations.title,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, ctx.userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(100)
}

export async function ensureConversation(
  ctx: RequestContext,
  conversationId: string | undefined
): Promise<string> {
  const timestamp = now()

  if (conversationId) {
    const existing = await ctx.db.query.conversations.findFirst({
      where: and(eq(conversations.id, conversationId), eq(conversations.userId, ctx.userId)),
      columns: { id: true },
    })
    if (existing) return existing.id
  }

  const id = conversationId ?? ids.conversation()
  await ctx.db
    .insert(conversations)
    .values({ id, userId: ctx.userId, title: null, createdAt: timestamp, updatedAt: timestamp })
  return id
}

export async function getMessages(
  ctx: RequestContext,
  conversationId: string
): Promise<StoredMessage[]> {
  const owned = await ctx.db.query.conversations.findFirst({
    where: and(eq(conversations.id, conversationId), eq(conversations.userId, ctx.userId)),
    columns: { id: true },
  })
  if (!owned) return []

  const rows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(HISTORY_LIMIT * 2)

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatRole,
    content: row.content,
    meta: row.meta,
    createdAt: row.createdAt,
  }))
}

export async function appendMessage(
  ctx: RequestContext,
  input: { conversationId: string; role: ChatRole; content: string; meta?: unknown }
): Promise<string> {
  const id = ids.message()
  const timestamp = now()

  await ctx.db.batch([
    ctx.db.insert(messages).values({
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      meta: input.meta ? JSON.stringify(input.meta) : null,
      createdAt: timestamp,
    }),
    ctx.db
      .update(conversations)
      .set({ updatedAt: timestamp })
      .where(eq(conversations.id, input.conversationId)),
  ])

  return id
}

/** Title from the opening message — good enough, and avoids a second model call per chat. */
export async function ensureTitle(
  ctx: RequestContext,
  conversationId: string,
  firstMessage: string
): Promise<void> {
  const conversation = await ctx.db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
    columns: { title: true },
  })
  if (conversation?.title) return

  const title = firstMessage.trim().replace(/\s+/g, " ").slice(0, 60)
  await ctx.db
    .update(conversations)
    .set({ title: title.length === 60 ? `${title}…` : title })
    .where(eq(conversations.id, conversationId))
}

export async function deleteConversation(ctx: RequestContext, conversationId: string): Promise<void> {
  await ctx.db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, ctx.userId)))
}
