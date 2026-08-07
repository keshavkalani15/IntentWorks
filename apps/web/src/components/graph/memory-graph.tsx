import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d"
import type { Object3D } from "three"

import type {
  GraphNode,
  MemoryCategory,
  MemoryGraph,
  MemoryScope,
  RelatedLink,
} from "@workspace/shared"

import { placeNodes } from "./graph-layout"
import { CATEGORY_LABEL, PALETTE, colorFor } from "./graph-visuals"
import { buildPersonMesh } from "./person"
import { useResolvedDark } from "./use-resolved-theme"

export interface GraphFilters {
  /** Empty means "no filter" rather than "hide everything". */
  categories: ReadonlySet<MemoryCategory>
  scopes: ReadonlySet<MemoryScope>
  groups: ReadonlySet<string>
  showReplaced: boolean
  /** Lowercased. Non-matching nodes fade rather than disappear, so you keep your bearings. */
  query: string
}

/** A node with its computed position, plus the `f*` fields that pin it there. */
type PlacedNode = GraphNode & {
  x: number
  y: number
  z: number
  fx: number
  fy: number
  fz: number
}

/**
 * Both edge kinds in one array, because the renderer takes exactly one.
 *
 * `score` is present only on inferred edges, which is what distinguishes "these two mean similar
 * things, to this degree" from "this replaced that", a fact with no degree to it.
 */
type CanvasLink = {
  source: string
  target: string
  kind: "supersedes" | "related"
  score?: number
}

interface MemoryGraphCanvasProps {
  data: MemoryGraph
  /** Inferred similarity edges, unfiltered. `minimumScore` decides which are drawn. */
  related: RelatedLink[]
  /** Cosine floor for drawing a similarity edge. */
  minimumScore: number
  filters: GraphFilters
  /** Changing this flies the camera to that node. */
  focusId: string | null
  onSelect: (memoryId: string) => void
}

export function MemoryGraphCanvas({
  data,
  related,
  minimumScore,
  filters,
  focusId,
  onSelect,
}: MemoryGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<
    ForceGraphMethods<PlacedNode, CanvasLink> | undefined
  >(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)

  const isDark = useResolvedDark()
  const palette = isDark ? PALETTE.dark : PALETTE.light

  // The canvas needs explicit pixel dimensions; without them it defaults to the whole window
  // and overflows its container.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /**
   * Cloned because the layout engine writes onto the node objects it is handed, and those are the
   * very objects react-query is caching.
   *
   * `x/y/z` are set as well as `fx/fy/fz` so the first frame has real coordinates without waiting
   * for a tick — the simulation is pinned and has nothing to contribute.
   */
  const graphData = useMemo(() => {
    const positions = placeNodes(data.nodes, data.links)
    const present = new Set(data.nodes.map((node) => node.id))

    return {
      nodes: data.nodes.map((node): PlacedNode => {
        const at = positions.get(node.id) ?? { x: 0, y: 0, z: 0 }
        return {
          ...node,
          x: at.x,
          y: at.y,
          z: at.z,
          fx: at.x,
          fy: at.y,
          fz: at.z,
        }
      }),
      links: [
        ...data.links.map((link): CanvasLink => ({ ...link })),
        // EVERY similarity edge goes in, whatever its score, and `linkVisibility` decides which
        // are drawn. Filtering here instead would rebuild the entire scene on every tick of the
        // relatedness slider — including re-cloning the nodes, which throws away the camera.
        //
        // Endpoints are checked because the two halves are fetched separately: a memory deleted
        // between the two requests would otherwise leave an edge pointing at nothing, which the
        // renderer treats as a hard error rather than a missing line.
        ...related
          .filter(
            (link) => present.has(link.source) && present.has(link.target)
          )
          .map((link): CanvasLink => ({ ...link, kind: "related" })),
      ],
    }
  }, [data, related])

  /** Group membership, for fading a hovered memory's siblings up alongside it. */
  const groupOf = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node.group])),
    [data.nodes]
  )

  /**
   * Everything connected to a node, in both directions, so hovering either end lights up the pair.
   *
   * Similarity edges count, but only the ones currently above the threshold — lighting up a
   * neighbour whose connecting line is not drawn would look like a bug rather than a relationship.
   */
  const partners = useMemo(() => {
    const pairs = new Map<string, Set<string>>()
    const add = (from: string, to: string) => {
      const existing = pairs.get(from) ?? new Set<string>()
      existing.add(to)
      pairs.set(from, existing)
    }
    for (const link of data.links) {
      add(link.source, link.target)
      add(link.target, link.source)
    }
    for (const link of related) {
      if (link.score < minimumScore) continue
      add(link.source, link.target)
      add(link.target, link.source)
    }
    return pairs
  }, [data.links, minimumScore, related])

  const visible = useCallback(
    (node: GraphNode): boolean => {
      if (node.kind === "user") return true
      if (node.scope === "suppressed") return filters.showReplaced
      if (
        filters.scopes.size > 0 &&
        (!node.scope || !filters.scopes.has(node.scope))
      )
        return false
      if (
        filters.categories.size > 0 &&
        (!node.category || !filters.categories.has(node.category))
      )
        return false
      if (
        filters.groups.size > 0 &&
        (!node.group || !filters.groups.has(node.group))
      )
        return false
      return true
    },
    [filters]
  )

  /**
   * Focus is separate from visibility: a search or a hover fades everything else instead of
   * removing it, so the shape of the whole graph stays on screen as context.
   */
  const focused = useCallback(
    (node: GraphNode): boolean => {
      if (filters.query) return node.label.toLowerCase().includes(filters.query)
      if (!hoverId) return true
      if (node.id === hoverId) return true
      if (partners.get(hoverId)?.has(node.id)) return true

      const hoveredGroup = groupOf.get(hoverId)
      return Boolean(hoveredGroup) && groupOf.get(node.id) === hoveredGroup
    },
    [filters.query, groupOf, hoverId, partners]
  )

  // Positions are final the moment the data is, so this waits for a paint rather than guessing at
  // how long a simulation needs to settle.
  useEffect(() => {
    let frame = 0
    const outer = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => graphRef.current?.zoomToFit(600, 140))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(frame)
    }
  }, [graphData])

  // Fly to a search hit, keeping the current viewing distance rather than slamming into it.
  useEffect(() => {
    if (!focusId) return
    const graph = graphRef.current
    const node = graphData.nodes.find((candidate) => candidate.id === focusId)
    if (!graph || !node) return

    const ratio = 1 + 150 / Math.max(1, Math.hypot(node.x, node.y, node.z))
    graph.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      node as never,
      900
    )
  }, [focusId, graphData])

  // The owner figure is scenery, not a target: it has no history to open and flying to it just
  // puts the camera inside a mesh. Clicks and hovers on it are both dropped.
  const handleClick = useCallback(
    (node: PlacedNode) => {
      if (node.kind === "user") return

      const graph = graphRef.current
      if (graph) {
        const ratio = 1 + 120 / Math.max(1, Math.hypot(node.x, node.y, node.z))
        graph.cameraPosition(
          { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
          node as never,
          900
        )
      }
      if (node.scope !== "suppressed") onSelect(node.id)
    },
    [onSelect]
  )

  /**
   * The owner figure, rebuilt only when its colour changes.
   *
   * This accessor replaces a node's rendering wholesale, so every *other* node has to opt out —
   * and opting out means returning nothing. `@types/three-forcegraph` declares the return as a
   * bare `Object3D`, but the implementation branches on truthiness (`if (customObj && …)`, else
   * build the default sphere), so the cast is describing what the library does rather than
   * defeating a check. Returning a real object here instead would mean hand-building 400 spheres.
   */
  const nodeThreeObject = useCallback(
    (node: PlacedNode) =>
      (node.kind === "user"
        ? buildPersonMesh(palette.user)
        : undefined) as unknown as Object3D,
    [palette.user]
  )

  return (
    <div ref={containerRef} className="size-full">
      {size.width > 0 && (
        <ForceGraph3D<PlacedNode, CanvasLink>
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor={palette.background}
          showNavInfo={false}
          nodeId="id"
          nodeRelSize={5}
          nodeVal={(node: PlacedNode) => node.weight}
          nodeColor={(node: PlacedNode) =>
            focused(node) ? colorFor(node, palette) : palette.dimmed
          }
          nodeVisibility={(node: PlacedNode) => visible(node)}
          nodeOpacity={0.95}
          nodeResolution={12}
          nodeThreeObject={nodeThreeObject}
          nodeLabel={(node: PlacedNode) => labelHtml(node, isDark)}
          linkColor={(link: CanvasLink) =>
            link.kind === "supersedes" ? palette.supersedes : palette.related
          }
          // Similarity is a matter of degree, so its lines carry their strength in their weight.
          // Supersession is not, so its line is one width.
          linkWidth={(link: CanvasLink) =>
            link.kind === "supersedes"
              ? 1.4
              : 0.3 + Math.max(0, (link.score ?? 0) - minimumScore) * 3
          }
          linkOpacity={0.5}
          linkVisibility={(link: CanvasLink) => {
            if (link.kind === "related" && (link.score ?? 0) < minimumScore)
              return false
            // The renderer swaps the string endpoints for node objects once it has resolved them,
            // so before that first pass there is nothing to check and the link is left visible.
            const ends = [link.source, link.target].map((end) =>
              typeof end === "object" ? (end as PlacedNode) : null
            )
            return ends.every((end) => !end || visible(end))
          }}
          // Only supersession is directional. An inferred similarity is symmetric — putting an
          // arrowhead on it would claim a direction the cosine does not have.
          linkDirectionalArrowLength={(link: CanvasLink) =>
            link.kind === "supersedes" ? 4 : 0
          }
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleClick}
          onNodeHover={(node: PlacedNode | null) =>
            setHoverId(node && node.kind !== "user" ? node.id : null)
          }
          enableNodeDrag
          // Nothing to simulate — every node is pinned to a computed position.
          warmupTicks={0}
          cooldownTicks={0}
        />
      )}
    </div>
  )
}

/** Hover card. Escaped by hand — `nodeLabel` injects this as raw HTML. */
function labelHtml(node: GraphNode, isDark: boolean): string {
  const surface = isDark ? "#1b1b17" : "#ffffff"
  const ink = isDark ? "#f2f2ec" : "#1a1a16"
  const muted = isDark ? "#9a9a8c" : "#6f6f60"

  const kind =
    node.kind === "user"
      ? "You"
      : node.scope === "suppressed"
        ? "Replaced"
        : node.category
          ? CATEGORY_LABEL[node.category]
          : "Uncategorised"

  const reach =
    node.kind === "user"
      ? ""
      : node.scope === "global"
        ? " · everywhere"
        : node.scope === "project"
          ? " · this project"
          : node.scope === "session"
            ? " · one conversation"
            : ""

  return `<div style="
    max-width:280px;padding:8px 10px;border-radius:12px;
    background:${surface};color:${ink};
    border:1px solid ${isDark ? "#2e2e26" : "#e6e6dd"};
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    font-family:inherit;font-size:12px;line-height:1.5">
    <div style="color:${muted};font-size:10px;text-transform:uppercase;letter-spacing:.05em">${escapeHtml(kind + reach)}</div>
    <div style="margin-top:3px">${escapeHtml(node.label)}</div>
  </div>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
