import { z } from "zod"

import { retrievedMemorySchema } from "./memory"
import { proposeResultSchema } from "./negotiation"

/**
 * The wire protocol between the streaming agent loop and the chat UI.
 *
 * Hand-rolled rather than delegated to a chat SDK because the loop has one unusual
 * property that off-the-shelf abstractions fight: when a tool returns `input_required`
 * the loop must genuinely *stop* and wait for a human, then resume. That pause is the
 * product's core claim, so it gets an explicit event rather than an escape hatch.
 */
export const chatEventSchema = z.discriminatedUnion("type", [
  /** An assistant text delta. */
  z.object({ type: z.literal("text"), delta: z.string() }),
  /** The model's own reasoning, kept out of the answer and shown separately. */
  z.object({ type: z.literal("reasoning"), delta: z.string() }),
  /** The model decided to call a tool. Rendered as an inline trace row. */
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  /** A tool finished. `summary` is a short human-readable line for the trace. */
  z.object({ type: z.literal("tool_result"), id: z.string(), summary: z.string() }),
  /** Memories that were retrieved and injected into this turn — powers the attribution panel. */
  z.object({ type: z.literal("memories_used"), memories: z.array(retrievedMemorySchema) }),
  /**
   * The loop has stopped and is waiting on the human. The UI renders a consent chip.
   * Nothing has been written to the memory store at this point.
   */
  z.object({ type: z.literal("proposal"), proposal: proposeResultSchema }),
  /** Terminal. `stopReason` says whether we finished or parked on a proposal. */
  z.object({
    type: z.literal("done"),
    messageId: z.string(),
    stopReason: z.enum(["complete", "awaiting_user", "max_steps", "error"]),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
])
export type ChatEvent = z.infer<typeof chatEventSchema>

export const chatRoleSchema = z.enum(["user", "assistant", "system", "tool"])
export type ChatRole = z.infer<typeof chatRoleSchema>

/** Max bytes for one attached image, after the client downscales it. */
export const MAX_IMAGE_BYTES = 1_500_000
export const MAX_IMAGES_PER_MESSAGE = 4

/** A `data:image/…;base64,…` URL. Kept inline rather than in object storage — a handful of
 *  downscaled images per conversation is not worth a second storage system. */
export const imageDataUrl = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Not a supported image.")
  .max(MAX_IMAGE_BYTES)

export const sendMessageInput = z.object({
  // `nullish`, not `optional`: a client that sends an explicit null for "no conversation yet"
  // should start one, not get a 400.
  conversationId: z.string().nullish(),
  message: z.string().max(8000),
  images: z.array(imageDataUrl).max(MAX_IMAGES_PER_MESSAGE).optional(),
  projectKey: z.string().max(200).optional(),
})

/** Audio formats MediaRecorder produces that OpenRouter's transcription endpoint accepts. */
export const AUDIO_FORMATS = ["webm", "mp4", "ogg", "wav", "mp3", "m4a"] as const
export const audioFormatSchema = z.enum(AUDIO_FORMATS)
export type AudioFormat = z.infer<typeof audioFormatSchema>

/** Raw base64 audio, no data-URI prefix — that is what the transcription API expects. */
export const transcribeInput = z.object({
  audio: z.string().min(1).max(20_000_000),
  format: audioFormatSchema,
  language: z.string().length(2).optional(),
})

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Conversation = z.infer<typeof conversationSchema>

/** Persisted alongside a message so a reloaded conversation looks identical. */
export const messageMetaSchema = z.object({
  trace: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        args: z.record(z.string(), z.unknown()),
        summary: z.string().optional(),
      })
    )
    .optional(),
  memoryIds: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
})
export type MessageMeta = z.infer<typeof messageMetaSchema>

/**
 * Parse a stored `meta` blob defensively.
 *
 * Meta is written by an older build than the one reading it, sooner or later. A malformed or
 * outdated blob should cost the tool trace, never the message — so this always returns a
 * usable object rather than throwing.
 */
export function parseMessageMeta(meta: string | null | undefined): MessageMeta {
  if (!meta) return {}
  try {
    const parsed = messageMetaSchema.safeParse(JSON.parse(meta))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export const storedMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  /** Serialised tool-call trace + attribution, so a reloaded conversation looks identical. */
  meta: z.string().nullable(),
  createdAt: z.number(),
})
export type StoredMessage = z.infer<typeof storedMessageSchema>
