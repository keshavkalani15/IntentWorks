import { useMemo, useState } from "react"

import type { MemoryCategory } from "@workspace/shared"

import { CATEGORY_LABEL, PALETTE } from "@/components/graph/graph-visuals"
import { useResolvedDark } from "@/components/graph/use-resolved-theme"
import { Reveal } from "@/components/landing/reveal"

/**
 * A flat cross-section of the memory graph.
 *
 * Deliberately 2D and deliberately fake data. The real view rotates and is drawn from the
 * viewer's own memories, but a landing page has neither a session nor a reason to pull three.js
 * into the first paint — and a still frame explains the encoding better than an orbit does.
 *
 * Every number below is illustrative. What has to stay true is the *grammar*: distance means
 * reach, direction means source, colour means category, and the two kinds of line mean different
 * things. If the app's encoding changes, this changes with it.
 */

const CX = 220
const CY = 220

const SHELL = { global: 58, project: 112, session: 172 } as const

/** Outside every shell — where a replaced memory sits, in scope nowhere. */
const OUTSIDE = 200

interface Dot {
  id: string
  shell: keyof typeof SHELL
  /** Degrees, counter-clockwise from east. Grouped into tight sectors by source. */
  angle: number
  category: MemoryCategory
}

/**
 * Sectors are tight and separated, the way the real layout keeps them: one per project, one per
 * conversation. Global memories are ungrouped and spread right around the inner shell, because
 * "everywhere" has no origin to subdivide by.
 */
const DOTS: Dot[] = [
  { id: "g1", shell: "global", angle: 52, category: "identity" },
  { id: "g2", shell: "global", angle: 138, category: "preference" },
  { id: "g3", shell: "global", angle: 232, category: "constraint" },
  { id: "g4", shell: "global", angle: 318, category: "fact" },

  { id: "p1", shell: "project", angle: 148, category: "project" },
  { id: "p2", shell: "project", angle: 162, category: "preference" },
  { id: "p3", shell: "project", angle: 176, category: "fact" },

  { id: "p4", shell: "project", angle: 292, category: "constraint" },
  { id: "p5", shell: "project", angle: 306, category: "project" },
  { id: "p6", shell: "project", angle: 320, category: "relationship" },

  { id: "s1", shell: "session", angle: 156, category: "fact" },
  { id: "s2", shell: "session", angle: 168, category: "preference" },
  { id: "s3", shell: "session", angle: 180, category: "relationship" },

  { id: "s4", shell: "session", angle: 300, category: "fact" },
  { id: "s5", shell: "session", angle: 312, category: "project" },
  { id: "s6", shell: "session", angle: 324, category: "constraint" },

  { id: "s7", shell: "session", angle: 62, category: "fact" },
  { id: "s8", shell: "session", angle: 76, category: "preference" },
]

/**
 * Inferred similarity, with the scores that earn each line.
 *
 * The first four are radial on purpose — a global preference, the project version of it, and the
 * conversation it came up in, lining up along one direction. That alignment is the thing the old
 * layout could not show at all.
 */
const RELATED: Array<{ a: string; b: string; score: number }> = [
  { a: "g2", b: "p2", score: 0.91 },
  { a: "p2", b: "s2", score: 0.84 },
  { a: "g4", b: "p5", score: 0.77 },
  { a: "p5", b: "s5", score: 0.71 },
  { a: "p1", b: "s1", score: 0.66 },
  { a: "g3", b: "p4", score: 0.61 },
  { a: "p6", b: "s3", score: 0.54 },
  { a: "s6", b: "s4", score: 0.48 },
  { a: "g1", b: "s8", score: 0.43 },
]

/** The memory that `s2` replaced. */
const REPLACED = { of: "s2", angle: 168 }

const ENCODINGS = [
  {
    term: "Distance",
    means: "how far it reaches — everywhere, one project, one conversation",
  },
  {
    term: "Direction",
    means: "where it came from, one sector per project and conversation",
  },
  { term: "Colour", means: "what kind of claim it is" },
]

function polar(radius: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180
  return {
    x: CX + radius * Math.cos(radians),
    y: CY - radius * Math.sin(radians),
  }
}

export function MemoryMap() {
  const [minimumScore, setMinimumScore] = useState(0.6)
  const isDark = useResolvedDark()
  const palette = isDark ? PALETTE.dark : PALETTE.light

  const positions = useMemo(
    () =>
      new Map(DOTS.map((dot) => [dot.id, polar(SHELL[dot.shell], dot.angle)])),
    []
  )

  const drawn = RELATED.filter((link) => link.score >= minimumScore)
  const replacedAt = polar(OUTSIDE, REPLACED.angle)
  const replacementAt = positions.get(REPLACED.of)!

  return (
    <section id="map" className="border-t border-border/70">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            A boundary you can see, not just trust.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-pretty text-muted-foreground">
            Every memory placed by how far it reaches and where it came from.
            Nothing to audit line by line — the shape tells you.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:gap-12">
          <Reveal delay={60}>
            <div className="rounded-3xl border bg-card/40 p-6">
              <svg
                viewBox="0 0 440 440"
                className="h-auto w-full"
                role="img"
                aria-label="A cross-section of the memory graph: the owner at the centre, three concentric shells for how far a memory reaches, memories grouped into sectors by where they came from and coloured by category, thin lines joining memories that mean similar things, and one replaced memory outside every shell pointing back at what superseded it."
              >
                <defs>
                  <marker
                    id="map-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                  </marker>
                </defs>

                <g className="text-border" stroke="currentColor" fill="none">
                  {Object.values(SHELL).map((radius) => (
                    <circle
                      key={radius}
                      cx={CX}
                      cy={CY}
                      r={radius}
                      strokeDasharray="3 5"
                    />
                  ))}
                </g>

                {/* Similarity first, so the dots sit on top of their own connections. */}
                <g className="text-muted-foreground/60" stroke="currentColor">
                  {drawn.map((link) => {
                    const from = positions.get(link.a)!
                    const to = positions.get(link.b)!
                    return (
                      <line
                        key={`${link.a}-${link.b}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        // Stronger similarity, heavier line — the same rule the app uses.
                        strokeWidth={0.5 + (link.score - 0.4) * 3}
                      />
                    )
                  })}
                </g>

                <g className="text-muted-foreground" stroke="currentColor">
                  <line
                    x1={replacedAt.x}
                    y1={replacedAt.y}
                    x2={
                      replacementAt.x + (replacedAt.x - replacementAt.x) * 0.28
                    }
                    y2={
                      replacementAt.y + (replacedAt.y - replacementAt.y) * 0.28
                    }
                    strokeWidth={1.6}
                    markerEnd="url(#map-arrow)"
                  />
                </g>
                <circle
                  cx={replacedAt.x}
                  cy={replacedAt.y}
                  r={4}
                  fill={palette.replaced}
                  className="text-muted-foreground/50"
                  stroke="currentColor"
                />

                {DOTS.map((dot) => {
                  const at = positions.get(dot.id)!
                  return (
                    <circle
                      key={dot.id}
                      cx={at.x}
                      cy={at.y}
                      r={
                        dot.shell === "global"
                          ? 5.5
                          : dot.shell === "project"
                            ? 5
                            : 4.5
                      }
                      fill={palette.category[dot.category]}
                    />
                  )
                })}

                {/* The owner. A figure in the app itself; a bust glyph is enough at this size. */}
                <g className="text-foreground/75" fill="currentColor">
                  <circle cx={CX} cy={CY - 8} r={5} />
                  <path d={`M ${CX - 9} ${CY + 9} a 9 9 0 0 1 18 0 Z`} />
                </g>
              </svg>

              <label className="mt-5 flex flex-wrap items-center gap-3 border-t pt-5">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Relatedness
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={0.95}
                  step={0.01}
                  value={minimumScore}
                  onChange={(event) =>
                    setMinimumScore(Number(event.target.value))
                  }
                  className="h-1 flex-1 cursor-pointer accent-primary"
                  aria-label="Minimum similarity for drawing a link"
                />
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {minimumScore.toFixed(2)} · {drawn.length} links
                </span>
              </label>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="flex h-full flex-col gap-6">
              <div className="rounded-3xl border bg-card/40 p-6">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Three things at once
                </p>
                <dl className="mt-4 space-y-3.5">
                  {ENCODINGS.map((item) => (
                    <div key={item.term}>
                      <dt className="text-sm font-semibold">{item.term}</dt>
                      <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {item.means}
                      </dd>
                    </div>
                  ))}
                </dl>

                <ul className="mt-5 flex flex-wrap gap-x-3 gap-y-1.5 border-t pt-4">
                  {(Object.keys(CATEGORY_LABEL) as MemoryCategory[]).map(
                    (category) => (
                      <li
                        key={category}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ background: palette.category[category] }}
                        />
                        {CATEGORY_LABEL[category]}
                      </li>
                    )
                  )}
                </ul>
              </div>

              <div className="rounded-3xl border bg-card/40 p-6">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Lines it draws for you
                </p>
                <p className="mt-3 text-sm leading-relaxed">
                  Memories that mean similar things are joined automatically,
                  from the same embeddings that power recall. Nothing to tag.
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Drag the slider to decide how close is close enough. The arrow
                  is different — it is the one relationship that is recorded
                  rather than inferred, pointing from a memory you replaced to
                  whatever replaced it.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
