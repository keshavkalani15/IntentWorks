import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
} from "three"

/**
 * The owner, as a standing figure rather than a dot.
 *
 * Built from primitives rather than loaded as a model: a `.glb` would be a binary asset to host,
 * version and cache-bust, and at the size this renders — roughly a fifth of the inner shell's
 * radius — nobody can tell a rigged mesh from four capsules and a sphere.
 *
 * `MeshLambertMaterial` rather than `MeshBasicMaterial` because the scene does carry lights
 * (3d-force-graph installs an ambient and a directional light of its own), and without shading a
 * figure at this scale reads as a flat silhouette — which defeats the point of making it 3D.
 *
 * Sized to span roughly ±20 units so the whole figure sits inside the innermost shell at 110.
 */
export function buildPersonMesh(color: string): Group {
  const group = new Group()
  const material = new MeshLambertMaterial({ color })

  const head = new Mesh(new SphereGeometry(5.5, 18, 14), material)
  head.position.y = 14.5

  const torso = new Mesh(new CapsuleGeometry(4.6, 9, 6, 14), material)
  torso.position.y = 1

  for (const side of [1, -1]) {
    const arm = new Mesh(new CapsuleGeometry(1.7, 7, 4, 10), material)
    arm.position.set(side * 5.8, 0.5, 0)
    // Angled out from the body so the silhouette does not read as a single block.
    arm.rotation.z = side * 0.22
    group.add(arm)

    const leg = new Mesh(new CapsuleGeometry(2.1, 8, 4, 10), material)
    leg.position.set(side * 2.4, -14, 0)
    group.add(leg)
  }

  group.add(head, torso)
  return group
}
