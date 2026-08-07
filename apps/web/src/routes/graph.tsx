import { Suspense, lazy, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Info, Link2, Search, Share2 } from "lucide-react"

import type { Memory, MemoryCategory, MemoryScope } from "@workspace/shared"
import { MEMORY_CATEGORIES } from "@workspace/shared"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import type { GraphFilters } from "@/components/graph/memory-graph"
import { CATEGORY_LABEL, PALETTE } from "@/components/graph/graph-visuals"
import { useResolvedDark } from "@/components/graph/use-resolved-theme"
import { LinkButton } from "@/components/link-button"
import { MemoryTimeline } from "@/components/memory/memory-timeline"
import { api } from "@/lib/api"

// three.js is by far the heaviest dependency in the app and is used on this route alone,
// so it stays behind a lazy boundary rather than loading on every page.
const MemoryGraphCanvas = lazy(() =>
  import("@/components/graph/memory-graph").then((m) => ({
    default: m.MemoryGraphCanvas,
  }))
)

const SCOPE_FILTERS: Array<{ value: MemoryScope | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "global", label: "Everywhere" },
  { value: "project", label: "Project" },
  { value: "session", label: "Conversation" },
]

const EMPTY = new Set<never>()

/**
 * Where the relatedness slider starts.
 *
 * A guess, and knowingly so — see the note on `MINIMUM_SCORE` in the API's related builder. The
 * slider exists precisely because no single value is defensible without a corpus to measure, and
 * moving it is how you find the one that suits yours.
 */
const DEFAULT_MINIMUM_SCORE = 0.6

export function GraphPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scope, setScope] = useState<MemoryScope | "all">("all")
  const [categories, setCategories] =
    useState<ReadonlySet<MemoryCategory>>(EMPTY)
  const [groups, setGroups] = useState<ReadonlySet<string>>(EMPTY)
  const [showReplaced, setShowReplaced] = useState(true)
  const [query, setQuery] = useState("")
  const [focusId, setFocusId] = useState<string | null>(null)
  const [minimumScore, setMinimumScore] = useState(DEFAULT_MINIMUM_SCORE)

  const isDark = useResolvedDark()
  const palette = isDark ? PALETTE.dark : PALETTE.light

  const { data, isPending, isError } = useQuery({
    queryKey: ["graph"],
    queryFn: () => api.graph(),
  })

  // Its own query so the shells render on the first response and the similarity pass — which has
  // to reach Vectorize and then compare every pair — arrives whenever it arrives.
  const { data: related } = useQuery({
    queryKey: ["graph", "related"],
    queryFn: () => api.graphRelated(),
  })

  const relatedLinks = related?.links ?? []
  const drawnLinks = relatedLinks.filter((link) => link.score >= minimumScore)

  // The timeline dialog wants a Memory; the graph only carries an id, so fetch the one the
  // user actually clicked rather than shipping every field in the graph payload.
  const { data: selected } = useQuery({
    queryKey: ["memories", selectedId, "timeline"],
    queryFn: () => api.memories.timeline(selectedId!),
    enabled: Boolean(selectedId),
  })

  const filters: GraphFilters = useMemo(
    () => ({
      categories,
      scopes: scope === "all" ? EMPTY : new Set([scope]),
      groups,
      showReplaced,
      query: query.trim().toLowerCase(),
    }),
    [categories, groups, query, scope, showReplaced]
  )

  const memories = useMemo(
    () => data?.nodes.filter((node) => node.kind === "memory") ?? [],
    [data?.nodes]
  )

  // Mirrors the canvas's own visibility rule so the header can say what is on screen.
  const shown = useMemo(
    () =>
      memories.filter((node) => {
        if (node.scope === "suppressed") return showReplaced
        if (
          filters.scopes.size > 0 &&
          (!node.scope || !filters.scopes.has(node.scope))
        )
          return false
        if (
          categories.size > 0 &&
          (!node.category || !categories.has(node.category))
        )
          return false
        if (groups.size > 0 && (!node.group || !groups.has(node.group)))
          return false
        return true
      }),
    [categories, filters.scopes, groups, memories, showReplaced]
  )

  const toggle = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set)
    if (!next.delete(value)) next.add(value)
    return next
  }

  /** Fly to the first match. Deferred to submit so the camera does not lurch on every keystroke. */
  const jumpToMatch = () => {
    const needle = query.trim().toLowerCase()
    if (!needle) return setFocusId(null)
    const hit = shown.find((node) => node.label.toLowerCase().includes(needle))
    setFocusId(hit ? hit.id : null)
  }

  const graphGroups = data?.groups ?? []

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border/70 px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2.5">
            <Share2 className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Memory graph</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Distance from the centre is how far a memory reaches. Direction is
            where it came from.
          </p>
          {memories.length > 0 && (
            <p className="ml-auto text-xs text-muted-foreground">
              {shown.length === memories.length
                ? `${memories.length} memories`
                : `${shown.length} of ${memories.length}`}
            </p>
          )}
        </div>

        {memories.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <form
              className="relative w-full sm:w-56"
              onSubmit={(event) => {
                event.preventDefault()
                jumpToMatch()
              }}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search, then press enter…"
                className="h-8 pl-9 text-xs"
              />
            </form>

            <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-muted/60 p-1">
              {SCOPE_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setScope(filter.value)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    scope === filter.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* The category chips are the legend. One control that both names the colours and
                filters by them, so there is nothing to keep in sync and nothing to look up. */}
            <ul className="flex flex-wrap items-center gap-1.5">
              {MEMORY_CATEGORIES.map((category) => {
                const active = categories.size === 0 || categories.has(category)
                return (
                  <li key={category}>
                    <button
                      onClick={() =>
                        setCategories(toggle(categories, category))
                      }
                      aria-pressed={categories.has(category)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-opacity",
                        active ? "opacity-100" : "opacity-40"
                      )}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ background: palette.category[category] }}
                      />
                      {CATEGORY_LABEL[category]}
                    </button>
                  </li>
                )
              })}
              <li>
                <button
                  onClick={() => setShowReplaced((value) => !value)}
                  aria-pressed={showReplaced}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-opacity",
                    showReplaced ? "opacity-100" : "opacity-40"
                  )}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: palette.replaced }}
                  />
                  Replaced
                </button>
              </li>
            </ul>

            {graphGroups.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                    />
                  }
                >
                  {groups.size === 0
                    ? "Any source"
                    : `${groups.size} source(s)`}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-72 w-64 overflow-y-auto"
                >
                  {groups.size > 0 && (
                    <DropdownMenuItem onClick={() => setGroups(EMPTY)}>
                      Clear source filter
                    </DropdownMenuItem>
                  )}
                  {graphGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.id}
                      onClick={() => setGroups(toggle(groups, group.id))}
                    >
                      <span className="flex-1 truncate">{group.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.count}
                      </span>
                      {groups.has(group.id) && <Check className="size-3.5" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Hidden entirely when there is no vector index or nothing indexed — a control that
                cannot change anything is worse than no control. */}
            {related?.available && relatedLinks.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link2 className="size-3.5" />
                <span className="whitespace-nowrap">Relatedness</span>
                <input
                  type="range"
                  min={0.3}
                  max={0.95}
                  step={0.01}
                  value={minimumScore}
                  onChange={(event) =>
                    setMinimumScore(Number(event.target.value))
                  }
                  className="h-1 w-24 cursor-pointer accent-primary"
                  aria-label="Minimum similarity for a link"
                />
                <span className="w-16 font-mono text-[0.7rem] tabular-nums">
                  {minimumScore.toFixed(2)} · {drawnLinks.length}
                </span>
              </label>
            )}
          </div>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {isError ? (
          <Centered>Could not load the graph.</Centered>
        ) : isPending ? (
          <div className="p-6">
            <Skeleton className="h-full min-h-[24rem] w-full rounded-2xl" />
          </div>
        ) : memories.length === 0 ? (
          <Centered>
            <p className="text-sm font-medium">Nothing to draw yet.</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Save a few memories in MemBot and they will appear here, arranged
              by how far each one reaches.
            </p>
            <LinkButton
              to="/app/membot"
              size="sm"
              variant="outline"
              className="mt-4"
            >
              Go to MemBot
            </LinkButton>
          </Centered>
        ) : (
          <Suspense fallback={<Centered>Loading the graph…</Centered>}>
            <MemoryGraphCanvas
              data={data}
              related={relatedLinks}
              minimumScore={minimumScore}
              filters={filters}
              focusId={focusId}
              onSelect={setSelectedId}
            />
          </Suspense>
        )}

        {data?.truncated && (
          <p className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <Info className="size-3" />
            Showing your 400 most recent memories.
          </p>
        )}

        {memories.length > 0 && (
          <p className="absolute right-4 bottom-4 rounded-full border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
            Drag to rotate · hover to isolate a source · click a memory for its
            history
          </p>
        )}
      </div>

      <MemoryTimeline
        memory={(selected?.memory as Memory | undefined) ?? null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  )
}
