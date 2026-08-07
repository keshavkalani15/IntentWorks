import { LinkButton } from "@/components/link-button"
import { Wordmark } from "@/components/brand"

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark />
      <div>
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Nothing stored at this address.
        </h1>
      </div>
      <LinkButton to="/">Back to the start</LinkButton>
    </div>
  )
}
