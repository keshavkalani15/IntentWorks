import { Reveal } from "@/components/landing/reveal"

const STEPS = [
  {
    n: "01",
    title: "You talk. It listens for what lasts.",
    body: "MemBot watches for durable facts — preferences, constraints, decisions, the shape of your projects — and ignores the rest. Task chatter is not memory.",
    detail: "Prefers tabs over spaces",
    detailLabel: "candidate fact",
  },
  {
    n: "02",
    title: "It asks. You answer in one click.",
    body: "A proposal appears inline, in the conversation, while the fact is still in context. Pick a scope, or decline. Until you do, nothing has been written.",
    detail: "This conversation · This project · Everywhere",
    detailLabel: "your choice",
  },
  {
    n: "03",
    title: "Recall stays inside the boundary you set.",
    body: "Later turns retrieve only what your scope allows. Every memory keeps a timeline, so you can always see what it knows and how it came to know it.",
    detail: "2 memories shaped this answer",
    detailLabel: "attribution",
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="border-border/70 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Three steps, and you are in the loop for the one that matters.
          </h2>
        </Reveal>

        <ol className="mt-14 space-y-px">
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.n} delay={index * 80}>
              <div className="border-border/70 grid gap-6 border-t py-9 md:grid-cols-[4rem_1fr_auto] md:items-start md:gap-10">
                <span className="text-muted-foreground/60 font-mono text-sm">{step.n}</span>

                <div className="max-w-xl">
                  <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                  <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
                    {step.body}
                  </p>
                </div>

                <div className="bg-card/60 rounded-2xl border px-4 py-3 md:min-w-[15rem]">
                  <p className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
                    {step.detailLabel}
                  </p>
                  <p className="mt-1.5 text-sm font-medium">{step.detail}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
