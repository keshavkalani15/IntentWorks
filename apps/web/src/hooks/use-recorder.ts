import { useCallback, useEffect, useRef, useState } from "react"

import type { AudioFormat } from "@workspace/shared"

/**
 * Recording is capped well under OpenRouter's 60s upstream transcription timeout — a long
 * clip would otherwise upload fine and then fail at the far end with nothing to show for it.
 */
export const MAX_RECORDING_SECONDS = 45

type RecorderState = "idle" | "recording" | "denied"

export interface Recording {
  base64: string
  format: AudioFormat
}

/** Pick the first container the browser will actually record that the API also accepts. */
function pickMimeType(): { mimeType: string; format: AudioFormat } {
  const candidates: Array<{ mimeType: string; format: AudioFormat }> = [
    { mimeType: "audio/webm;codecs=opus", format: "webm" },
    { mimeType: "audio/webm", format: "webm" },
    { mimeType: "audio/mp4", format: "mp4" },
    { mimeType: "audio/ogg;codecs=opus", format: "ogg" },
  ]

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate
  }
  return { mimeType: "", format: "webm" }
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle")
  const [seconds, setSeconds] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const formatRef = useRef<AudioFormat>("webm")
  const resolveRef = useRef<((recording: Recording | null) => void) | null>(null)

  const cleanup = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
    chunksRef.current = []
    setSeconds(0)
  }, [])

  // Stop the microphone if the component unmounts mid-recording — otherwise the browser's
  // in-use indicator stays lit after the user has navigated away.
  useEffect(() => cleanup, [cleanup])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop()
  }, [])

  const start = useCallback(async (): Promise<Recording | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const { mimeType, format } = pickMimeType()
      formatRef.current = format

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      const finished = new Promise<Recording | null>((resolve) => {
        resolveRef.current = resolve
      })

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" })
        cleanup()
        setState("idle")
        resolveRef.current?.(
          blob.size > 0 ? { base64: await blobToBase64(blob), format: formatRef.current } : null
        )
        resolveRef.current = null
      }

      recorder.start()
      setState("recording")
      setSeconds(0)
      return finished
    } catch {
      setState("denied")
      return null
    }
  }, [cleanup])

  // Tick the visible timer, and stop automatically at the cap.
  useEffect(() => {
    if (state !== "recording") return
    const timer = setInterval(() => {
      setSeconds((value) => {
        if (value + 1 >= MAX_RECORDING_SECONDS) stop()
        return value + 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [state, stop])

  return { state, seconds, start, stop }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // Yields a data URI; the server strips the prefix, since the API wants raw base64.
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("Could not read the recording."))
    reader.readAsDataURL(blob)
  })
}
