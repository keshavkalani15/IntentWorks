import { useState } from "react"
import { ArrowRight, Check, Minus } from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import { Reveal } from "@/components/landing/reveal"
import { LinkButton } from "@/components/link-button"

type Billing = "monthly" | "annual"

type Plan = {
  id: string
  name: string
  /** Dollars per month. `annual` is the per-month figure when a year is paid up front. */
  price: Record<Billing, number>
  /** What a year costs up front. Null for the plan with nothing to bill. */
  annualTotal: number | null
  unit?: string
  cta: string
  ctaTo: string
  badge?: string
  highlight?: boolean
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: { monthly: 0, annual: 0 },
    annualTotal: null,
    cta: "Create an account",
    ctaTo: "/signup",
  },
  {
    id: "memory",
    name: "Memory",
    price: { monthly: 5, annual: 4 },
    annualTotal: 48,
    cta: "Start with Memory",
    ctaTo: "/signup?plan=memory",
  },
  {
    id: "pro",
    name: "Pro",
    price: { monthly: 12, annual: 10 },
    annualTotal: 120,
    cta: "Start with Pro",
    ctaTo: "/signup?plan=pro",
    badge: "Recommended",
    highlight: true,
  },
  {
    id: "team",
    name: "Team",
    price: { monthly: 20, annual: 16 },
    annualTotal: 192,
    unit: "per person",
    cta: "Join the waitlist",
    ctaTo: "/signup?plan=team",
  },
]

const YES = "yes" as const
const NO = "no" as const
type Cell = string | typeof YES | typeof NO

type Row = {
  label: string
  hint?: string
  values: [Cell, Cell, Cell, Cell]
}

/**
 * MemBot usage is sold as a monthly balance in dollars rather than a message count, because a
 * message is not a fixed unit — a one-line reply and a five-step tool loop over four images
 * differ by more than a hundredfold. Quoting messages means pricing the worst case and charging
 * everyone for it. Everything that is not inference is deliberately unmetered on paid plans.
 */
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "MemBot",
    rows: [
      {
        label: "Inference included",
        hint: "Billed at what the provider charges us, never marked up",
        values: ["$1 a month", "$2 a month", "$6 a month", "$9 per person"],
      },
      {
        label: "Roughly how many replies",
        hint: "Long conversations with images cost more than short ones",
        values: ["≈ 165", "≈ 330", "≈ 1,000", "≈ 1,500, pooled"],
      },
      { label: "Top up any time", values: [NO, YES, YES, YES] },
      { label: "Voice capture", values: [NO, NO, "120 min", "120 min each"] },
      { label: "Images in conversation", values: [NO, YES, YES, YES] },
    ],
  },
  {
    title: "Memory",
    rows: [
      {
        label: "Saved memories",
        values: ["100", "Unlimited", "Unlimited", "Unlimited"],
      },
      {
        label: "Session, project and global scopes",
        values: [YES, YES, YES, YES],
      },
      { label: "Shared project scopes", values: [NO, NO, NO, YES] },
      {
        label: "Timeline and map history",
        values: ["30 days", "Forever", "Forever", "Forever"],
      },
      { label: "Export everything", values: [NO, YES, YES, YES] },
    ],
  },
  {
    title: "Connected agents",
    rows: [
      {
        label: "Agents you can connect",
        hint: "Claude, Cursor, VS Code, ChatGPT — anything speaking MCP",
        values: ["1", "Unlimited", "Unlimited", "Unlimited"],
      },
      {
        label: "Search memory",
        hint: "Never metered on a paid plan",
        values: ["200 a month", "Unmetered", "Unmetered", "Unmetered"],
      },
      { label: "Propose a memory", values: [NO, YES, YES, YES] },
      { label: "See which agent proposed what", values: [NO, YES, YES, YES] },
      { label: "Revoke an agent org-wide", values: [NO, NO, NO, YES] },
      { label: "Audit export of the event log", values: [NO, NO, NO, YES] },
    ],
  },
]

function CellValue({ value }: { value: Cell }) {
  if (value === YES) return <Check className="text-primary size-4" strokeWidth={2.5} />
  if (value === NO) return <Minus className="text-muted-foreground/40 size-4" />
  return <span>{value}</span>
}

function BillingToggle({
  billing,
  onChange,
}: {
  billing: Billing
  onChange: (next: Billing) => void
}) {
  const OPTIONS: { value: Billing; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "annual", label: "Yearly" },
  ]

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="bg-card/40 inline-flex rounded-full border p-1">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={billing === option.value}
            className={cn(
              "focus-visible:ring-ring/30 rounded-full px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3",
              billing === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="text-muted-foreground text-xs">Save up to 20% paying yearly</span>
    </div>
  )
}

export function PricingHero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="bg-primary/10 pointer-events-none absolute top-[-18rem] left-1/2 size-[32rem] -translate-x-1/2 rounded-full blur-[130px]"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 pt-16 pb-4 sm:pt-24">
        <Reveal className="max-w-2xl">
          <span className="border-border/70 bg-card/60 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
            <span className="bg-primary size-1.5 rounded-full" />
            Pricing
          </span>
          <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
            <span className="text-muted-foreground">Pay for the assistant.</span>{" "}
            <span className="text-foreground">Never for the memory.</span>
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
            Recall, scopes, connected agents and the audit timeline are unmetered on every paid
            plan. The one thing with a meter on it is model inference, and that is passed
            through at what it costs us — in dollars, not in messages.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

export function PricingTable() {
  const [billing, setBilling] = useState<Billing>("monthly")

  return (
    <section className="pt-10 pb-20 sm:pb-28">
      <div className="mx-auto w-full max-w-6xl px-6">
        <Reveal>
          <BillingToggle billing={billing} onChange={setBilling} />
        </Reveal>

        <Reveal delay={60} className="mt-8">
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              {/* The highlighted column is painted per cell rather than with a column rule,
                  because `colgroup` backgrounds sit under borders and lose to row striping. */}
              <thead>
                <tr>
                  <th className="w-[26%] p-0" />
                  {PLANS.map((plan) => (
                    <th
                      key={plan.id}
                      className={cn(
                        "w-[18.5%] px-5 pt-6 pb-5 text-left align-top",
                        plan.highlight && "bg-primary/[0.04] rounded-t-3xl"
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tracking-tight">
                          {plan.name}
                        </span>
                        {plan.badge && (
                          <Badge variant="default" className="text-[0.65rem]">
                            {plan.badge}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 flex items-baseline gap-1.5">
                        <span className="text-3xl font-semibold tracking-tight tabular-nums">
                          ${plan.price[billing]}
                        </span>
                        {plan.price[billing] > 0 && (
                          <span className="text-muted-foreground text-xs font-normal">
                            /month
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs font-normal">
                        {plan.price[billing] === 0
                          ? "No card, no expiry"
                          : billing === "annual" && plan.annualTotal
                            ? `$${plan.annualTotal} a year${plan.unit ? `, ${plan.unit}` : ""}`
                            : plan.unit
                              ? `Billed monthly, ${plan.unit}`
                              : "Billed monthly"}
                      </p>

                      <LinkButton
                        to={plan.ctaTo}
                        size="sm"
                        variant={plan.highlight ? "default" : "outline"}
                        className="mt-4 w-full"
                      >
                        {plan.cta}
                      </LinkButton>
                    </th>
                  ))}
                </tr>
              </thead>

              {GROUPS.map((group) => (
                <tbody key={group.title}>
                  <tr>
                    <th className="text-muted-foreground border-border/70 border-y px-0 py-2.5 text-left text-xs font-medium tracking-wide uppercase">
                      {group.title}
                    </th>
                    {PLANS.map((plan) => (
                      <td
                        key={plan.id}
                        className={cn(
                          "border-border/70 border-y",
                          plan.highlight && "bg-primary/[0.04]"
                        )}
                      />
                    ))}
                  </tr>

                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-border/70 border-b">
                      <th className="py-4 pr-6 text-left align-top font-normal">
                        <span className="block">{row.label}</span>
                        {row.hint && (
                          <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                            {row.hint}
                          </span>
                        )}
                      </th>
                      {row.values.map((value, index) => (
                        <td
                          key={PLANS[index]!.id}
                          className={cn(
                            "px-5 py-4 align-top",
                            PLANS[index]!.highlight && "bg-primary/[0.04]"
                          )}
                        >
                          <CellValue value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}

              <tfoot>
                <tr>
                  <td className="p-0" />
                  {PLANS.map((plan) => (
                    <td
                      key={plan.id}
                      className={cn(
                        "px-5 pt-6 pb-6",
                        plan.highlight && "bg-primary/[0.04] rounded-b-3xl"
                      )}
                    >
                      <LinkButton
                        to={plan.ctaTo}
                        size="sm"
                        variant={plan.highlight ? "default" : "outline"}
                        className="w-full"
                      >
                        {plan.cta}
                      </LinkButton>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <p className="text-muted-foreground mt-8 text-sm">
            Run the balance down early? Top up at{" "}
            <span className="text-foreground font-medium">$5 for $5 of inference</span> — we do
            not mark up tokens. When it does run out, MemBot pauses and nothing else does: your
            memories stay put and every connected agent keeps recalling and proposing.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

const FAQ = [
  {
    q: "Why is inference priced in dollars instead of messages?",
    a: "Because a message is not a unit. A one-line answer and a five-step search that reads four images differ by more than a hundredfold, so any message count has to be priced for the worst case and charged to everyone. A balance in dollars just tells you the truth, and your usage log shows exactly what each reply drew down.",
  },
  {
    q: "Why is recall unmetered when replies are not?",
    a: "Because a search costs us a fraction of a cent and a reply does not. Charging for recall would teach you to connect fewer agents and ask fewer questions, which is the exact opposite of what this is for.",
  },
  {
    q: "Do you mark up model usage?",
    a: "No. The balance is denominated at what the provider bills us, and top-ups are sold one for one. We make our money on the subscription, so we have no reason to want your conversations to run longer than they need to.",
  },
  {
    q: "Can a connected agent spend my balance?",
    a: "It cannot spend anything. Outside agents only search and propose, and neither draws on the balance. Nothing an agent proposes is written until you approve it yourself, in your own browser.",
  },
  {
    q: "What happens to my memories if I downgrade?",
    a: "Nothing is deleted. You return to the Free limits, memories past the limit become inactive rather than removed, and export stays available on any plan that had it.",
  },
  {
    q: "Which agents can connect?",
    a: "Anything that speaks MCP — Claude, Cursor, VS Code, ChatGPT, or something you wrote yourself. You approve each one, see what it proposed, and can revoke it whenever you want.",
  },
  {
    q: "Do you train on my memories?",
    a: "No. They are yours, they are scoped by your choices, and they are never used to train anything.",
  },
]

export function PricingFaq() {
  return (
    <section id="faq" className="border-border/70 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              The questions worth asking first.
            </h2>
          </Reveal>

          <Reveal delay={80}>
            <Accordion className="border-border/70 border-t">
              {FAQ.map((item) => (
                <AccordionItem key={item.q} value={item.q}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>

        <Reveal delay={140} className="mt-16">
          <div className="border-primary/25 bg-primary/[0.03] flex flex-wrap items-center justify-between gap-5 rounded-3xl border p-7 sm:p-8">
            <div className="max-w-lg">
              <h3 className="text-lg font-semibold tracking-tight">
                Still deciding? Start on Free.
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                It includes the whole consent model — proposals, scopes, the timeline and one
                connected agent. Nothing is remembered until you say so.
              </p>
            </div>
            <LinkButton to="/signup" size="lg">
              Create an account
              <ArrowRight data-icon="inline-end" className="size-4" />
            </LinkButton>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
