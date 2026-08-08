import type { ChatEvent, ProposeResult, RetrievedMemory, StoredMessage } from "@workspace/shared"
import { parseMessageMeta } from "@workspace/shared"

import type { RequestContext } from "../context"
import type { Env } from "../env"
import { findContext, resolveProject } from "../memory/containers"
import { searchMemories } from "../memory/retrieval"
import { appendMessage, ensureTitle, getMessages } from "./conversations"
import type { ChatMessage } from "./openrouter"
import { streamCompletion } from "./openrouter"
import { renderMemoryBlock, SYSTEM_PROMPT } from "./prompt"
import { CHAT_TOOLS, describe, runTool } from "./tools"

/** Tool round-trips per turn before we stop. Guards against a model looping on itself. */
const MAX_STEPS = 5

/** Memories pre-loaded before the model runs, so it starts a turn already knowing things. */
const PRELOAD_LIMIT = 6

interface TraceEntry {
  id: string
  name: string
  args: Record<string, unknown>
  summary: string
}

export interface AgentLoopInput {
  conversationId: string
  userMessage: string
  /** `data:image/…;base64,…` URLs, already downscaled by the client. */
  images?: string[]
  projectKey?: string
}

/**
 * One conversational turn.
 *
 * The loop's defining property is that it can stop in the middle. When `propose_memory`
 * returns `awaiting_user`, the turn ends with `stopReason: 'awaiting_user'` and nothing has
 * been written to memory — a human now decides. That pause is the product, so it is an
 * explicit terminal state here rather than something bolted onto a streaming helper.
 */
export async function* runAgentLoop(
  ctx: RequestContext,
  env: Env,
  input: AgentLoopInput,
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const images = input.images ?? []

  await appendMessage(ctx, {
    conversationId: input.conversationId,
    role: "user",
    content: input.userMessage,
    ...(images.length > 0 ? { meta: { images } } : {}),
  })
  await ensureTitle(
    ctx,
    input.conversationId,
    input.userMessage || (images.length === 1 ? "Image" : `${images.length} images`)
  )

  // Pre-retrieve, so the model starts the turn already knowing what it is allowed to know.
  // It can still call search_memory for anything more specific.
  const recalled = await preloadMemories(ctx, input)
  if (recalled.length > 0) {
    yield { type: "memories_used", memories: recalled }
  }

  const history = await getMessages(ctx, input.conversationId)
  const memoryBlock = renderMemoryBlock(recalled)

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(memoryBlock ? [{ role: "system" as const, content: memoryBlock }] : []),
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map(toModelMessage),
  ]

  const trace: TraceEntry[] = []
  let assistantText = ""
  let reasoning = ""
  const usedMemoryIds = new Set(recalled.map((memory) => memory.id))

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = streamCompletion(env, conversation, CHAT_TOOLS, signal)

      let turnText = ""
      let outcome: Awaited<ReturnType<typeof stream.next>>

      while (true) {
        outcome = await stream.next()
        if (outcome.done) break

        if (outcome.value.kind === "reasoning") {
          reasoning += outcome.value.delta
          yield { type: "reasoning", delta: outcome.value.delta }
          continue
        }

        // Only the answer accumulates into `turnText` — reasoning must never end up in the
        // saved message, or it comes back as literal <think> text on the next reload.
        turnText += outcome.value.delta
        yield { type: "text", delta: outcome.value.delta }
      }

      const { toolCalls } = outcome.value
      assistantText += turnText

      if (toolCalls.length === 0) {
        await persist(ctx, input.conversationId, assistantText, trace, usedMemoryIds, reasoning)
        yield { type: "done", messageId: input.conversationId, stopReason: "complete" }
        return
      }

      conversation.push({
        role: "assistant",
        content: turnText || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      })

      for (const call of toolCalls) {
        const args = safeParse(call.arguments)
        yield { type: "tool_call", id: call.id, name: call.name, args }

        const result = await runTool(ctx, call.name, call.arguments, {
          conversationId: input.conversationId,
          projectKey: input.projectKey,
        })

        trace.push({ id: call.id, name: call.name, args, summary: result.summary })
        yield { type: "tool_result", id: call.id, summary: result.summary }

        if (result.kind === "awaiting_user") {
          // Stop. Do not feed a synthesised result back to the model and carry on — that
          // would let it narrate a save that no human has agreed to.
          conversation.push({ role: "tool", content: result.content, tool_call_id: call.id })
          yield { type: "proposal", proposal: result.proposal }
          await persist(ctx, input.conversationId, assistantText, trace, usedMemoryIds, reasoning)
          yield { type: "done", messageId: input.conversationId, stopReason: "awaiting_user" }
          return
        }

        for (const id of result.memoryIds ?? []) usedMemoryIds.add(id)
        conversation.push({ role: "tool", content: result.content, tool_call_id: call.id })
      }
    }

    await persist(ctx, input.conversationId, assistantText, trace, usedMemoryIds, reasoning)
    yield { type: "done", messageId: input.conversationId, stopReason: "max_steps" }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model call failed."
    yield { type: "error", message }
    yield { type: "done", messageId: input.conversationId, stopReason: "error" }
  }
}

/**
 * A short spoken confirmation once the user has answered a proposal.
 *
 * Run as its own turn with NO tools: it cannot propose again, so it cannot loop. Without
 * this the conversation just stops after the chip resolves, which reads as the assistant
 * not having noticed the answer it was waiting for.
 */
export async function* runAcknowledgement(
  ctx: RequestContext,
  env: Env,
  input: { conversationId: string; outcome: ProposeResult },
  signal?: AbortSignal
): AsyncGenerator<ChatEvent> {
  const history = await getMessages(ctx, input.conversationId)

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-6)
      .map(toModelMessage),
    {
      role: "system",
      content:
        `The user has just answered your memory proposal. Outcome: ${describe(input.outcome)}\n\n` +
        `Acknowledge this in one short sentence, in your own words, and then continue naturally ` +
        `if there is anything left to help with. Do not repeat the fact verbatim and do not ` +
        `propose anything else right now.`,
    },
  ]

  let text = ""

  try {
    const stream = streamCompletion(env, conversation, [], signal)
    while (true) {
      const next = await stream.next()
      if (next.done) break

      if (next.value.kind === "reasoning") {
        yield { type: "reasoning", delta: next.value.delta }
        continue
      }
      text += next.value.delta
      yield { type: "text", delta: next.value.delta }
    }

    if (text.trim()) {
      await appendMessage(ctx, {
        conversationId: input.conversationId,
        role: "assistant",
        content: text,
      })
    }
    yield { type: "done", messageId: input.conversationId, stopReason: "complete" }
  } catch (error) {
    // The memory is already saved by this point — a failed acknowledgement is cosmetic,
    // so it must never look like the save failed.
    console.error("acknowledgement failed", { error })
    yield { type: "done", messageId: input.conversationId, stopReason: "error" }
  }
}

async function preloadMemories(
  ctx: RequestContext,
  input: AgentLoopInput
): Promise<RetrievedMemory[]> {
  const [projectId, contextId] = await Promise.all([
    resolveProject(ctx.db, ctx.userId, input.projectKey, { create: false }),
    findContext(ctx.db, ctx.userId, input.conversationId),
  ])

  return searchMemories(ctx, {
    query: input.userMessage,
    projectId,
    contextId,
    limit: PRELOAD_LIMIT,
  })
}

async function persist(
  ctx: RequestContext,
  conversationId: string,
  content: string,
  trace: TraceEntry[],
  memoryIds: Set<string>,
  reasoning: string
): Promise<void> {
  if (!content.trim() && trace.length === 0) return
  await appendMessage(ctx, {
    conversationId,
    role: "assistant",
    content,
    meta: {
      trace,
      memoryIds: [...memoryIds],
      ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
    },
  })
}

/**
 * Turn a stored message into a model message, re-attaching any images.
 *
 * Images from the whole history window are sent, not just this turn's, so "what was in that
 * screenshot again?" works. The window is already capped, which bounds the cost.
 */
function toModelMessage(message: StoredMessage): ChatMessage {
  if (message.role === "assistant") {
    return { role: "assistant", content: message.content }
  }

  const images = parseMessageMeta(message.meta).images ?? []
  if (images.length === 0) {
    return { role: "user", content: message.content }
  }

  return {
    role: "user",
    content: [
      ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
      ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ],
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}")
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
