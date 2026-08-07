const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
const ABSOLUTE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const DATE_ONLY = new Intl.DateTimeFormat("en", { dateStyle: "medium" })

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
]

export function relativeTime(timestamp: number): string {
  const delta = timestamp - Date.now()
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return RELATIVE.format(Math.round(delta / size), unit)
  }
  return "just now"
}

export const formatDateTime = (timestamp: number) => ABSOLUTE.format(timestamp)
export const formatDate = (timestamp: number) => DATE_ONLY.format(timestamp)

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
