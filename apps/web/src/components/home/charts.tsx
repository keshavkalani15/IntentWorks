import { cn } from "@workspace/ui/lib/utils"

/**
 * Charts here use ONE hue for magnitude and put identity on the axis as a text label.
 *
 * The design system's chart ramp is single-hue (sequential), so it cannot carry categorical
 * identity — and the scope badge colours fail contrast as large fills on a light surface.
 * Naming each row instead sidesteps both problems, and means nothing depends on colour being
 * distinguishable at all.
 */

export function BarRow({
  label,
  value,
  total,
  hint,
}: {
  label: React.ReactNode
  value: number
  total: number
  hint?: string
}) {
  const share = total > 0 ? value / total : 0

  return (
    <div className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
      <div className="text-muted-foreground truncate">{label}</div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="img"
        aria-label={`${value} of ${total}${hint ? ` — ${hint}` : ""}`}
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(share * 100, value > 0 ? 2 : 0)}%` }}
        />
      </div>
      <div className="text-right font-medium tabular-nums">{value}</div>
    </div>
  )
}

/**
 * Memories added per day over the trailing window.
 *
 * A column chart because the job is change-over-time on one series — so no legend (the title
 * names it) and no number on every bar. Values surface on hover instead.
 */
export function ActivityChart({ data }: { data: Array<{ day: number; added: number }> }) {
  const peak = Math.max(1, ...data.map((point) => point.added))
  const total = data.reduce((sum, point) => sum + point.added, 0)

  if (total === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Nothing saved in the last 30 days.
      </p>
    )
  }

  return (
    <div>
      {/* 2px gap between columns, per the mark spec — adjacent fills need a surface gap. */}
      <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={`${total} memories added over 30 days`}>
        {data.map((point) => {
          const date = new Date(point.day)
          const label = `${date.toLocaleDateString("en", { month: "short", day: "numeric" })}: ${
            point.added === 1 ? "1 memory" : `${point.added} memories`
          }`
          return (
            <div
              key={point.day}
              title={label}
              className="group relative flex h-full flex-1 items-end"
            >
              <div
                className={cn(
                  "w-full rounded-t transition-colors",
                  point.added > 0
                    ? "bg-primary/80 group-hover:bg-primary"
                    : "bg-muted group-hover:bg-muted-foreground/30"
                )}
                style={{ height: point.added > 0 ? `${(point.added / peak) * 100}%` : "2px" }}
              />
            </div>
          )
        })}
      </div>

      <div className="text-muted-foreground mt-2 flex justify-between text-xs">
        <span>{formatDay(data[0]?.day)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function formatDay(day: number | undefined): string {
  if (!day) return ""
  return new Date(day).toLocaleDateString("en", { month: "short", day: "numeric" })
}

/**
 * A headline number. Not a chart — a single value with no comparison has no shape to plot,
 * and a one-bar chart is just a number wearing a costume.
 */
export function StatTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: string | number
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        emphasis ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-card/40"
      )}
    >
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{hint}</p>}
    </div>
  )
}
