import { useState } from "react"
import { Brain, Check, ChevronRight, Search, Sparkles, Wrench, type LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ActivityStep } from "@/stores/chat-store"

const TOOLS: Record<string, { running: string; done: string; icon: LucideIcon }> = {
  search_memory: { running: "Searching your memory", done: "Searched your memory", icon: Search },
  propose_memory: { running: "Preparing a suggestion", done: "Suggested a memory", icon: Sparkles },
}

interface ActivityProps {
  steps: ActivityStep[]
  /** True while the assistant is still working and has produced no answer text yet. */
  live: boolean
}

/**
 * What the assistant is doing, shown as it happens.
 *
 * Expanded and streaming while it works — a spinner that says nothing turns a two-second
 * memory search into an apparent hang, and making retrieval visible is part of this product's
 * whole claim. The moment the answer starts, the same steps fold into one line, because by
 * then they are history rather than status.
 */
export function Activity({ steps, live }: ActivityProps) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return live ? <Pending label="Thinking" /> : null

  const expanded = live || open

  return (
    <div className="mb-2">
      {live ? (
        <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
          Working
          <Dots />
        </p>
      ) : (
        <button
          onClick={() => setOpen((value) => !value)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full text-xs transition-colors"
        >
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
          {summarise(steps)}
        </button>
      )}

      {expanded && (
        <ol className="border-border/70 mt-2 space-y-2 border-l pl-3.5">
          {steps.map((step, index) => (
            <Step
              key={index}
              step={step}
              // Only the final step can still be in flight.
              running={live && index === steps.length - 1}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function Step({ step, running }: { step: ActivityStep; running: boolean }) {
  if (step.kind === "memories") {
    return (
      <li className="flex items-center gap-2 text-xs">
        <Brain className="text-muted-foreground size-3 shrink-0" />
        <span>
          Recalled {step.count === 1 ? "1 memory" : `${step.count} memories`}
        </span>
      </li>
    )
  }

  if (step.kind === "reasoning") {
    return (
      <li className="text-xs">
        <div className="text-muted-foreground flex items-center gap-2">
          <Brain className="size-3 shrink-0" />
          <span className="font-medium">Thinking</span>
          {running && <Dots />}
        </div>
        <p className="text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
          {step.text.trim()}
        </p>
      </li>
    )
  }

  const meta = TOOLS[step.name]
  const Icon = meta?.icon ?? Wrench
  const detail =
    typeof step.args.query === "string"
      ? step.args.query
      : typeof step.args.fact === "string"
        ? step.args.fact
        : null

  return (
    <li className="text-xs">
      <div className="flex items-center gap-2">
        {step.summary ? (
          <Check className="text-primary size-3 shrink-0" />
        ) : (
          <Icon className="text-muted-foreground size-3 shrink-0" />
        )}
        <span className="font-medium">
          {step.summary ? (meta?.done ?? step.name) : (meta?.running ?? step.name)}
        </span>
        {step.summary && <span className="text-muted-foreground truncate">— {step.summary}</span>}
        {running && !step.summary && <Dots />}
      </div>
      {detail && (
        <p className="text-muted-foreground mt-0.5 truncate pl-5 font-mono text-[0.7rem]">
          {detail}
        </p>
      )}
    </li>
  )
}

function summarise(steps: ActivityStep[]): string {
  const tools = steps.filter((step) => step.kind === "tool").length
  const thought = steps.some((step) => step.kind === "reasoning")

  if (tools === 0) return thought ? "Thoughts" : "Steps"
  const label = tools === 1 ? "1 step" : `${tools} steps`
  return thought ? `Thoughts and ${label}` : label
}

function Pending({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
      {label}
      <Dots />
    </p>
  )
}

function Dots() {
  return (
    <span className="flex gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="bg-muted-foreground/60 size-1 animate-bounce rounded-full motion-reduce:animate-none"
        />
      ))}
    </span>
  )
}
