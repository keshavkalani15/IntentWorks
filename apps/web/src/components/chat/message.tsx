import { Brain } from "lucide-react"

import type { ResolveNegotiationInput } from "@workspace/shared"
import { cn } from "@workspace/ui/lib/utils"

import { Activity } from "@/components/chat/activity"
import { ConsentChip } from "@/components/chat/consent-chip"
import { Markdown } from "@/components/chat/markdown"
import { ScopeBadge } from "@/components/memory/scope-meta"
import type { ChatMessageView } from "@/stores/chat-store"

interface MessageProps {
  message: ChatMessageView
  onResolve: (input: ResolveNegotiationInput) => Promise<void>
}

export function Message({ message, onResolve }: MessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.images.length > 0 && (
          <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
            {message.images.map((image) => (
              <a
                key={image.slice(-40)}
                href={image}
                target="_blank"
                rel="noreferrer"
                className="focus-visible:ring-ring/30 rounded-2xl outline-none focus-visible:ring-3"
              >
                <img
                  src={image}
                  alt="Attached"
                  className="border-border max-h-56 rounded-2xl border object-cover"
                />
              </a>
            ))}
          </div>
        )}

        {message.content && (
          <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
        )}
      </div>
    )
  }

  // The activity log is live only until the answer starts. Once text arrives the steps
  // become history, so they collapse and the reply takes the space.
  const working = Boolean(message.streaming) && message.content.length === 0

  return (
    <div className="max-w-[85%] space-y-1">
      {message.memories.length > 0 && <MemoryAttribution message={message} />}

      <Activity steps={message.steps} live={working} />

      {!working && (
        <div className="relative">
          <Markdown content={message.content} />
          {message.streaming && <Caret />}
        </div>
      )}

      {message.proposal && (
        <ConsentChip
          proposal={message.proposal}
          resolution={message.resolution}
          onResolve={onResolve}
        />
      )}
    </div>
  )
}

/**
 * Which stored memories shaped this answer. Shown above the reply rather than tucked away,
 * because "why did it say that?" should not require opening a panel.
 */
function MemoryAttribution({ message }: { message: ChatMessageView }) {
  return (
    <details className="group mb-2">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs transition-colors">
        <Brain className="size-3" />
        {message.memories.length === 1
          ? "1 memory shaped this"
          : `${message.memories.length} memories shaped this`}
      </summary>
      <ul className="border-border/70 mt-2 space-y-1.5 border-l pl-3.5">
        {message.memories.map((memory) => (
          <li key={memory.id} className="flex items-start gap-2 text-xs">
            <ScopeBadge scope={memory.scope} showIcon={false} className="mt-px shrink-0" />
            <span className="text-muted-foreground min-w-0 leading-relaxed">{memory.fact}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Sits at the end of the rendered markdown rather than inside it, so block elements
 *  (lists, code fences) do not push it onto a line of its own. */
function Caret() {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-foreground/70 ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] align-baseline",
        "animate-pulse motion-reduce:animate-none"
      )}
    />
  )
}
