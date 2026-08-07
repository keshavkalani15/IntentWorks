import { Ban, Check, Clock3, PenLine, Sparkles, X, type LucideIcon } from "lucide-react"

import type { ActivityEntry, MemoryEventKind } from "@workspace/shared"
import { cn } from "@workspace/ui/lib/utils"

import { ScopeBadge } from "@/components/memory/scope-meta"
import { relativeTime } from "@/lib/format"

const EVENTS: Record<MemoryEventKind, { label: string; icon: LucideIcon; tone: string }> = {
  proposed: { label: "MemBot suggested", icon: Sparkles, tone: "text-muted-foreground" },
  accepted: { label: "You approved", icon: Check, tone: "text-primary" },
  declined: { label: "You declined", icon: X, tone: "text-muted-foreground" },
  cancelled: { label: "You dismissed", icon: X, tone: "text-muted-foreground" },
  rescoped: { label: "You changed the scope", icon: PenLine, tone: "text-muted-foreground" },
  suppressed: { label: "You suppressed", icon: Ban, tone: "text-muted-foreground" },
  superseded: { label: "Replaced by a newer memory", icon: PenLine, tone: "text-muted-foreground" },
  confirmed: { label: "You confirmed", icon: Check, tone: "text-muted-foreground" },
  expired: { label: "Expired", icon: Clock3, tone: "text-muted-foreground" },
  restored: { label: "Restored", icon: Check, tone: "text-muted-foreground" },
}

/**
 * The append-only event log, read back as a story.
 *
 * Every state change a memory has ever been through is a row, so this is a real audit trail
 * rather than a reconstruction — which is the whole point of being able to ask "why does it
 * think that?".
 */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Nothing yet. Talk to MemBot and its suggestions will show up here.
      </p>
    )
  }

  const recentEntries = entries.slice(0, 20)

  return (
    <div className="max-h-[380px] overflow-y-auto pr-2">
      <ol className="border-border/70 space-y-4 border-l pl-5">
        {recentEntries.map((entry) => {
          const meta = EVENTS[entry.event]
          const Icon = meta.icon

          return (
            <li key={entry.id} className="relative">
              <span className="bg-background ring-border absolute top-0.5 -left-[1.6rem] flex size-4 items-center justify-center rounded-full ring-1">
                <Icon className={cn("size-2.5", meta.tone)} />
              </span>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium">{meta.label}</span>
                {entry.scope && <ScopeBadge scope={entry.scope} showIcon={false} />}
                <span className="text-muted-foreground">{relativeTime(entry.at)}</span>
              </div>

              {entry.fact && (
                <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{entry.fact}</p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}