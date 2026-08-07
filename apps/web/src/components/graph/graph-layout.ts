import type { GraphLink, GraphNode } from "@workspace/shared"

import { SHELL_RADIUS } from "./graph-visuals"

/**
 * Deterministic placement.
 *
 * Every node gets an exact position computed from its own fields, and the simulation is then
 * told to leave it there. That is the point of the redesign: a force layout over this data had
 * nothing to solve — the payload is a three-level tree, so the sim always converged on the same
 * hub-and-spokes and `x/y/z` meant nothing but "wherever the springs finished". Computing
 * positions instead frees all three axes to carry information:
 *
 *   distance from the owner = reach   (which shell)
 *   direction              = source   (which sector of that shell)
 *
 * A second benefit is that the same graph looks the same every time you open it, so spatial
 * memory actually works between sessions. A settling simulation cannot promise that.
 */

export interface Point {
  x: number
  y: number
  z: number
}

/** The Vogel/sunflower angle — successive multiples never fall into visible rows. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const GOLDEN_FRACTION = 0.6180339887

/** How far outside its replacement a tombstone is parked. */
const TOMBSTONE_OFFSET = 70

/**
 * Slot capacity for `count` items, floored at 16.
 *
 * Positions depend on the total, so a naive `index / count` would nudge every node whenever one
 * was added. Rounding up to a power of two means positions only rebalance when the count crosses
 * a doubling, and the floor of 16 keeps a handful of memories spread across the whole sphere
 * rather than crowded into one patch of it.
 */
function capacityFor(count: number): { capacity: number; bits: number } {
  let bits = 4
  while (1 << bits < count) bits++
  return { capacity: 1 << bits, bits }
}

/**
 * Bit-reversal (van der Corput) permutation of the slot order.
 *
 * Fibonacci slots walk one pole to the other in order, so filling them sequentially would stack
 * the first few nodes at the top. Reversing the index bits scatters early arrivals across the
 * full range — 0, 1, 2, 3 become 0, 8, 4, 12 — so four memories look evenly spread and stay put
 * as more arrive.
 */
function bitReverse(value: number, bits: number): number {
  let out = 0
  for (let bit = 0; bit < bits; bit++) {
    out = (out << 1) | ((value >> bit) & 1)
  }
  return out
}

/** Evenly spaced directions on the unit sphere. */
function fibonacciDirection(slot: number, capacity: number): Point {
  const y = capacity === 1 ? 0 : 1 - (slot / (capacity - 1)) * 2
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE * slot
  return { x: Math.cos(theta) * ring, y, z: Math.sin(theta) * ring }
}

function scale(point: Point, by: number): Point {
  return { x: point.x * by, y: point.y * by, z: point.z * by }
}

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y, point.z)
  return length === 0 ? { x: 0, y: 1, z: 0 } : scale(point, 1 / length)
}

function cross(a: Point, b: Point): Point {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

/** Two unit vectors perpendicular to `axis`, for spreading members around it. */
function basisAround(axis: Point): [Point, Point] {
  // Any helper that is not near-parallel to the axis; otherwise the cross product collapses.
  const helper: Point =
    Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u = normalize(cross(helper, axis))
  return [u, cross(axis, u)]
}

function fract(value: number): number {
  return value - Math.floor(value)
}

/** Unsigned angle between two unit vectors, in radians. */
function angleBetween(a: Point, b: Point): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

/**
 * Half-angle of a sector, measured from the axes actually in use.
 *
 * Deriving this from the group *count* was wrong: the axes are drawn from a power-of-two lattice
 * and permuted, so their real spacing has little to do with n. Three groups on a 16-slot lattice
 * land 92° apart, but `sqrt(4π/3)` predicts 117° and sized the cones wide enough to overlap their
 * neighbours — sectors that touch are sectors you cannot tell apart.
 *
 * Two cones θ apart stay disjoint while `2φ < θ`, so φ = 0.35θ guarantees a gutter of 30% of the
 * spacing whatever the count. A lone group has nothing to collide with and spreads broadly.
 */
function halfAngleFor(axes: Point[]): number {
  if (axes.length < 2) return 0.85

  let closest = Math.PI
  for (let i = 0; i < axes.length; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      closest = Math.min(closest, angleBetween(axes[i]!, axes[j]!))
    }
  }
  return Math.min(0.85, closest * 0.35)
}

/**
 * Position every node.
 *
 * Placement always runs over the *complete* node set, never a filtered one — the client hides
 * nodes with `nodeVisibility` rather than removing them, so that changing a filter cannot
 * reshuffle the scene and throw away the arrangement the user had just learned.
 */
export function placeNodes(
  nodes: GraphNode[],
  links: GraphLink[]
): Map<string, Point> {
  const positions = new Map<string, Point>()

  const memories = nodes.filter((node) => node.kind === "memory")
  const live = memories.filter((node) => node.scope !== "suppressed")
  const tombstones = memories.filter((node) => node.scope === "suppressed")

  positions.set("user", { x: 0, y: 0, z: 0 })

  // Oldest first, so a new memory takes the next free slot instead of displacing everything
  // written before it. Ties break on id to keep this a total order.
  const byAge = (a: GraphNode, b: GraphNode) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id)

  // One bucket per shell, subdivided by source. The `null` key holds a shell's ungrouped
  // memories — every global one, plus any row whose owning project or context is missing.
  const shells = new Map<string, Map<string | null, GraphNode[]>>()
  for (const node of [...live].sort(byAge)) {
    const scope = node.scope ?? "global"
    const sectors = shells.get(scope) ?? new Map<string | null, GraphNode[]>()
    const bucket = sectors.get(node.group) ?? []
    bucket.push(node)
    sectors.set(node.group, bucket)
    shells.set(scope, sectors)
  }

  for (const [scope, sectors] of shells) {
    const shellRadius =
      SHELL_RADIUS[scope as keyof typeof SHELL_RADIUS] ?? SHELL_RADIUS.global

    // Sorted so a shell's sectors keep their directions as memories come and go.
    const groupIds = [...sectors.keys()]
      .filter((id): id is string => id !== null)
      .sort((a, b) => a.localeCompare(b))

    // Resolve every sector's axis up front: the cone width depends on how close the closest pair
    // of them ends up, which is not knowable from the count alone.
    const lattice = capacityFor(groupIds.length)
    const axes = new Map<string, Point>(
      groupIds.map((id, index) => [
        id,
        fibonacciDirection(bitReverse(index, lattice.bits), lattice.capacity),
      ])
    )
    const halfAngle = halfAngleFor([...axes.values()])

    for (const [groupId, members] of sectors) {
      const { capacity, bits } = capacityFor(members.length)

      // Ungrouped memories spread over the entire shell; grouped ones stay inside their cone.
      const axis = groupId === null ? null : (axes.get(groupId) ?? null)
      const basis = axis ? basisAround(axis) : null

      members.forEach((node, index) => {
        const slot = bitReverse(index, bits)
        let direction: Point

        if (axis && basis) {
          // Area-uniform radius inside the cone, so members do not pile up at its centre.
          const reach = Math.tan(halfAngle) * Math.sqrt((slot + 0.5) / capacity)
          const angle = GOLDEN_ANGLE * slot
          const [u, v] = basis
          direction = normalize({
            x: axis.x + (u.x * Math.cos(angle) + v.x * Math.sin(angle)) * reach,
            y: axis.y + (u.y * Math.cos(angle) + v.y * Math.sin(angle)) * reach,
            z: axis.z + (u.z * Math.cos(angle) + v.z * Math.sin(angle)) * reach,
          })
        } else {
          direction = fibonacciDirection(slot, capacity)
        }

        // Thickness. Without it a sector is a flat patch on the sphere and reads as a disc.
        const radius =
          shellRadius * (0.93 + 0.14 * fract(slot * GOLDEN_FRACTION))
        positions.set(node.id, scale(direction, radius))
      })
    }
  }

  // A replaced memory is parked just outside whatever replaced it, on the same ray. That puts it
  // off every shell — it is in scope nowhere — and points its arrow straight back down the radius.
  const replacementOf = new Map(links.map((link) => [link.source, link.target]))
  const orphans: GraphNode[] = []

  for (const tombstone of [...tombstones].sort(byAge)) {
    const target = replacementOf.get(tombstone.id)
    const at = target ? positions.get(target) : undefined
    if (!at) {
      orphans.push(tombstone)
      continue
    }

    const distance = Math.hypot(at.x, at.y, at.z)
    positions.set(
      tombstone.id,
      scale(
        normalize(at),
        Math.min(SHELL_RADIUS.suppressed, distance + TOMBSTONE_OFFSET)
      )
    )
  }

  // Nothing to point at — the API only emits an edge when the replacement is present, so this is
  // just belt and braces. Park them on the outermost radius rather than dropping them at origin.
  const { capacity, bits } = capacityFor(orphans.length)
  orphans.forEach((node, index) => {
    const slot = bitReverse(index, bits)
    positions.set(
      node.id,
      scale(fibonacciDirection(slot, capacity), SHELL_RADIUS.suppressed)
    )
  })

  return positions
}
