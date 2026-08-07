import type { GraphNode, MemoryCategory, MemoryScope } from "@workspace/shared"
import { MEMORY_CATEGORIES } from "@workspace/shared"

/**
 * Every colour and radius the graph uses, in one place.
 *
 * This module exists because the legend and the canvas used to define the same encoding twice
 * — the canvas in hard-coded hex, the legend in Tailwind theme tokens — so the swatches and the
 * dots disagreed and nothing in the type system noticed. The legend is now generated from the
 * same constants the renderer reads, which makes that class of drift unrepresentable.
 *
 * WebGL wants literal colours, not CSS variables: the canvas is not part of the document, so
 * `var(--chart-1)` never resolves there. That is why these are hex and not theme tokens.
 */

/**
 * `project` is relabelled because the category enum and the scope enum both contain the word,
 * and they mean different things — a memory categorised `project` can sit on any shell. Showing
 * both as "Project" made the two axes look like they were contradicting each other.
 */
export const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  identity: "Identity",
  preference: "Preference",
  constraint: "Constraint",
  project: "Work",
  relationship: "Relationship",
  fact: "Fact",
}

interface Palette {
  background: string
  /**
   * The owner figure. A mid-tone in both modes rather than near-black or near-white, because this
   * one is a lit 3D mesh and not a flat dot — at either extreme the shading has no range to work
   * in and the figure collapses back into a silhouette.
   */
  user: string
  /** Memories with no category — old rows, written before the enum existed. */
  uncategorised: string
  /** Replaced memories ignore their category: a tombstone's kind is no longer the point. */
  replaced: string
  supersedes: string
  /** Inferred similarity edges. Quieter than supersession, which is recorded fact. */
  related: string
  /** Everything outside the current hover or search focus fades to this. */
  dimmed: string
  category: Record<MemoryCategory, string>
}

/**
 * Six categorical hues is at the limit of what stays separable, and small spheres at depth are
 * the worst case for hue discrimination — distance and occlusion both wash colour out. So colour
 * is never the only encoding: every node carries a hover card naming its category, and the
 * category filter exists so you can isolate one instead of squinting between two.
 */
export const PALETTE: Record<"light" | "dark", Palette> = {
  light: {
    background: "#fcfcfb",
    user: "#4a4a3e",
    uncategorised: "#9a9a86",
    replaced: "#c9c9bd",
    supersedes: "#8a8a72",
    related: "#b0b09e",
    dimmed: "#e0e0d6",
    category: {
      identity: "#b23a08",
      preference: "#d4571e",
      constraint: "#a8791f",
      project: "#5f7d3a",
      relationship: "#3f6f8f",
      fact: "#7c7c68",
    },
  },
  dark: {
    background: "#0c0c09",
    user: "#c9c9b4",
    uncategorised: "#6f6f5c",
    replaced: "#4a4a42",
    supersedes: "#6a6a58",
    related: "#4e4e42",
    dimmed: "#2a2a24",
    category: {
      identity: "#ff8a52",
      preference: "#e2620f",
      constraint: "#d9a441",
      project: "#8fb463",
      relationship: "#6fa3c4",
      fact: "#9a9a82",
    },
  },
}

/**
 * Distance from the owner, in graph units. This is the whole point of the layout: how far a
 * memory sits from you is how far it reaches.
 *
 * `suppressed` is not a shell — a replaced memory is parked just outside its replacement, so
 * this value is only the fallback for a tombstone whose target is missing from the payload.
 */
export const SHELL_RADIUS: Record<MemoryScope, number> = {
  global: 110,
  project: 250,
  session: 400,
  suppressed: 470,
}

export function colorFor(node: GraphNode, palette: Palette): string {
  if (node.kind === "user") return palette.user
  if (node.scope === "suppressed") return palette.replaced
  if (!node.category) return palette.uncategorised
  return palette.category[node.category]
}

/** The legend, derived so it cannot drift from what the canvas draws. */
export function legendFor(
  palette: Palette
): Array<{ label: string; color: string }> {
  return [
    ...MEMORY_CATEGORIES.map((category) => ({
      label: CATEGORY_LABEL[category],
      color: palette.category[category],
    })),
    { label: "Replaced", color: palette.replaced },
  ]
}
