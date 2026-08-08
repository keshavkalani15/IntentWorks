import { Hono } from "hono"

import { transcribeInput } from "@workspace/shared"

import { transcribeAudio } from "../chat/transcribe"
import type { AppBindings } from "../env"
import { badRequest, serviceUnavailable } from "../lib/errors"
import { requireUser } from "../middleware/auth"

export const transcribeRoute = new Hono<AppBindings>()

transcribeRoute.use("*", requireUser)

transcribeRoute.post("/", async (c) => {
  if (!c.env.OPENROUTER_API_KEY) {
    throw serviceUnavailable(
      "missing_openrouter_key",
      "OPENROUTER_API_KEY is not set. Add it to apps/api/.dev.vars and restart."
    )
  }

  const body = (await c.req.json()) as { audio?: string; format?: string; language?: string }

  // Browsers hand back a data URI; the transcription endpoint wants raw base64 and fails
  // opaquely if given the prefix. Strip it here so no caller has to remember.
  const audio = body.audio?.includes(",") ? body.audio.slice(body.audio.indexOf(",") + 1) : body.audio

  const parsed = transcribeInput.safeParse({ ...body, audio })
  if (!parsed.success) throw badRequest("invalid_body", "Invalid audio.", parsed.error.issues)

  const text = await transcribeAudio(c.env, parsed.data)
  return c.json({ text })
})
