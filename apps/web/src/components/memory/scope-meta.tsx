import { Ban, Clock3, FolderClosed, Globe2, type LucideIcon } from "lucide-react"

import type { MemoryScope } from "@workspace/shared"
import { cn } from "@workspace/ui/lib/utils"

interface ScopeMeta {
  label: string
  short: string
  description: string
  icon: LucideIcon
  /** Badge colouring. Warm, sequential — narrower scope reads cooler, wider reads hotter. */
  tone: string
}

export const SCOPE_META: Record<MemoryScope, ScopeMeta> = {
  session: {
    label: "This conversation",
    short: "Session",
    description: "Gone when the conversation ends. Never visible from another chat.",
    icon: Clock3,
    tone: "bg-muted text-muted-foreground border-border",
  },
  project: {
    label: "This project",
    short: "Project",
    description: "Shared across every conversation about one project, and nowhere else.",
    icon: FolderClosed,
    tone: "bg-chart-1/15 text-chart-5 border-chart-1/30 dark:text-chart-1",
  },
  global: {
    label: "Everywhere",
    short: "Global",
    description: "Available in every conversation, in every project, indefinitely.",
    icon: Globe2,
    tone: "bg-primary/12 text-primary border-primary/25",
  },
  suppressed: {
    label: "Never",
    short: "Suppressed",
    description: "A tombstone. Never retrieved, and never proposed to you again.",
    icon: Ban,
    tone: "bg-destructive/10 text-destructive border-destructive/20",
  },
}

export function ScopeBadge({
  scope,
  className,
  showIcon = true,
}: {
  scope: MemoryScope
  className?: string
  showIcon?: boolean
}) {
  const meta = SCOPE_META[scope]
  const Icon = meta.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        meta.tone,
        className
      )}
    >
      {showIcon ? <Icon className="size-3" /> : null}
      {meta.short}
    </span>
  )
}
