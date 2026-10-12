import { Quaternion, Vector3 } from 'three'
import { identity, type Transform } from './types'

/** The shared pivot uses object origins, so helper volumes do not move its center. */
export function selectionPivot(transforms: Transform[]): Transform {
  const pivot = identity()
  if (transforms.length)
    for (let i = 0; i < 3; i++)
      pivot.position[i] = transforms.reduce((sum, t) => sum + t.position[i], 0) / transforms.length
  return pivot
}

/** Apply a shared translation, rotation and uniform scale without reparenting scene objects. */
export function transformSelection(
  original: Transform,
  from: Transform,
  to: Transform,
  scaleObject = true
): Transform {
  const rotation = new Quaternion()
    .fromArray(to.rotation)
    .multiply(new Quaternion().fromArray(from.rotation).invert())
  const factor = to.scale[0] / from.scale[0]
  return {
    position: new Vector3()
      .fromArray(original.position)
      .sub(new Vector3().fromArray(from.position))
      .multiplyScalar(factor)
      .applyQuaternion(rotation)
      .add(new Vector3().fromArray(to.position))
      .toArray(),
    rotation: rotation.multiply(new Quaternion().fromArray(original.rotation)).toArray(),
    scale: scaleObject
      ? (original.scale.map((v) => v * factor) as Transform['scale'])
      : [...original.scale]
  }
}
