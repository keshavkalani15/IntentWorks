import { useState } from "react"
import { Check, Info, Loader2, Sparkles, X } from "lucide-react"
import { toast } from "sonner"

import type {
  PendingProposal,
  ProposeResult,
  ResolveNegotiationInput,
  SelectableScope,
} from "@workspace/shared"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { SCOPE_META } from "@/components/memory/scope-meta"

interface ConsentChipProps {
  proposal: PendingProposal
  resolution?: ProposeResult
  onResolve: (input: ResolveNegotiationInput) => Promise<void>
}

/**
 * The consent gate, rendered inline in the conversation.
 *
 * Until one of these buttons is pressed the fact exists only as a pending negotiation on the
 * server — `memories` has no row for it. The shape of the choice (one scope enum plus an
 * optional boolean, with everything else in prose) is deliberate: it is exactly what MCP's
 * elicitation schemas allow, so the same negotiation can later be rendered by Claude Code or
 * Cursor without changing the server.
 */
export function ConsentChip({ proposal, resolution, onResolve }: ConsentChipProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [replaces, setReplaces] = useState(false)

  if (resolution) return <ResolvedChip resolution={resolution} />

  async function decide(input: ResolveNegotiationInput, key: string) {
    setPending(key)
    try {
      await onResolve(input)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that decision.")
    } finally {
      setPending(null)
    }
  }

  const busy = pending !== null

  return (
    <div className="border-primary/25 bg-primary/[0.04] mt-3 space-y-3.5 rounded-2xl border border-dashed p-4">
      <div className="flex items-start gap-2.5">
        <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">MemBot wants to remember this</p>
          <p className="mt-1 text-sm font-medium text-pretty">&ldquo;{proposal.fact}&rdquo;</p>
        </div>
      </div>

      {proposal.nearDuplicate && (
        <label className="border-border bg-background/60 flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs">
          <input
            type="checkbox"
            checked={replaces}
            onChange={(event) => setReplaces(event.target.checked)}
            className="accent-primary mt-0.5 size-3.5"
          />
          <span className="text-muted-foreground leading-relaxed">
            Replace the similar memory you already have:{" "}
            <span className="text-foreground font-medium">
              &ldquo;{proposal.nearDuplicate.fact}&rdquo;
            </span>
          </span>
        </label>
      )}

      <div className="space-y-2">
        <p className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
          How widely should it apply?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {proposal.options.map((scope: SelectableScope) => {
            const meta = SCOPE_META[scope]
            const Icon = meta.icon
            return (
              <Button
                key={scope}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => decide({ action: "accept", scope, replacesExisting: replaces }, scope)}
              >
                {pending === scope ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <Icon data-icon="inline-start" className="size-3.5" />
                )}
                {meta.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="border-border/70 flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => decide({ action: "decline" }, "decline")}
        >
          {pending === "decline" ? (
            <Loader2 data-icon="inline-start" className="size-3 animate-spin" />
          ) : (
            <X data-icon="inline-start" className="size-3" />
          )}
          Never remember this
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => decide({ action: "cancel" }, "cancel")}
        >
          Not now
        </Button>
        <span className="text-muted-foreground ml-auto text-[0.7rem]">
          Nothing is saved until you choose
        </span>
      </div>
    </div>
  )
}

function ResolvedChip({ resolution }: { resolution: ProposeResult }) {
  if (resolution.status === "committed") {
    const meta = SCOPE_META[resolution.memory.scope]
    return (
      <Outcome tone="positive" icon={Check}>
        <span className="min-w-0 flex-1 truncate">Saved &mdash; {resolution.memory.fact}</span>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", meta.tone)}>
          {meta.short}
        </span>
      </Outcome>
    )
  }

  if (resolution.status === "declined" || resolution.status === "suppressed") {
    return (
      <Outcome tone="neutral" icon={X}>
        Declined. This will never be suggested again.
      </Outcome>
    )
  }

  if (resolution.status === "already_known") {
    return (
      <Outcome tone="neutral" icon={Info}>
        Already stored as {resolution.memory.scope}.
      </Outcome>
    )
  }

  return (
    <Outcome tone="neutral" icon={Info}>
      {"message" in resolution ? resolution.message : "Nothing was saved."}
    </Outcome>
  )
}

function Outcome({
  tone,
  icon: Icon,
  children,
}: {
  tone: "positive" | "neutral"
  icon: typeof Check
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "mt-3 flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm",
        tone === "positive"
          ? "border-primary/25 bg-primary/[0.06]"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      <Icon className={cn("size-4 shrink-0", tone === "positive" && "text-primary")} />
      {children}
    </div>
  )
}
