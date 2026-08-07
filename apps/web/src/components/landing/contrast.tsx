import { Check, X } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { Reveal } from "@/components/landing/reveal"

const TODAY = [
  {
    title: "It decides, then tells you",
    body: "A model judges what is worth keeping mid-conversation. You find out later, in a settings page you never open.",
  },
  {
    title: "One undifferentiated bucket",
    body: "A throwaway detail from a Tuesday debugging session outlives the session it came from, and colours answers for months.",
  },
  {
    title: "No provenance",
    body: "You cannot ask why it believes something, where it learned it, or which stored fact shaped the answer you just got.",
  },
  {
    title: "Deleting is a suggestion",
    body: "The row goes. The embedding often lingers, and the fact resurfaces in the next retrieval.",
  },
]

const HERE = [
  {
    title: "Nothing is written without a yes",
    body: "Proposals live in a separate table that retrieval cannot read. No approval, no memory — there is no code path around it.",
  },
  {
    title: "Four scopes, chosen per fact",
    body: "Session, project, global, or never. The choice is yours at the moment of saving, and re-scopable at any time afterwards.",
  },
  {
    title: "An audit timeline per memory",
    body: "Proposed, accepted, re-scoped, suppressed — who did it and when. The answer to “why does it think that?” is one click.",
  },
  {
    title: "Declining is permanent",
    body: "A refusal becomes a tombstone. The same fact is never proposed again, however it is reworded.",
  },
]

function Column({
  eyebrow,
  heading,
  items,
  tone,
}: {
  eyebrow: string
  heading: string
  items: typeof TODAY
  tone: "negative" | "positive"
}) {
  const Icon = tone === "positive" ? Check : X

  return (
    <div
      className={cn(
        "rounded-3xl border p-7 sm:p-8",
        tone === "positive" ? "border-primary/25 bg-primary/[0.03]" : "border-border bg-card/40"
      )}
    >
      <p
        className={cn(
          "text-xs font-medium tracking-wide uppercase",
          tone === "positive" ? "text-primary" : "text-muted-foreground"
        )}
      >
        {eyebrow}
      </p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight">{heading}</h3>

      <ul className="mt-7 space-y-6">
        {items.map((item) => (
          <li key={item.title} className="flex gap-3.5">
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                tone === "positive"
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Icon className="size-3" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Contrast() {
  return (
    <section id="contrast" className="border-border/70 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Memory became a feature before anyone asked who it was for.
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed text-pretty">
            The problem was never storage. It is that the storing happens without you, in one
            undifferentiated pile, with no way back out.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Reveal delay={60}>
            <Column
              eyebrow="How it works today"
              heading="Memory that happens to you"
              items={TODAY}
              tone="negative"
            />
          </Reveal>
          <Reveal delay={140}>
            <Column
              eyebrow="How it works here"
              heading="Memory you negotiate"
              items={HERE}
              tone="positive"
            />
          </Reveal>
        </div>
      </div>
    </section>
  )
}
