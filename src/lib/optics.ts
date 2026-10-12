import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { ProjectorConfig, Transform, Vec3 } from './types'

export function projectorCamera(p: ProjectorConfig) {
  const camera = new PerspectiveCamera(
    50,
    p.spec.resolution[0] / p.spec.resolution[1],
    0.02,
    p.extent
  )
  camera.position.fromArray(p.transform.position)
  camera.quaternion.fromArray(p.transform.rotation)
  const n = camera.near,
    halfW = n / (2 * p.throwRatio),
    halfH = halfW / camera.aspect
  const cx = 2 * halfW * p.shift[0],
    cy = 2 * halfH * p.shift[1]
  camera.projectionMatrix.makePerspective(
    -halfW + cx,
    halfW + cx,
    halfH + cy,
    -halfH + cy,
    n,
    camera.far
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  camera.updateMatrixWorld(true)
  return camera
}
export function footprint(p: ProjectorConfig, distance: number) {
  const width = distance / p.throwRatio
  return { width, height: (width * p.spec.resolution[1]) / p.spec.resolution[0] }
}

type Point2 = [number, number]

function shiftBoundary(p: ProjectorConfig): Point2[] {
  const { horizontal: h, vertical: v, polygon, coupled } = p.spec.shift
  const rectangle: Point2[] = [
    [-h, -v],
    [h, -v],
    [h, v],
    [-h, v]
  ]
  if (polygon?.length) {
    // Intersect the manufacturer polygon with the independent axis limits,
    // matching constrainShift even for imported specifications.
    let boundary: Point2[] = polygon.map(([x, y]) => [x, y])
    for (const [axis, sign, limit] of [
      [0, -1, h],
      [0, 1, h],
      [1, -1, v],
      [1, 1, v]
    ]) {
      const clipped: Point2[] = []
      for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i],
          b = boundary[(i + 1) % boundary.length]
        const da = sign * a[axis] - limit,
          db = sign * b[axis] - limit
        const aInside = da <= 0,
          bInside = db <= 0
        if (aInside) clipped.push(a)
        if (aInside !== bInside) {
          const t = da / (da - db)
          clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
        }
      }
      boundary = clipped
    }
    return boundary
  }
  if (coupled === 'diamond')
    return [
      [-h, 0],
      [0, -v],
      [h, 0],
      [0, v]
    ]
  if (coupled === 'ellipse')
    return Array.from({ length: 128 }, (_, i) => {
      const angle = (i * Math.PI * 2) / 128
      return [h * Math.cos(angle), v * Math.sin(angle)]
    })
  return rectangle
}

function convexHull(points: Point2[]): Point2[] {
  const sorted = points
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1])
  const cross = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (vertices: Point2[]) => {
    const hull: Point2[] = []
    for (const point of vertices) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 1e-12
      )
        hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** Local-space boundary of every image position reachable by lens shift. */
export function projectionEnvelope(p: ProjectorConfig, distance = p.extent): Vector3[] {
  const { width, height } = footprint(p, distance)
  const image: Point2[] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5]
  ]
  // The union of translated images is the Minkowski sum of the allowed
  // shift region and the native image rectangle, not the axis-aligned bounds.
  const points = shiftBoundary(p).flatMap(([x, y]) =>
    image.map(([dx, dy]): Point2 => [x + dx, y + dy])
  )
  return convexHull(points).map(([x, y]) => new Vector3(x * width, y * height, -distance))
}

export function constrainShift(p: ProjectorConfig, shift: [number, number]): [number, number] {
  const spec = p.spec.shift
  let x = Math.max(-spec.horizontal, Math.min(spec.horizontal, shift[0]))
  let y = Math.max(-spec.vertical, Math.min(spec.vertical, shift[1]))
  if (spec.polygon?.length) {
    // Clip the ray from neutral through the requested shift against a convex CCW polygon.
    let limit = 1
    for (let i = 0; i < spec.polygon.length; i++) {
      const a = spec.polygon[i],
        b = spec.polygon[(i + 1) % spec.polygon.length]
      const ex = b[0] - a[0],
        ey = b[1] - a[1]
      const atOrigin = ey * a[0] - ex * a[1],
        slope = ex * y - ey * x
      if (slope < 0) limit = Math.min(limit, atOrigin / -slope)
    }
    return [x * Math.max(0, limit), y * Math.max(0, limit)]
  }
  const nx = spec.horizontal ? Math.abs(x) / spec.horizontal : 0,
    ny = spec.vertical ? Math.abs(y) / spec.vertical : 0
  const sum =
    spec.coupled === 'diamond' ? nx + ny : spec.coupled === 'ellipse' ? Math.hypot(nx, ny) : 1
  if (sum > 1) {
    x /= sum
    y /= sum
  }
  return [x, y]
}
export function pixelFootprint(p: ProjectorConfig, point: Vector3, normal: Vector3) {
  const q = new Quaternion().fromArray(p.transform.rotation),
    origin = new Vector3().fromArray(p.transform.position)
  const right = new Vector3(1, 0, 0).applyQuaternion(q),
    up = new Vector3(0, 1, 0).applyQuaternion(q),
    forward = new Vector3(0, 0, -1).applyQuaternion(q)
  const delta = point.clone().sub(origin),
    d = delta.dot(forward)
  if (d <= 0.02 || d > p.extent || normal.lengthSq() < 0.5) return null
  const uv: [number, number] = [
    (delta.dot(right) / d) * p.throwRatio + 0.5 - p.shift[0],
    ((delta.dot(up) / d) * p.throwRatio * p.spec.resolution[0]) / p.spec.resolution[1] +
      0.5 -
      p.shift[1]
  ]
  if (uv.some((v) => v < 0 || v > 1)) return null
  const ray = delta.divideScalar(d),
    incidence = normal.dot(ray)
  if (Math.abs(incidence) < 1e-5) return null
  const step = 1 / (p.throwRatio * p.spec.resolution[0])
  const dx = right.multiplyScalar(step),
    dy = up.multiplyScalar(step)
  dx.addScaledVector(ray, -normal.dot(dx) / incidence).multiplyScalar(d)
  dy.addScaledVector(ray, -normal.dot(dy) / incidence).multiplyScalar(d)
  const area = new Vector3().crossVectors(dx, dy).length()
  const a = dx.lengthSq(),
    b = dy.lengthSq(),
    c = dx.dot(dy),
    disc = Math.sqrt((a - b) ** 2 + 4 * c * c)
  const largest = Math.sqrt((a + b + disc) / 2),
    smallest = Math.sqrt(Math.max(1e-20, (a + b - disc) / 2))
  return {
    uv,
    area,
    lux: (p.spec.lumens * p.multiplier) / (p.spec.resolution[0] * p.spec.resolution[1] * area),
    density: [1 / dx.length(), 1 / dy.length()] as [number, number],
    millimetresPerPixel: [dx.length() * 1000, dy.length() * 1000] as [number, number],
    distortion: largest / smallest
  }
}
export function scaleAroundAnchor(
  transform: Transform,
  firstWorld: Vec3,
  secondWorld: Vec3,
  realDistance: number
): Transform {
  const first = new Vector3().fromArray(firstWorld),
    second = new Vector3().fromArray(secondWorld)
  const measured = first.distanceTo(second)
  if (!Number.isFinite(realDistance) || realDistance <= 0 || measured < 1e-6)
    throw new Error('Pick two distinct points and enter a positive distance.')
  const ratio = realDistance / measured
  if (!Number.isFinite(ratio) || ratio < 1e-6 || ratio > 1e6)
    throw new Error('The scale factor is outside the supported range.')
  return {
    position: new Vector3()
      .fromArray(transform.position)
      .sub(first)
      .multiplyScalar(ratio)
      .add(first)
      .toArray() as Vec3,
    rotation: [...transform.rotation],
    scale: transform.scale.map((s) => s * ratio) as Vec3
  }
}
export function aimRotation(origin: Vec3, target: Vec3) {
  if (new Vector3().fromArray(origin).distanceToSquared(new Vector3().fromArray(target)) < 1e-10)
    throw new Error('Aim point is too close to the optical center.')
  return new Quaternion()
    .setFromRotationMatrix(
      new Matrix4().lookAt(
        new Vector3().fromArray(origin),
        new Vector3().fromArray(target),
        new Vector3(0, 1, 0)
      )
    )
    .toArray() as Transform['rotation']
}
