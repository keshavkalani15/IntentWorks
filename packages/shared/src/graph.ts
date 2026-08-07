import { z } from "zod"

import { memoryCategorySchema, memoryScopeSchema } from "./scope"

/**
 * Provenance graph: not similarity, but structure — how far each memory reaches, where it came
 * from, and what replaced what.
 *
 * Position carries the meaning, which is why boundaries are no longer nodes. `scope` picks the
 * shell a memory sits on (distance from the owner = reach) and `group` picks the sector of that
 * shell (angle = source). The previous shape emitted a node per boundary plus a containment
 * edge per memory, which described the same two fields using ~n extra links, parked hubs in the
 * middle of the scene, and left the layout with nothing to encode but "everything descends from
 * you" — a fact one glance already tells you.
 */
export const graphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["user", "memory"]),
  label: z.string(),
  /** Null on the owner. Decides the shell radius. */
  scope: memoryScopeSchema.nullable(),
  /** Null on the owner. Decides the colour. */
  category: memoryCategorySchema.nullable(),
  /**
   * The boundary this memory came from — `project:<id>` or `session:<id>` — which decides its
   * sector on the shell.
   *
   * Null for global memories on purpose: "everywhere" has no sub-origin to group by, so they
   * spread evenly across the inner shell instead of collapsing into one arbitrary lobe. Also
   * null for a project- or session-scoped row whose owning id is missing, which the old builder
   * dropped from the graph entirely rather than drawing without a sector.
   */
  group: z.string().nullable(),
  createdAt: z.number().nullable(),
  /** Relative node size. */
  weight: z.number(),
})
export type GraphNode = z.infer<typeof graphNodeSchema>

/**
 * A boundary as metadata rather than as a node — the display name the client needs for its
 * source filter and hover text, plus the count that sizes the sector.
 */
export const graphGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  scope: memoryScopeSchema,
  count: z.number(),
})
export type GraphGroup = z.infer<typeof graphGroupSchema>

/**
 * Supersession is the only remaining edge. Containment became position, and this is the one
 * relation whose direction carries meaning: this replaced that.
 */
export const graphLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  kind: z.literal("supersedes"),
})
export type GraphLink = z.infer<typeof graphLinkSchema>

export const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  links: z.array(graphLinkSchema),
  groups: z.array(graphGroupSchema),
  /** Shown when the graph is truncated, so a partial view never reads as the whole picture. */
  truncated: z.boolean(),
})
export type MemoryGraph = z.infer<typeof graphSchema>

/**
 * An edge drawn because two memories mean similar things, with the cosine similarity that earned
 * it. Unlike everything else in the graph this is inferred rather than recorded, which is why it
 * arrives from its own endpoint and carries its score: there is no defensible universal cutoff
 * for "close enough", so the score travels to the client and the reader picks the line.
 */
export const relatedLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  /** Cosine similarity in [-1, 1]; in practice these are all well above zero. */
  score: z.number(),
})
export type RelatedLink = z.infer<typeof relatedLinkSchema>

export const relatedGraphSchema = z.object({
  /** Sorted strongest first. */
  links: z.array(relatedLinkSchema),
  /**
   * False when the vector index is unbound or nothing is indexed yet. The client hides the
   * relatedness control entirely rather than showing one that cannot do anything.
   */
  available: z.boolean(),
  /** How many memories had a stored vector to compare — context for an empty result. */
  compared: z.number(),
})
export type RelatedGraph = z.infer<typeof relatedGraphSchema>
