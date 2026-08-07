import { ArrowRight } from "lucide-react"

import { AnchorButton, LinkButton } from "@/components/link-button"
import { ConsentDemo } from "@/components/landing/consent-demo"
import { Reveal } from "@/components/landing/reveal"

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* A single warm bloom behind the demo, rather than a decorative grid. */}
      <div
        aria-hidden
        className="bg-primary/12 pointer-events-none absolute top-[-14rem] right-[-10rem] size-[38rem] rounded-full blur-[130px]"
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-6 pt-16 pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:pt-24 lg:pb-32">
        <div>
          <Reveal>
            <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <span className="bg-primary size-1.5 rounded-full" />
              Memory that asks first
            </span>
          </Reveal>

          <Reveal delay={70}>
            <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
              <span className="text-muted-foreground">
                Every other AI decides what to remember.
              </span>{" "}
              <span className="text-foreground">This one asks.</span>
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
              MemBot proposes; you decide. Every fact you approve gets a scope — this
              conversation, this project, or everywhere — and that scope is enforced in the
              database query, not by asking a model to behave itself.
            </p>
          </Reveal>

          <Reveal delay={210}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton to="/signup" size="lg">
                Start remembering
                <ArrowRight data-icon="inline-end" className="size-4" />
              </LinkButton>
              <AnchorButton href="#how" size="lg" variant="outline">
                See how it works
              </AnchorButton>
            </div>
          </Reveal>

        </div>

        <Reveal delay={160} className="lg:pl-4">
          <ConsentDemo />
          <p className="text-muted-foreground mt-4 text-center text-xs">
            Try it — pick a scope, then open a new conversation.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
