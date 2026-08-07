import { Check, X } from "lucide-react"

import { Reveal } from "@/components/landing/reveal"

/**
 * The section that makes the rest of the page bigger than one chat app.
 *
 * Everything above it argues that you stay in the loop for the write. The claim here is that
 * the loop is a property of the memory, not of our client — so it holds for any assistant you
 * connect. Deliberately not framed as "we support MCP": the protocol is the mechanism, not
 * the reason anyone should care.
 *
 * The permission table is the load-bearing part. "There is no write permission" is checkable
 * — it is the actual scope list the server advertises — and it is the one thing that
 * distinguishes this from every other memory a tool can plug into.
 */
const GRANTS = [
  {
    allowed: true,
    title: "Read what you have saved",
    body: "And only inside the scope that applies. A project fact stays in that project, even for an outside assistant.",
  },
  {
    allowed: true,
    title: "Suggest something new",
    body: "It can ask as often as it likes. Asking is not saving, and a suggestion you have already turned down is never raised again.",
  },
  {
    allowed: false,
    title: "Save, edit or forget anything",
    body: "There is no permission for this, so there is nothing to grant. Approval happens on a page in your browser, which an assistant cannot open, fill in or fake.",
  },
]

export function Portable() {
  return (
    <section id="connect" className="border-border/70 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20">
          <Reveal>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
              Works with your other assistants
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              The asking travels with the memory.
            </h2>
            <p className="text-muted-foreground mt-5 text-base leading-relaxed text-pretty">
              Connect Claude, Cursor, or anything else that speaks MCP, and it gets the same
              deal MemBot has — it can recall what you have kept, and it can make a case for
              something new. That is the whole surface.
            </p>
            <p className="text-muted-foreground mt-4 text-base leading-relaxed text-pretty">
              Most memory you can plug a tool into hands it a save button. This one does not
              have one to hand over.
            </p>

            <div className="border-border/70 bg-card/60 mt-8 rounded-2xl border px-5 py-4">
              <p className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
                what an assistant is given
              </p>
              <p className="mt-2 font-mono text-sm">
                memory:read
                <span className="text-muted-foreground/60"> · </span>
                memory:propose
              </p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <ul className="space-y-px">
              {GRANTS.map((grant) => (
                <li
                  key={grant.title}
                  className="border-border/70 flex gap-4 border-t py-6 first:border-t-0 first:pt-0"
                >
                  <span
                    aria-hidden
                    className={
                      grant.allowed
                        ? "bg-primary/10 text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                        : "bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                    }
                  >
                    {grant.allowed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>

                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">
                      {grant.title}
                      <span className="sr-only">{grant.allowed ? " — allowed" : " — never"}</span>
                    </h3>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {grant.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
