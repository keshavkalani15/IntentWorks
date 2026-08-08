import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import { sendMessageInput } from "@workspace/shared"

import { ensureConversation } from "../chat/conversations"
import { runAcknowledgement, runAgentLoop } from "../chat/loop"
import type { AppBindings } from "../env"
import { badRequest, notFound, serviceUnavailable } from "../lib/errors"
import { ensureContext } from "../memory/containers"
import { getOutcome } from "../memory/negotiation"
import { contextFrom, requireUser } from "../middleware/auth"

export const chatRoute = new Hono<AppBindings>()

chatRoute.use("*", requireUser)

chatRoute.post("/", async (c) => {
  if (!c.env.OPENROUTER_API_KEY) {
    throw serviceUnavailable(
      "missing_openrouter_key",
      "OPENROUTER_API_KEY is not set. Add it to apps/api/.dev.vars and restart."
    )
  }

  const parsed = sendMessageInput.safeParse(await c.req.json())
  if (!parsed.success) throw badRequest("invalid_body", "Invalid message.", parsed.error.issues)
  if (!parsed.data.message.trim() && (parsed.data.images?.length ?? 0) === 0) {
    throw badRequest("empty_message", "Send some text or at least one image.")
  }

  const ctx = contextFrom(c)
  const conversationId = await ensureConversation(ctx, parsed.data.conversationId ?? undefined)

  // Bind the conversation to a session context up front, so `session` is a scope the user
  // can actually be offered on the very first proposal of a brand-new chat.
  await ensureContext(ctx.db, ctx.userId, conversationId)

  return streamSSE(c, async (stream) => {
    // The SSE frame carries the conversation id first, so a client that started without one
    // can attach subsequent turns to the right thread.
    await stream.writeSSE({ data: JSON.stringify({ type: "conversation", conversationId }) })

    for await (const event of runAgentLoop(
      ctx,
      c.env,
      {
        conversationId,
        userMessage: parsed.data.message,
        images: parsed.data.images,
        projectKey: parsed.data.projectKey,
      },
      c.req.raw.signal
    )) {
      await stream.writeSSE({ data: JSON.stringify(event) })
    }
  })
})

/**
 * A short spoken confirmation after the user answers a proposal.
 *
 * Separate from `resolve`, which stays a plain JSON commit — the write must not depend on a
 * model call succeeding. This is purely the conversational follow-up, and it is safe to fail.
 */
chatRoute.post("/acknowledge", async (c) => {
  if (!c.env.OPENROUTER_API_KEY) throw serviceUnavailable("missing_openrouter_key", "Chat is not configured.")

  const body = (await c.req.json()) as { conversationId?: string; negotiationId?: string }
  if (!body.conversationId || !body.negotiationId) {
    throw badRequest("invalid_body", "conversationId and negotiationId are required.")
  }

  const ctx = contextFrom(c)
  const outcome = await getOutcome(ctx, body.negotiationId)
  if (!outcome) throw notFound("That proposal has not been resolved.")

  const conversationId = body.conversationId
  return streamSSE(c, async (stream) => {
    for await (const event of runAcknowledgement(
      ctx,
      c.env,
      { conversationId, outcome },
      c.req.raw.signal
    )) {
      await stream.writeSSE({ data: JSON.stringify(event) })
    }
  })
})
