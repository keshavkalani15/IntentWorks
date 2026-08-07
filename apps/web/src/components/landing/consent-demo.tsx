import { useState } from "react"
import { ArrowRight, Check, RotateCcw, Sparkles, X } from "lucide-react"

import type { SelectableScope } from "@workspace/shared"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { SCOPE_META } from "@/components/memory/scope-meta"

const FACT = "Uses pnpm, never npm"
const SCOPES: SelectableScope[] = ["session", "project", "global"]

type Decision = SelectableScope | "declined"

/** What the assistant knows in a *different* conversation, given the scope that was chosen. */
const AFTERMATH: Record<Decision, { answer: string; recalled: boolean; note: string }> = {
  session: {
    answer: "I don't have a package manager preference stored for you.",
    recalled: false,
    note: "You scoped it to that one conversation, so this chat genuinely cannot see it. Not hidden — filtered out by the query.",
  },
  project: {
    answer: "In this project you use pnpm — npm lockfiles break your CI.",
    recalled: true,
    note: "Visible here because this chat belongs to the same project. Open a different project and it disappears again.",
  },
  global: {
    answer: "You use pnpm — you mentioned npm lockfiles break your CI.",
    recalled: true,
    note: "Global memories follow you into every conversation, in every project.",
  },
  declined: {
    answer: "I don't have a package manager preference stored for you.",
    recalled: false,
    note: "You said no, so nothing was written — and it becomes a tombstone, so you won't be asked about it again.",
  },
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          role === "user"
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function ConsentDemo() {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [showAftermath, setShowAftermath] = useState(false)

  const reset = () => {
    setDecision(null)
    setShowAftermath(false)
  }

  return (
    <div className="bg-card ring-border/70 relative rounded-3xl p-1.5 shadow-2xl shadow-black/[0.07] ring-1 dark:shadow-black/40">
      {/* Window chrome — reads as a product surface rather than an illustration. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="text-muted-foreground ml-2 text-xs font-medium">
          {showAftermath ? "New conversation" : "MemBot"}
        </span>
        {(decision || showAftermath) && (
          <button
            onClick={reset}
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1 text-xs transition-colors"
          >
            <RotateCcw className="size-3" />
            Replay
          </button>
        )}
      </div>

      <div className="bg-background/60 space-y-3 rounded-[1.25rem] border p-4">
        {!showAftermath ? (
          <>
            <Bubble role="user">
              I only ever use pnpm — npm lockfiles break our CI.
            </Bubble>
            <Bubble role="assistant">
              Noted, I'll stick to pnpm. Want me to hold on to that?
            </Bubble>

            {decision === null ? (
              <ProposalChip onDecide={setDecision} />
            ) : (
              <ResolvedChip decision={decision} onContinue={() => setShowAftermath(true)} />
            )}
          </>
        ) : (
          <Aftermath decision={decision!} />
        )}
      </div>
    </div>
  )
}

function ProposalChip({ onDecide }: { onDecide: (decision: Decision) => void }) {
  return (
    <div className="border-primary/25 bg-primary/[0.04] animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-2xl border border-dashed p-3.5 duration-500">
      <div className="flex items-start gap-2.5">
        <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs font-medium">MemBot wants to remember</p>
          <p className="mt-1 text-sm font-medium">&ldquo;{FACT}&rdquo;</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
          How widely?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((scope) => {
            const meta = SCOPE_META[scope]
            const Icon = meta.icon
            return (
              <Button key={scope} size="xs" variant="outline" onClick={() => onDecide(scope)}>
                <Icon data-icon="inline-start" className="size-3" />
                {meta.label}
              </Button>
            )
          })}
          <Button size="xs" variant="ghost" onClick={() => onDecide("declined")}>
            <X data-icon="inline-start" className="size-3" />
            Don&rsquo;t
          </Button>
        </div>
      </div>
    </div>
  )
}

function ResolvedChip({
  decision,
  onContinue,
}: {
  decision: Decision
  onContinue: () => void
}) {
  const meta = decision === "declined" ? SCOPE_META.suppressed : SCOPE_META[decision]
  const Icon = decision === "declined" ? X : Check

  return (
    <div className="animate-in fade-in space-y-3 duration-300">
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm",
          decision === "declined"
            ? "border-border bg-muted/50 text-muted-foreground"
            : "border-primary/25 bg-primary/[0.06]"
        )}
      >
        <Icon className={cn("size-4 shrink-0", decision !== "declined" && "text-primary")} />
        <span className="min-w-0 truncate font-medium">
          {decision === "declined" ? "Not saved" : FACT}
        </span>
        <span className="ml-auto shrink-0">
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", meta.tone)}>
            {meta.short}
          </span>
        </span>
      </div>

      <Button size="sm" variant="outline" className="w-full" onClick={onContinue}>
        Now open a new conversation
        <ArrowRight data-icon="inline-end" className="size-3.5" />
      </Button>
    </div>
  )
}

function Aftermath({ decision }: { decision: Decision }) {
  const outcome = AFTERMATH[decision]

  return (
    <div className="animate-in fade-in slide-in-from-right-2 space-y-3 duration-500">
      <Bubble role="user">What package manager should I use here?</Bubble>
      <Bubble role="assistant">{outcome.answer}</Bubble>

      <div
        className={cn(
          "rounded-2xl border p-3 text-xs leading-relaxed",
          outcome.recalled
            ? "border-primary/20 bg-primary/[0.04]"
            : "border-border bg-muted/40 text-muted-foreground"
        )}
      >
        <span className="text-foreground font-medium">
          {outcome.recalled ? "Recalled. " : "Not recalled. "}
        </span>
        {outcome.note}
      </div>
    </div>
  )
}
