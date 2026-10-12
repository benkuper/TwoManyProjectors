import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  aimRotation,
  constrainShift,
  footprint,
  pixelFootprint,
  projectionEnvelope,
  projectorCamera,
  scaleAroundAnchor
} from '../src/lib/optics'
import { customSpec, catalogue } from '../src/lib/catalogue'
import { identity, type ProjectorConfig } from '../src/lib/types'
import { estimateNormals } from '../src/lib/normal-worker'

const projector = (): ProjectorConfig => ({
  id: 'p',
  name: 'Fixture',
  spec: structuredClone(customSpec),
  transform: { ...identity(), position: [0, 0, 6] },
  enabled: true,
  locked: false,
  throwRatio: 1,
  shift: [0, 0],
  multiplier: 1,
  pattern: 'white',
  nativePixelPreview: false,
  patternCellSize: 120,
  imageFit: 'contain',
  color: '#ffffff',
  showOutline: true,
  showVolume: true,
  volumeOpacity: 0.05,
  extent: 100
})
describe('native optics and photometry', () => {
  it('covers 6 × 3.75 metres at 6m, TR 1, 16:10', () =>
    expect(footprint(projector(), 6)).toEqual({ width: 6, height: 3.75 }))
  it('computes 266.7 lux without redistributing missed light', () => {
    const p = projector(),
      a = pixelFootprint(p, new Vector3(), new Vector3(0, 0, 1))!
    expect(a.lux).toBeCloseTo(266.666666, 5)
    expect(a.distortion).toBeCloseTo(1)
    expect(a.density).toEqual([320, 320])
    p.transform.position[2] = 12
    expect(pixelFootprint(p, new Vector3(), new Vector3(0, 0, 1))!.lux).toBeCloseTo(a.lux / 4)
    p.multiplier = 2
    expect(pixelFootprint(p, new Vector3(), new Vector3(0, 0, 1))!.lux).toBeCloseTo(a.lux / 2)
  })
  it('increases footprint anisotropy on oblique surfaces', () => {
    const s = pixelFootprint(projector(), new Vector3(), new Vector3(0.8660254, 0, 0.5))!
    expect(s.distortion).toBeCloseTo(2)
    expect(s.lux).toBeCloseTo(133.333333, 3)
  })
  it('matches shifted camera UV and rotated optics', () => {
    const p = projector()
    p.shift = [0.2, -0.1]
    p.transform.rotation = new Quaternion().setFromEuler(new Euler(0.15, 0.3, 0)).toArray()
    const camera = projectorCamera(p),
      point = new Vector3(0.25, -0.4, 0).unproject(camera),
      normal = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion),
      sample = pixelFootprint(p, point, normal)!
    expect(sample.uv[0]).toBeCloseTo(0.625)
    expect(sample.uv[1]).toBeCloseTo(0.3)
  })
  it('rejects points outside the asymmetric native image or behind the lens', () => {
    const p = projector()
    expect(pixelFootprint(p, new Vector3(4, 0, 0), new Vector3(0, 0, 1))).toBeNull()
    expect(pixelFootprint(p, new Vector3(0, 0, 7), new Vector3(0, 0, 1))).toBeNull()
  })
  it('enforces manufacturer polygons rather than simultaneous maxima', () => {
    const p = projector()
    p.spec = catalogue[0]
    expect(constrainShift(p, [0.3, 0.67])[0]).toBeLessThan(0.3)
    expect(constrainShift(p, [0.3, 0.19])).toEqual([0.3, 0.19])
    p.spec = catalogue[2]
    expect(constrainShift(p, [-0.3, -0.5])[0]).toBeGreaterThanOrEqual(-0.1)
    expect(constrainShift(p, [0.1, 0.5])).toEqual([0.1, 0.5])
  })
  it('uses the EB-PU2220B standard and short-lens shift envelopes', () => {
    const p = projector()
    p.spec = catalogue.find((s) => s.model === 'EB-PU2220B' && s.lens === 'ELPLM15')!
    expect(constrainShift(p, [0.18, 0.32])).toEqual([0.18, 0.32])
    expect(constrainShift(p, [0, 0.6])[1]).toBeCloseTo(0.6, 12)
    expect(constrainShift(p, [0.18, 0.6])[0]).toBeLessThan(0.18)
    p.spec = catalogue.find((s) => s.model === 'EB-PU2220B' && s.lens === 'ELPLU03S')!
    expect(constrainShift(p, [0.1, 0])).toEqual([0.1, 0])
    expect(constrainShift(p, [0, 0.24])).toEqual([0, 0.24])
    expect(constrainShift(p, [0.1, 0.24])).toEqual([0.05, 0.12])
  })
  it('aims local negative Z at target', () => {
    const q = new Quaternion().fromArray(aimRotation([1, 2, 3], [0, 0, 0]))
    expect(
      new Vector3(0, 0, -1).applyQuaternion(q).distanceTo(new Vector3(-1, -2, -3).normalize())
    ).toBeLessThan(1e-10)
  })
})
describe('lens-shift reach', () => {
  const normalizedEnvelope = (p: ProjectorConfig) => {
    const { width, height } = footprint(p, p.extent)
    return projectionEnvelope(p).map((v) => [v.x / width, v.y / height])
  }
  const contains = (boundary: number[][], point: number[]) =>
    boundary.every((a, i) => {
      const b = boundary[(i + 1) % boundary.length]
      return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= -1e-10
    })

  it('includes every shifted image while excluding impossible combined diamond extremes', () => {
    const p = projector(),
      boundary = normalizedEnvelope(p)
    expect(boundary).toHaveLength(8)
    expect(contains(boundary, [1, 1])).toBe(false)
    expect(contains(boundary, [1, 0.5])).toBe(true)
    for (let x = -0.5; x <= 0.5; x += 0.1)
      for (let y = -0.5; y <= 0.5; y += 0.1) {
        const shift = constrainShift(p, [x, y])
        for (const dx of [-0.5, 0.5])
          for (const dy of [-0.5, 0.5])
            expect(contains(boundary, [shift[0] + dx, shift[1] + dy])).toBe(true)
      }
    const original = projectionEnvelope(p)
    p.shift = [0.25, -0.2]
    expect(projectionEnvelope(p)).toEqual(original)
  })

  it('respects asymmetric manufacturer limits and their combined-shift boundaries', () => {
    for (const spec of [catalogue[0], catalogue[2]]) {
      const p = projector()
      p.spec = structuredClone(spec)
      const boundary = normalizedEnvelope(p)
      // Compare directional reach against the published polygon plus the
      // half-image size, including diagonal directions that expose cut corners.
      for (let i = 0; i < 72; i++) {
        const dx = Math.cos((i * Math.PI) / 36),
          dy = Math.sin((i * Math.PI) / 36)
        const reach = Math.max(...boundary.map(([x, y]) => x * dx + y * dy))
        const shiftReach = Math.max(...spec.shift.polygon!.map(([x, y]) => x * dx + y * dy))
        expect(reach).toBeCloseTo(shiftReach + (Math.abs(dx) + Math.abs(dy)) / 2, 10)
      }
    }
    const p = projector()
    p.spec = structuredClone(catalogue[2])
    const boundary = normalizedEnvelope(p)
    expect(Math.min(...boundary.map(([x]) => x))).toBeCloseTo(-0.6)
    expect(Math.max(...boundary.map(([, y]) => y))).toBeCloseTo(1)
    expect(Math.min(...boundary.map(([, y]) => y))).toBeCloseTo(-0.66)
  })

  it('supports rectangular, elliptical, and zero-axis shift ranges', () => {
    const p = projector()
    p.spec.shift.coupled = 'rectangle'
    expect(normalizedEnvelope(p)).toEqual([
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ])
    p.spec.shift.coupled = 'ellipse'
    const boundary = normalizedEnvelope(p)
    expect(contains(boundary, [1, 1])).toBe(false)
    for (let i = 0; i < 100; i++) {
      const dx = Math.cos(i),
        dy = Math.sin(i)
      const reach = Math.max(...boundary.map(([x, y]) => x * dx + y * dy))
      expect(reach).toBeCloseTo(0.5 + (Math.abs(dx) + Math.abs(dy)) / 2, 3)
    }
    p.spec.shift.horizontal = 0
    expect(normalizedEnvelope(p)).toEqual([
      [-0.5, -1],
      [0.5, -1],
      [0.5, 1],
      [-0.5, 1]
    ])
    p.spec.shift.vertical = 0
    expect(normalizedEnvelope(p)).toEqual([
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5]
    ])
  })

  it('clips polygons to independent limits and scales the local boundary with optics', () => {
    const p = projector()
    p.spec.shift = {
      horizontal: 0.25,
      vertical: 0.4,
      coupled: 'rectangle',
      note: '',
      polygon: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ]
    }
    const boundary = normalizedEnvelope(p)
    expect(Math.max(...boundary.map(([x]) => x))).toBeCloseTo(0.75)
    expect(Math.max(...boundary.map(([, y]) => y))).toBeCloseTo(0.9)
    const original = projectionEnvelope(p, 6)
    p.throwRatio = 2
    p.transform.position = [10, -4, 5]
    p.transform.rotation = new Quaternion().setFromEuler(new Euler(0.2, 0.8, -0.3)).toArray()
    projectionEnvelope(p, 12).forEach((point, i) => {
      expect(point.x).toBeCloseTo(original[i].x)
      expect(point.y).toBeCloseTo(original[i].y)
      expect(point.z).toBe(-12)
    })
  })
})
describe('anchored calibration', () => {
  it('preserves the first world point after existing scale and rotation', () => {
    const t = {
        position: [3, 2, 1] as [number, number, number],
        rotation: new Quaternion().setFromEuler(new Euler(0.3, 0.8, 0.4)).toArray(),
        scale: [2, 3, 4] as [number, number, number]
      },
      local = new Vector3(0.5, 0.4, 0.3),
      anchor = local
        .clone()
        .multiply(new Vector3().fromArray(t.scale))
        .applyQuaternion(new Quaternion().fromArray(t.rotation))
        .add(new Vector3().fromArray(t.position)),
      result = scaleAroundAnchor(
        t,
        anchor.toArray(),
        anchor
          .clone()
          .add(new Vector3(2, 0, 0))
          .toArray(),
        5
      ),
      after = local
        .clone()
        .multiply(new Vector3().fromArray(result.scale))
        .applyQuaternion(new Quaternion().fromArray(result.rotation))
        .add(new Vector3().fromArray(result.position))
    expect(after.distanceTo(anchor)).toBeLessThan(1e-10)
    expect(result.rotation).toEqual(t.rotation)
    expect(result.scale).toEqual([5, 7.5, 10])
  })
  it('rejects coincident picks and invalid distance', () => {
    expect(() => scaleAroundAnchor(identity(), [0, 0, 0], [0, 0, 0], 2)).toThrow()
    expect(() => scaleAroundAnchor(identity(), [0, 0, 0], [1, 0, 0], NaN)).toThrow()
    expect(() => scaleAroundAnchor(identity(), [0, 0, 0], [1, 0, 0], -1)).toThrow()
  })
})
describe('scan normals', () => {
  it('estimates planar PCA normals and gates sparse points', () => {
    const p: number[] = []
    for (let x = 0; x < 12; x++) for (let y = 0; y < 12; y++) p.push(x * 0.1, y * 0.1, 0)
    const result = estimateNormals(new Float32Array(p)),
      center = 6 * 12 + 6
    expect(result.confidence[center]).toBe(1)
    expect(Math.abs(result.normals[center * 3 + 2])).toBeCloseTo(1)
    expect(estimateNormals(new Float32Array([0, 0, 0, 1, 0, 0])).confidence).toEqual(
      new Float32Array([0, 0])
    )
  })
})
