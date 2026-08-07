import { create } from "zustand"

import type {
  ChatEvent,
  PendingProposal,
  ProposeResult,
  ResolveNegotiationInput,
  RetrievedMemory,
  StoredMessage,
} from "@workspace/shared"
import { chatEventSchema, parseMessageMeta } from "@workspace/shared"

import { api } from "@/lib/api"

export interface ToolTraceEntry {
  id: string
  name: string
  args: Record<string, unknown>
  summary?: string
}

/**
 * One thing the assistant did, in the order it did it.
 *
 * A single ordered list rather than separate reasoning/tool collections, because the point is
 * to replay the turn as it happened — "thought, then searched, then thought again" is the
 * interesting part, and two parallel arrays cannot express that ordering.
 */
export type ActivityStep =
  | { kind: "memories"; count: number }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; id: string; name: string; args: Record<string, unknown>; summary?: string }

export interface ChatMessageView {
  id: string
  role: "user" | "assistant"
  content: string
  /** Data URLs attached to a user message. */
  images: string[]
  /** Everything the assistant did this turn, in order. */
  steps: ActivityStep[]
  /** The model's own reasoning, kept flat for persistence. */
  reasoning: string
  trace: ToolTraceEntry[]
  memories: RetrievedMemory[]
  /** Set when the turn stopped to ask the user. `resolution` fills in once they answer. */
  proposal?: PendingProposal
  resolution?: ProposeResult
  streaming?: boolean
}

type Status = "idle" | "streaming" | "awaiting_user" | "error"

interface ChatState {
  conversationId: string | null
  messages: ChatMessageView[]
  status: Status
  error: string | null

  send: (text: string, images?: string[]) => Promise<void>
  resolveProposal: (messageId: string, input: ResolveNegotiationInput) => Promise<void>
  /** Streams the assistant's spoken reply to a resolved proposal. */
  acknowledge: (conversationId: string, negotiationId: string) => Promise<void>
  openConversation: (id: string) => Promise<void>
  startNewConversation: () => void
}

let nextLocalId = 0
const localId = (prefix: string) => `${prefix}-local-${++nextLocalId}`

/**
 * Parse an SSE body into typed events.
 *
 * Validated with the same zod schema the server emits against, so a protocol change breaks
 * loudly here rather than rendering as a silently missing chip.
 */
async function* readEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ChatEvent | { type: "conversation"; conversationId: string }> {
  // Decoded manually rather than via `pipeThrough(new TextDecoderStream())`, whose DOM
  // typings do not line up with a Uint8Array stream. `stream: true` keeps multi-byte
  // characters intact across chunk boundaries.
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          const raw = line.slice(5).trim()
          if (!raw) continue

          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            continue
          }

          if ((parsed as { type?: string }).type === "conversation") {
            yield parsed as { type: "conversation"; conversationId: string }
            continue
          }

          const event = chatEventSchema.safeParse(parsed)
          if (event.success) yield event.data
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  status: "idle",
  error: null,

  startNewConversation: () => set({ conversationId: null, messages: [], status: "idle", error: null }),

  openConversation: async (id) => {
    set({ conversationId: id, messages: [], status: "idle", error: null })
    try {
      const { items } = await api.conversations.messages(id)
      set({ messages: items.flatMap((item) => toView(item) ?? []) })
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Could not open that conversation.",
      })
    }
  },

  send: async (text, images = []) => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0) || get().status === "streaming") return

    const assistantId = localId("assistant")
    set((state) => ({
      status: "streaming",
      error: null,
      messages: [
        ...state.messages,
        {
          id: localId("user"),
          role: "user",
          content: trimmed,
          images,
          steps: [],
          reasoning: "",
          trace: [],
          memories: [],
        },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          images: [],
          steps: [],
          reasoning: "",
          trace: [],
          memories: [],
          streaming: true,
        },
      ],
    }))

    const patch = (update: (message: ChatMessageView) => ChatMessageView) =>
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? update(message) : message
        ),
      }))

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Omitted rather than sent as null on a brand-new conversation: "absent" and
          // "explicitly null" are different things to a validator.
          ...(get().conversationId ? { conversationId: get().conversationId } : {}),
          message: trimmed,
          ...(images.length > 0 ? { images } : {}),
        }),
      })

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        throw new Error(detail?.error?.message ?? `Chat failed with ${response.status}.`)
      }

      for await (const event of readEvents(response.body)) {
        applyEvent(event, patch, set)
      }
    } catch (error) {
      patch((message) => ({ ...message, streaming: false }))
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Something went wrong.",
      })
    }
  },

  /**
   * The other half of the pause. Until this runs, nothing has been written to memory —
   * the proposal exists only as a pending negotiation on the server.
   */
  resolveProposal: async (messageId, input) => {
    const message = get().messages.find((entry) => entry.id === messageId)
    if (!message?.proposal) return

    const { negotiationId } = message.proposal
    const { result } = await api.negotiations.resolve(negotiationId, input)

    set((state) => ({
      status: state.status === "awaiting_user" ? "idle" : state.status,
      messages: state.messages.map((entry) =>
        entry.id === messageId ? { ...entry, resolution: result } : entry
      ),
    }))

    // The memory is already committed. The assistant's reply to the decision is a separate,
    // best-effort turn — if it fails, the save still stands and the chip already says so.
    const conversationId = get().conversationId
    if (conversationId) await get().acknowledge(conversationId, negotiationId)
  },

  acknowledge: async (conversationId, negotiationId) => {
    const assistantId = localId("assistant")
    set((state) => ({
      status: "streaming",
      messages: [
        ...state.messages,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          images: [],
          steps: [],
          reasoning: "",
          trace: [],
          memories: [],
          streaming: true,
        },
      ],
    }))

    const patch = (update: (message: ChatMessageView) => ChatMessageView) =>
      set((state) => ({
        messages: state.messages.map((entry) =>
          entry.id === assistantId ? update(entry) : entry
        ),
      }))

    try {
      const response = await fetch("/api/chat/acknowledge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, negotiationId }),
      })
      if (!response.ok || !response.body) throw new Error("No acknowledgement.")

      for await (const event of readEvents(response.body)) {
        applyEvent(event, patch, set)
      }
    } catch {
      // Drop the placeholder rather than leaving an empty bubble spinning forever.
      set((state) => ({
        status: "idle",
        messages: state.messages.filter((entry) => entry.id !== assistantId),
      }))
    }
  },
}))


type Patch = (update: (message: ChatMessageView) => ChatMessageView) => void
type SetState = (partial: Partial<ChatState>) => void

/** Applies one streamed event. Shared by the main turn and the post-consent acknowledgement. */
function applyEvent(
  event: ChatEvent | { type: "conversation"; conversationId: string },
  patch: Patch,
  set: SetState
): void {
  switch (event.type) {
    case "conversation":
      set({ conversationId: event.conversationId })
      break
    case "text":
      patch((message) => ({ ...message, content: message.content + event.delta }))
      break
    case "reasoning":
      patch((message) => ({
        ...message,
        reasoning: message.reasoning + event.delta,
        // Append to the trailing reasoning step so a burst of deltas stays one block,
        // but start a new one if a tool call has run since.
        steps: appendReasoning(message.steps, event.delta),
      }))
      break
    case "memories_used":
      patch((message) => ({
        ...message,
        memories: event.memories,
        steps: [...message.steps, { kind: "memories", count: event.memories.length }],
      }))
      break
    case "tool_call":
      patch((message) => ({
        ...message,
        trace: [...message.trace, { id: event.id, name: event.name, args: event.args }],
        steps: [
          ...message.steps,
          { kind: "tool", id: event.id, name: event.name, args: event.args },
        ],
      }))
      break
    case "tool_result":
      patch((message) => ({
        ...message,
        trace: message.trace.map((entry) =>
          entry.id === event.id ? { ...entry, summary: event.summary } : entry
        ),
        steps: message.steps.map((step) =>
          step.kind === "tool" && step.id === event.id
            ? { ...step, summary: event.summary }
            : step
        ),
      }))
      break
    case "proposal":
      if (event.proposal.status === "input_required") {
        patch((message) => ({ ...message, proposal: event.proposal as PendingProposal }))
      }
      break
    case "error":
      set({ error: event.message })
      break
    case "done":
      patch((message) => ({ ...message, streaming: false }))
      set({ status: event.stopReason === "awaiting_user" ? "awaiting_user" : "idle" })
      break
  }
}

function appendReasoning(steps: ActivityStep[], delta: string): ActivityStep[] {
  const last = steps[steps.length - 1]
  if (last?.kind === "reasoning") {
    return [...steps.slice(0, -1), { kind: "reasoning", text: last.text + delta }]
  }
  return [...steps, { kind: "reasoning", text: delta }]
}

function toView(message: StoredMessage): ChatMessageView | null {
  if (message.role !== "user" && message.role !== "assistant") return null

  const meta = parseMessageMeta(message.meta)

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    images: meta.images ?? [],
    // Reconstructed from persisted meta. The interleaving is lost — only the flat reasoning
    // blob and the tool list survive — so reasoning is shown first, then the tools.
    steps: [
      ...(meta.reasoning ? [{ kind: "reasoning" as const, text: meta.reasoning }] : []),
      ...(meta.trace ?? []).map((entry) => ({ kind: "tool" as const, ...entry })),
    ],
    reasoning: meta.reasoning ?? "",
    trace: meta.trace ?? [],
    memories: [],
  }
}
