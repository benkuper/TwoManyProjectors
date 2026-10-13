import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ProjectorConfig, SceneNode, Transform } from './types'

/** Height is a world-Y difference, never the slanted distance to the picked point. */
export function projectorHeight(
  projector: ProjectorConfig,
  nodes: SceneNode[],
  projectorTransform: Transform = projector.transform,
  referenceTransform?: Transform
) {
  const origin = new Vector3().fromArray(projectorTransform.position)
  const reference = projector.heightMeasurement?.reference
  let point: Vector3 | null = null
  let referenceName = 'Ground'
  if (reference) {
    const node = nodes.find((node) => node.id === reference.nodeId)
    // Keep the saved reference for undo, but never substitute an incorrect ground height.
    if (!node) return null
    const transform = referenceTransform ?? node.transform
    point = new Vector3()
      .fromArray(reference.point)
      .applyMatrix4(
        new Matrix4().compose(
          new Vector3().fromArray(transform.position),
          new Quaternion().fromArray(transform.rotation),
          new Vector3().fromArray(transform.scale)
        )
      )
    referenceName = node.name
  }
  const base = new Vector3(origin.x, point?.y ?? 0, origin.z)
  const height = origin.y - base.y
  return { origin, base, point, referenceName, height }
}

export function heightText(height: number) {
  return `${Math.abs(height).toFixed(2)} m`
}

export function heightRelation(height: number) {
  return height < -0.000001 ? 'below' : 'above'
}

export interface HeightOverlay {
  id: string
  name: string
  height: number
  referenceName: string
  origin: [number, number]
  base: [number, number]
  point: [number, number] | null
}
