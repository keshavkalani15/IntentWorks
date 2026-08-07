import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Inbox } from "lucide-react"

import { MEMORY_CATEGORIES, SELECTABLE_SCOPES } from "@workspace/shared"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { ActivityFeed } from "@/components/home/activity-feed"
import { ActivityChart, BarRow, StatTile } from "@/components/home/charts"
import { LinkButton } from "@/components/link-button"
import { SCOPE_META } from "@/components/memory/scope-meta"
import { api } from "@/lib/api"
import { useSession } from "@/lib/auth-client"
import { formatDate } from "@/lib/format"

export function HomePage() {
  const { data: session } = useSession()
  const { data: stats, isPending, isError } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats(),
  })

  const firstName = session?.user.name?.split(" ")[0] ?? "there"

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Hello, {firstName}.</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {stats?.memories.active
              ? `MemBot knows ${stats.memories.active} ${stats.memories.active === 1 ? "thing" : "things"} about you — all of it because you said yes.`
              : "Nothing is remembered yet. Everything here starts with you approving it."}
          </p>
        </header>

        {isError ? (
          <p className="text-muted-foreground mt-10 text-sm">Could not load your statistics.</p>
        ) : isPending || !stats ? (
          <LoadingState />
        ) : (
          <div className="mt-8 space-y-6">
            {stats.proposals.pending > 0 && <PendingBanner count={stats.proposals.pending} />}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Remembered"
                value={stats.memories.active}
                hint={
                  stats.memories.firstAt
                    ? `since ${formatDate(stats.memories.firstAt)}`
                    : "nothing saved yet"
                }
                emphasis
              />
              <StatTile
                label="You approved"
                value={
                  stats.proposals.acceptanceRate === null
                    ? "—"
                    : `${Math.round(stats.proposals.acceptanceRate * 100)}%`
                }
                hint={
                  stats.proposals.acceptanceRate === null
                    ? "no suggestions answered yet"
                    : `${stats.proposals.accepted} kept · ${stats.proposals.declined} refused`
                }
              />
              <StatTile
                label="Turned down"
                value={stats.memories.suppressed}
                hint="never suggested again"
              />
              <StatTile
                label="Conversations"
                value={stats.conversations}
                hint="each one its own boundary"
              />
            </section>

            <section className="border-border bg-card/40 rounded-2xl border p-6">
              <h2 className="text-sm font-semibold">Memories saved per day</h2>
              <p className="text-muted-foreground mt-0.5 mb-5 text-xs">Last 30 days</p>
              <ActivityChart data={stats.activityByDay} />
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="border-border bg-card/40 rounded-2xl border p-6">
                <h2 className="text-sm font-semibold">How far each memory reaches</h2>
                <p className="text-muted-foreground mt-0.5 mb-5 text-xs">
                  The scope you chose when you approved it
                </p>
                <div className="space-y-3">
                  {SELECTABLE_SCOPES.map((scope) => (
                    <BarRow
                      key={scope}
                      label={SCOPE_META[scope].label}
                      value={stats.memories.byScope[scope] ?? 0}
                      total={stats.memories.active}
                      hint={SCOPE_META[scope].short}
                    />
                  ))}
                </div>
              </section>

              <section className="border-border bg-card/40 rounded-2xl border p-6">
                <h2 className="text-sm font-semibold">What it knows about</h2>
                <p className="text-muted-foreground mt-0.5 mb-5 text-xs">By category</p>
                <div className="space-y-3">
                  {MEMORY_CATEGORIES.filter(
                    (category) => (stats.memories.byCategory[category] ?? 0) > 0
                  ).map((category) => (
                    <BarRow
                      key={category}
                      label={<span className="capitalize">{category}</span>}
                      value={stats.memories.byCategory[category] ?? 0}
                      total={stats.memories.active}
                    />
                  ))}
                  {Object.keys(stats.memories.byCategory).length === 0 && (
                    <p className="text-muted-foreground text-sm">Nothing categorised yet.</p>
                  )}
                </div>
              </section>
            </div>

            <section className="border-border bg-card/40 rounded-2xl border p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold">How your memory got here</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Every suggestion, decision and change, in order
                  </p>
                </div>
                <LinkButton to="/app/settings" variant="ghost" size="xs">
                  Manage
                  <ArrowRight data-icon="inline-end" className="size-3" />
                </LinkButton>
              </div>
              <ActivityFeed entries={stats.recent} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function PendingBanner({ count }: { count: number }) {
  return (
    <div className="border-primary/25 bg-primary/[0.05] flex items-center gap-3 rounded-2xl border p-4">
      <Inbox className="text-primary size-4 shrink-0" />
      <p className="flex-1 text-sm">
        <span className="font-medium">
          {count === 1 ? "1 suggestion is" : `${count} suggestions are`} waiting on you.
        </span>{" "}
        <span className="text-muted-foreground">
          Nothing is saved until you decide.
        </span>
      </p>
      <LinkButton to="/app/membot" size="sm" variant="outline">
        Review
      </LinkButton>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-52 rounded-2xl" />
        <Skeleton className="h-52 rounded-2xl" />
      </div>
    </div>
  )
}
