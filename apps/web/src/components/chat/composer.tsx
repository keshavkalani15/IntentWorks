import { useEffect, useRef, useState } from "react"
import { ArrowUp, ImagePlus, Loader2, Mic, Square, X } from "lucide-react"
import { toast } from "sonner"

import { MAX_IMAGES_PER_MESSAGE } from "@workspace/shared"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { MAX_RECORDING_SECONDS, useRecorder } from "@/hooks/use-recorder"
import { api } from "@/lib/api"
import { ACCEPTED_IMAGE_TYPES, toDataUrl } from "@/lib/images"

interface ComposerProps {
  disabled?: boolean
  onSend: (text: string, images: string[]) => void
}

const MAX_HEIGHT = 200

export function Composer({ disabled, onSend }: ComposerProps) {
  const [value, setValue] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [transcribing, setTranscribing] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorder = useRecorder()

  // Grow with content up to a cap, then scroll. Done here rather than with CSS field-sizing
  // so the cap behaves consistently across browsers.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  async function addFiles(files: FileList | File[]) {
    const incoming = [...files].filter((file) => file.type.startsWith("image/"))
    if (incoming.length === 0) return

    const room = MAX_IMAGES_PER_MESSAGE - images.length
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images.`)
      return
    }

    const accepted: string[] = []
    for (const file of incoming.slice(0, room)) {
      try {
        accepted.push(await toDataUrl(file))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not attach that image.")
      }
    }

    if (accepted.length > 0) setImages((current) => [...current, ...accepted])
    if (incoming.length > room) toast.info(`Only the first ${room} were attached.`)
  }

  async function toggleRecording() {
    if (recorder.state === "recording") {
      recorder.stop()
      return
    }

    const recording = await recorder.start()
    if (!recording) {
      if (recorder.state === "denied") toast.error("Microphone access was blocked.")
      return
    }

    setTranscribing(true)
    try {
      const { text } = await api.transcribe(recording)
      if (!text) {
        toast.info("Nothing was said in that recording.")
        return
      }
      // Appended rather than replacing, so dictation can extend something already typed.
      setValue((current) => (current ? `${current.trimEnd()} ${text}` : text))
      textareaRef.current?.focus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not transcribe that.")
    } finally {
      setTranscribing(false)
    }
  }

  function submit() {
    const trimmed = value.trim()
    if (disabled || (!trimmed && images.length === 0)) return
    onSend(trimmed, images)
    setValue("")
    setImages([])
  }

  const busy = disabled || transcribing
  const recording = recorder.state === "recording"
  const canSend = !busy && !recording && (value.trim().length > 0 || images.length > 0)

  return (
    <div className="px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="mx-auto max-w-3xl">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void addFiles(event.dataTransfer.files)
          }}
          className={cn(
            "border-border bg-card rounded-3xl border p-2 shadow-sm transition-all",
            "focus-within:border-ring focus-within:ring-ring/25 focus-within:ring-3",
            dragging && "border-primary bg-primary/[0.04] ring-primary/25 ring-3"
          )}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 pb-1">
              {images.map((image, index) => (
                <div key={image.slice(-40)} className="group relative">
                  <img
                    src={image}
                    alt=""
                    className="border-border size-16 rounded-xl border object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                    className="bg-foreground text-background absolute -top-1.5 -right-1.5 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ""
              }}
            />

            <Button
              size="icon-sm"
              variant="ghost"
              className="mb-1 shrink-0"
              disabled={busy || recording || images.length >= MAX_IMAGES_PER_MESSAGE}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach an image"
            >
              <ImagePlus className="size-4" />
            </Button>

            {recording ? (
              <RecordingIndicator seconds={recorder.seconds} />
            ) : (
              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                disabled={busy}
                placeholder={
                  transcribing ? "Transcribing…" : "Ask anything, or tell MemBot something worth keeping…"
                }
                onChange={(event) => setValue(event.target.value)}
                onPaste={(event) => {
                  const files = [...event.clipboardData.files]
                  if (files.length > 0) {
                    event.preventDefault()
                    void addFiles(files)
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
                className="placeholder:text-muted-foreground max-h-[200px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed outline-none disabled:opacity-60"
              />
            )}

            <Button
              size="icon-sm"
              variant={recording ? "destructive" : "ghost"}
              className="mb-1 shrink-0"
              disabled={busy}
              onClick={() => void toggleRecording()}
              aria-label={recording ? "Stop recording" : "Dictate a message"}
            >
              {transcribing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : recording ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>

            <Button
              size="icon"
              className="mb-0.5 shrink-0"
              disabled={!canSend}
              onClick={submit}
              aria-label="Send message"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground mt-2 text-center text-xs">
          MemBot can suggest memories, but only you can save them.
        </p>
      </div>
    </div>
  )
}

function RecordingIndicator({ seconds }: { seconds: number }) {
  const remaining = MAX_RECORDING_SECONDS - seconds

  return (
    <div className="flex flex-1 items-center gap-2.5 px-2 py-2.5 text-sm">
      <span className="bg-destructive size-2 animate-pulse rounded-full" />
      <span className="font-medium">Recording</span>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")}
      </span>
      {remaining <= 10 && (
        <span className="text-muted-foreground text-xs">{remaining}s left</span>
      )}
    </div>
  )
}
