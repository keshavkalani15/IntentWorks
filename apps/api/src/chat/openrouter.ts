import type { Env } from "../env"
import { ApiError } from "../lib/errors"
import { ReasoningSplitter, type StreamSegment } from "./reasoning"

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const DEFAULT_MODEL = "meta/muse-spark-1.2"

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/** OpenAI-compatible multimodal content parts. Images travel as data URLs. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: OpenRouterToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string }

interface OpenRouterToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface CompletionOutcome {
  toolCalls: ToolCall[]
  finishReason: string
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      /** OpenRouter's unified reasoning field. Models split between this and inline tags. */
      reasoning?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

/**
 * Stream one completion from OpenRouter, yielding text deltas and returning the tool calls.
 *
 * Written against the raw OpenAI-compatible endpoint rather than through a chat SDK because
 * this loop has to stop mid-turn and hand control to a human, then resume from persisted
 * state. Every SDK abstraction assumes the loop runs to completion.
 */
export async function* streamCompletion(
  env: Env,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal
): AsyncGenerator<StreamSegment, CompletionOutcome, void> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.WEB_ORIGIN,
      "X-Title": "Negotiated Memory",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages,
      tools,
      stream: true,
      temperature: 0.6,
      // Ask for reasoning so the UI can show real steps rather than a generic spinner.
      // OpenRouter ignores this for models that do not reason, so it is safe to always send.
      reasoning: { effort: "low" },
    }),
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "")
    throw new ApiError(
      502,
      "model_unavailable",
      `OpenRouter returned ${response.status}. ${detail.slice(0, 400)}`
    )
  }

  const partials = new Map<number, ToolCall>()
  const splitter = new ReasoningSplitter()
  let finishReason = "stop"

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value

      // SSE frames are separated by a blank line; a frame may straddle two reads.
      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (payload === "" || payload === "[DONE]") continue

          let chunk: StreamChunk
          try {
            chunk = JSON.parse(payload) as StreamChunk
          } catch {
            continue
          }

          if (chunk.error?.message) {
            throw new ApiError(502, "model_error", chunk.error.message)
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finishReason = choice.finish_reason

          // Reasoning reaches us two ways: a dedicated field, or `<think>` tags buried in
          // the content. Both are normalised here so callers only ever see clean segments.
          const reasoning = choice.delta?.reasoning
          if (reasoning) yield { kind: "reasoning", delta: reasoning }

          const text = choice.delta?.content
          if (text) {
            for (const segment of splitter.push(text)) yield segment
          }

          // Tool call arguments arrive as a stream of fragments keyed by index.
          for (const partial of choice.delta?.tool_calls ?? []) {
            const existing = partials.get(partial.index) ?? { id: "", name: "", arguments: "" }
            if (partial.id) existing.id = partial.id
            if (partial.function?.name) existing.name = partial.function.name
            if (partial.function?.arguments) existing.arguments += partial.function.arguments
            partials.set(partial.index, existing)
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // An unclosed <think> would otherwise swallow the tail of the reply.
  for (const segment of splitter.flush()) yield segment

  return {
    toolCalls: [...partials.values()].filter((call) => call.name !== ""),
    finishReason,
  }
}
