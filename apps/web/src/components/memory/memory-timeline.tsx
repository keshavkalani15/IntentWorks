import { useQuery } from "@tanstack/react-query"

import type { Memory, MemoryEventKind } from "@workspace/shared"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ScopeBadge } from "@/components/memory/scope-meta"
import { api } from "@/lib/api"
import { formatDateTime } from "@/lib/format"

const EVENT_COPY: Record<MemoryEventKind, string> = {
  proposed: "Suggested by MemBot",
  accepted: "You approved it",
  declined: "You declined it",
  cancelled: "You dismissed the prompt",
  rescoped: "Scope changed",
  suppressed: "You suppressed it",
  superseded: "Replaced by a newer memory",
  confirmed: "You confirmed it is still true",
  expired: "Expired",
  restored: "Restored",
}

/**
 * The answer to "why does it think that?".
 *
 * Every state change is an append-only row, so this is a real audit trail rather than a
 * reconstruction — which is the difference between a memory you can trust and one you cannot.
 */
export function MemoryTimeline({
  memory,
  onClose,
}: {
  memory: Memory | null
  onClose: () => void
}) {
  const { data, isPending } = useQuery({
    queryKey: ["memories", memory?.id, "timeline"],
    queryFn: () => api.memories.timeline(memory!.id),
    enabled: Boolean(memory),
  })

  return (
    <Dialog open={Boolean(memory)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Why do you know this?</DialogTitle>
          <DialogDescription className="text-pretty">
            {memory?.fact}
          </DialogDescription>
        </DialogHeader>

        {memory && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <ScopeBadge scope={memory.scope} />
            <span>proposed by</span>
            <span className="text-foreground font-medium">{memory.originClient}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">{memory.id}</span>
          </div>
        )}

        {isPending ? (
          <div className="space-y-2 py-2">
            {[0, 1].map((key) => (
              <Skeleton key={key} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ol className="border-border/70 space-y-4 border-l pl-5">
            {data?.events.map((event) => (
              <li key={event.id} className="relative">
                <span className="bg-border ring-background absolute top-1.5 -left-[1.4rem] size-2 rounded-full ring-4" />
                <p className="text-sm font-medium">
                  {EVENT_COPY[event.event as MemoryEventKind] ?? event.event}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatDateTime(event.at)} · by {event.actor}
                  {event.fromValue && event.toValue
                    ? ` · ${event.fromValue} → ${event.toValue}`
                    : ""}
                </p>
              </li>
            ))}
            {data?.events.length === 0 && (
              <li className="text-muted-foreground text-sm">No recorded events.</li>
            )}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}
