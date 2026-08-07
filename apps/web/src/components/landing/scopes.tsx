import { useState } from "react"

import type { MemoryScope } from "@workspace/shared"
import { cn } from "@workspace/ui/lib/utils"

import { Reveal } from "@/components/landing/reveal"
import { SCOPE_META } from "@/components/memory/scope-meta"

const ORDER: MemoryScope[] = ["session", "project", "global", "suppressed"]

/** Three sample conversations, used to show what each scope actually reaches. */
const CONVERSATIONS = [
  { id: "a", label: "The chat it was learned in", project: "acme" },
  { id: "b", label: "Another chat, same project", project: "acme" },
  { id: "c", label: "A chat in a different project", project: "zeta" },
]

function reaches(scope: MemoryScope, conversation: (typeof CONVERSATIONS)[number]): boolean {
  if (scope === "suppressed") return false
  if (scope === "global") return true
  if (scope === "project") return conversation.project === "acme"
  return conversation.id === "a"
}

export function Scopes() {
  const [active, setActive] = useState<MemoryScope>("project")

  return (
    <section id="scopes" className="border-border/70 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            One decision, made once, at the moment it matters.
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed text-pretty">
            Not a privacy dashboard you are meant to audit later. A single question, asked
            while the fact is still in front of you.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
          <Reveal delay={60}>
            <div className="grid gap-3 sm:grid-cols-2">
              {ORDER.map((scope) => {
                const meta = SCOPE_META[scope]
                const Icon = meta.icon
                const selected = active === scope

                return (
                  <button
                    key={scope}
                    onClick={() => setActive(scope)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-2xl border p-5 text-left transition-all duration-200",
                      "focus-visible:ring-ring/30 outline-none focus-visible:ring-3",
                      selected
                        ? "border-primary/40 bg-primary/[0.05] shadow-sm"
                        : "border-border bg-card/40 hover:border-border hover:bg-card"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-full border",
                        meta.tone
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <p className="mt-3.5 text-sm font-semibold">{meta.label}</p>
                    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                      {meta.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="bg-card/40 rounded-3xl border p-6">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Who can read it
              </p>
              <p className="mt-2 text-sm">
                A memory saved as{" "}
                <span className="font-semibold">{SCOPE_META[active].short}</span> is visible in:
              </p>

              <ul className="mt-5 space-y-2.5">
                {CONVERSATIONS.map((conversation) => {
                  const visible = reaches(active, conversation)
                  return (
                    <li
                      key={conversation.id}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors duration-200",
                        visible
                          ? "border-primary/25 bg-primary/[0.05]"
                          : "border-border/60 bg-muted/30 text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          visible ? "bg-primary" : "bg-muted-foreground/40"
                        )}
                      />
                      <span className="min-w-0 flex-1">{conversation.label}</span>
                      <span className="shrink-0 text-xs font-medium">
                        {visible ? "visible" : "hidden"}
                      </span>
                    </li>
                  )
                })}
              </ul>

              <p className="text-muted-foreground mt-5 border-t pt-4 text-xs leading-relaxed">
                &ldquo;Hidden&rdquo; here means the row never leaves the database. The scope
                filter runs before ranking, so out-of-scope memories are not retrieved,
                re-ranked and dropped — they are never candidates.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
