import type { AudioFormat } from "@workspace/shared"

import type { Env } from "../env"
import { ApiError } from "../lib/errors"

const TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

/** Overridable via env, but this is the model the product is tuned for. */
const DEFAULT_MODEL = "openai/gpt-transcribe"

interface TranscriptionResponse {
  text?: string
  error?: { message?: string }
}

/**
 * Speech to text via OpenRouter.
 *
 * Note the endpoint takes RAW base64 — not a data URI. Passing `data:audio/webm;base64,…`
 * here fails upstream with an unhelpful decode error, so the prefix is stripped at the route
 * boundary and never reaches this function.
 *
 * Upstream times out at 60s, which is the real constraint on clip length; the client caps
 * recording well below that.
 */
export async function transcribeAudio(
  env: Env,
  input: { audio: string; format: AudioFormat; language?: string }
): Promise<string> {
  const response = await fetch(TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.WEB_ORIGIN,
      "X-Title": "Negotiated Memory",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_TRANSCRIBE_MODEL || DEFAULT_MODEL,
      input_audio: { data: input.audio, format: input.format },
      ...(input.language ? { language: input.language } : {}),
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new ApiError(
      502,
      "transcription_failed",
      `Transcription failed (${response.status}). ${detail.slice(0, 300)}`
    )
  }

  const result = (await response.json()) as TranscriptionResponse
  if (result.error?.message) {
    throw new ApiError(502, "transcription_failed", result.error.message)
  }

  return (result.text ?? "").trim()
}
