import { ArrowRight } from "lucide-react"
import { Link } from "react-router"

import { Wordmark } from "@/components/brand"
import { Reveal } from "@/components/landing/reveal"
import { LinkButton } from "@/components/link-button"

export function Closing() {
  return (
    <section className="border-border/70 border-t">
      <div className="relative mx-auto w-full max-w-6xl overflow-hidden px-6 py-24 sm:py-32">
        <div
          aria-hidden
          className="bg-primary/10 pointer-events-none absolute bottom-[-16rem] left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-[130px]"
        />
        <Reveal className="relative mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Start with an assistant that has to ask.
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed text-pretty">
            Free to try. Nothing is remembered until you say so — including the fact that you
            were here.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton to="/signup" size="lg">
              Create an account
              <ArrowRight data-icon="inline-end" className="size-4" />
            </LinkButton>
            <LinkButton to="/login" size="lg" variant="outline">
              Sign in
            </LinkButton>
          </div>
          <p className="text-muted-foreground mt-6 text-sm">
            <Link
              to="/pricing"
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              See what the paid plans include
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-border/70 border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 text-xs sm:flex-row sm:items-center sm:justify-between">
        <Link to="/" className="text-foreground/80 hover:text-foreground transition-colors">
          <Wordmark />
        </Link>

        <nav className="flex flex-wrap items-center gap-5">
          <Link to="/pricing" className="hover:text-foreground transition-colors">
            Pricing
          </Link>
          <Link to="/login" className="hover:text-foreground transition-colors">
            Sign in
          </Link>
          <Link to="/signup" className="hover:text-foreground transition-colors">
            Create an account
          </Link>
        </nav>
      </div>
    </footer>
  )
}
