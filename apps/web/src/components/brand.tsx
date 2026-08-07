import { cn } from "@workspace/ui/lib/utils"

/**
 * The mark: two nested rounded squares with a gap between them — a memory held inside a
 * boundary. Drawn rather than imported so it inherits `currentColor` and needs no asset.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect
        x="1.25"
        y="1.25"
        width="21.5"
        height="21.5"
        rx="7.25"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
      />
      <rect x="6.5" y="6.5" width="11" height="11" rx="3.5" fill="currentColor" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Mark className="text-primary size-6" />
      <span className="text-[0.95rem] font-semibold tracking-tight">Negotiated Memory</span>
    </span>
  )
}
