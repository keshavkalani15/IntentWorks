import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Clock, EllipsisVertical, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import type { Memory, MemoryScope, SelectableScope } from "@workspace/shared"
import { SELECTABLE_SCOPES } from "@workspace/shared"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { MemoryTimeline } from "@/components/memory/memory-timeline"
import { SCOPE_META, ScopeBadge } from "@/components/memory/scope-meta"
import { relativeTime } from "@/lib/format"
import { api } from "@/lib/api"

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const FILTERS: Array<{ value: MemoryScope | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "global", label: "Everywhere" },
  { value: "project", label: "Project" },
  { value: "session", label: "Session" },
]

export function MemoryManager() {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<MemoryScope | "all">("all")
  const [search, setSearch] = useState("")
  const [timelineFor, setTimelineFor] = useState<Memory | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ["memories", scope, search],
    queryFn: () =>
      api.memories.list({
        ...(scope === "all" ? {} : { scope }),
        ...(search ? { q: search } : {}),
        limit: 100,
      }),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["memories"] })

  const rescope = useMutation({
    mutationFn: ({ id, next }: { id: string; next: SelectableScope }) =>
      api.memories.rescope(id, next),
    onSuccess: (_, variables) => {
      invalidate()
      toast.success(`Moved to ${SCOPE_META[variables.next].label.toLowerCase()}.`)
    },
    onError: (error) => toast.error(errorMessage(error, "Could not change the scope.")),
  })

  const suppress = useMutation({
    mutationFn: (id: string) => api.memories.suppress(id),
    onSuccess: () => {
      invalidate()
      toast.success("Suppressed. It will never be suggested again.")
    },
    onError: (error) => toast.error(errorMessage(error, "Could not suppress that memory.")),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.memories.remove(id),
    onSuccess: () => {
      invalidate()
      toast.success("Deleted.")
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete that memory.")),
  })

  const items = data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search your memories…"
            className="pl-9"
          />
        </div>

        <div className="bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-full p-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setScope(filter.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                scope === filter.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="border-border/70 rounded-2xl border border-dashed p-10 text-center">
          <p className="text-sm font-medium">
            {search ? "Nothing matches that." : "No memories yet."}
          </p>
          <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm leading-relaxed">
            {search
              ? "Try a different word."
              : "Talk to MemBot — when it suggests something worth keeping, you decide whether it stays."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((memory) => (
            <li
              key={memory.id}
              className="border-border bg-card/40 hover:bg-card group flex items-start gap-3 rounded-2xl border p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed">{memory.fact}</p>
                <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <ScopeBadge scope={memory.scope} />
                  {memory.category && <span>{memory.category}</span>}
                  <span aria-hidden>·</span>
                  <span>{relativeTime(memory.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span className="font-mono text-[0.7rem]">{memory.id}</span>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Memory actions"
                      className="shrink-0"
                    />
                  }
                >
                  <EllipsisVertical className="size-4" />
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setTimelineFor(memory)}>
                    <Clock className="size-4" />
                    Why do you know this?
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* A DropdownMenuLabel is Base UI's Menu.GroupLabel and must be inside a
                      Menu.Group — it throws at render otherwise. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                      Change scope
                    </DropdownMenuLabel>

                    {SELECTABLE_SCOPES.filter((option) => option !== memory.scope).map((option) => {
                      const meta = SCOPE_META[option]
                      const Icon = meta.icon
                      return (
                        <DropdownMenuItem
                          key={option}
                          onClick={() => rescope.mutate({ id: memory.id, next: option })}
                        >
                          <Icon className="size-4" />
                          {meta.label}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>

                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => suppress.mutate(memory.id)}>
                    <SCOPE_META.suppressed.icon className="size-4" />
                    Suppress
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(memory.id)}>
                    <Trash2 className="size-4" />
                    Delete permanently
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <MemoryTimeline memory={timelineFor} onClose={() => setTimelineFor(null)} />
    </div>
  )
}
