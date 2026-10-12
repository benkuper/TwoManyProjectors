import { describe, expect, it } from 'vitest'
import { sampleDocument } from '../src/lib/store'
import { validateDocument } from '../src/lib/persistence'
import { classifyPLY, binaryGaussianPLY } from '../src/lib/formats'
import { readFileSync } from 'node:fs'
import { catalogue, customSpec, makeCustomSpec, projectorForSpec } from '../src/lib/catalogue'
import { constrainShift } from '../src/lib/optics'

describe('versioned scene documents', () => {
  it('preserves per-object locks and defaults older documents to unlocked', () => {
    const doc = sampleDocument()
    doc.nodes[0].locked = true
    doc.projectors[0].locked = true
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    const legacy = JSON.parse(JSON.stringify(doc))
    for (const object of [...legacy.nodes, ...legacy.projectors]) delete object.locked
    const migrated = validateDocument(legacy)
    expect([...migrated.nodes, ...migrated.projectors].every((o) => o.locked === false)).toBe(true)
  })

  it('rejects malformed receiver and projector locks', () => {
    for (const collection of ['nodes', 'projectors'] as const)
      for (const locked of ['true', 1, null, {}]) {
        const doc = JSON.parse(JSON.stringify(sampleDocument()))
        doc[collection][0].locked = locked
        expect(() => validateDocument(doc)).toThrow('object lock')
      }
  })

  it('preserves Gaussian boosts and accepts older receivers without rendering options', () => {
    const doc = sampleDocument()
    doc.nodes[0].kind = 'splat'
    expect(validateDocument(structuredClone(doc))).toEqual(doc)
    doc.nodes[0].gaussian = { opacity: 2.5, size: 1.8 }
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    for (const gaussian of [
      { opacity: -1, size: 1 },
      { opacity: 5.1, size: 1 },
      { opacity: 1, size: 0 },
      { opacity: 1, size: 5.1 },
      { opacity: NaN, size: 1 },
      { opacity: 1, size: Infinity }
    ]) {
      const invalid = structuredClone(doc)
      invalid.nodes[0].gaussian = gaussian
      expect(() => validateDocument(invalid)).toThrow('Gaussian rendering')
    }
  })
  it('validates a complete sample and rejects unsupported versions', () => {
    const d = sampleDocument()
    expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
    expect(() => validateDocument({ ...d, version: 2 })).toThrow('unsupported')
  })
  it('migrates pattern preview options and preserves customized pixel settings', () => {
    const legacy = JSON.parse(JSON.stringify(sampleDocument()))
    delete legacy.projectors[0].nativePixelPreview
    delete legacy.projectors[0].patternCellSize
    const migrated = validateDocument(legacy)
    expect(migrated.projectors[0].nativePixelPreview).toBe(false)
    expect(migrated.projectors[0].patternCellSize).toBe(120)
    migrated.projectors[0].nativePixelPreview = true
    migrated.projectors[0].patternCellSize = 64
    expect(validateDocument(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated)
  })
  it('restores custom lens limits in older preset copies without changing native specifications', () => {
    const doc = sampleDocument(),
      p = doc.projectors[0]
    p.spec = { ...structuredClone(catalogue[0]), id: 'custom', verified: 'custom' }
    p.spec.lumens = 7200
    p.spec.resolution = [3840, 2160]
    p.throwRatio = 1.8
    p.shift = [0, 0.67]
    const migrated = validateDocument(doc).projectors[0]
    expect(migrated.spec.throwRange).toEqual(customSpec.throwRange)
    expect(migrated.spec.shift).toEqual(customSpec.shift)
    expect(migrated.spec.sources).toEqual([])
    expect(migrated.spec.lumens).toBe(7200)
    expect(migrated.spec.resolution).toEqual([3840, 2160])
    expect(migrated.throwRatio).toBe(1.8)
    expect(migrated.shift).toEqual(constrainShift(migrated, [0, 0.67]))
    expect(catalogue[0].throwRange).toEqual([1.44, 2.32])
    expect(catalogue[0].shift.polygon).toBeDefined()
  })
  it('reads existing body/lens snapshots without changing their saved optics', () => {
    const doc = sampleDocument()
    doc.projectors[0].spec = structuredClone(catalogue[4])
    doc.projectors[0].throwRatio = 3
    const before = structuredClone(doc)
    const loaded = validateDocument(JSON.parse(JSON.stringify(doc)))
    expect(loaded).toEqual(before)
    expect(projectorForSpec(loaded.projectors[0].spec)?.id).toBe('panasonic-pt-rz790')
    expect(loaded.projectors[0].spec.lens).toBe('ET-DLE250')
  })
  it('retains long-throw optics in custom copies and saves customized lens limits', () => {
    const doc = sampleDocument(),
      p = doc.projectors[0]
    const longLens = catalogue.find((s) => s.model === 'EB-PU1007B' && s.lens === 'ELPLL08')!
    p.spec = makeCustomSpec(longLens)
    p.throwRatio = 9
    expect(p.spec.throwRange).toEqual([0.3, 10.11])
    expect(p.spec.shift.polygon).toBeUndefined()
    p.spec.throwRange = [0.05, 14]
    p.spec.shift = { horizontal: 1.5, vertical: 2, coupled: 'rectangle', note: 'Custom limits' }
    p.shift = [1.2, 1.8]
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    expect(projectorForSpec(p.spec)).toBeUndefined()
  })
  it('rejects invalid native pixel preview and grid cell settings', () => {
    for (const size of [0, 7, 12.5, 4097, Infinity]) {
      const doc = sampleDocument()
      doc.projectors[0].patternCellSize = size
      expect(() => validateDocument(doc)).toThrow('invalid projector optics')
    }
    const doc = JSON.parse(JSON.stringify(sampleDocument()))
    doc.projectors[0].nativePixelPreview = 'true'
    expect(() => validateDocument(doc)).toThrow('invalid projector optics')
  })
  it('migrates legacy projector opacity to shared settings and rejects invalid opacity', () => {
    const legacy = JSON.parse(JSON.stringify(sampleDocument()))
    delete legacy.settings.volumeOpacity
    delete legacy.settings.outlineOpacity
    legacy.projectors[0].volumeOpacity = 0.12
    const migrated = validateDocument(legacy)
    expect(migrated.settings.volumeOpacity).toBe(0.12)
    expect(migrated.settings.outlineOpacity).toBe(0.32)
    migrated.settings.outlineOpacity = 1.1
    expect(() => validateDocument(migrated)).toThrow('frustum opacity')
  })
  it('rejects invalid transforms, duplicate IDs, missing assets, and excessive enabled projectors', () => {
    const d = sampleDocument()
    d.nodes[0].transform.position[0] = NaN
    expect(() => validateDocument(d)).toThrow('transform')
    const other = sampleDocument()
    other.nodes[0].id = other.nodes[1].id
    expect(() => validateDocument(other)).toThrow('duplicate')
    const missing = sampleDocument()
    missing.nodes[0].assetId = 'absent'
    expect(() => validateDocument(missing)).toThrow('asset')
    const excess = sampleDocument()
    excess.projectors = Array.from({ length: 9 }, (_, i) => ({
      ...structuredClone(excess.projectors[0]),
      id: `p-${i}`
    }))
    expect(() => validateDocument(excess)).toThrow('eight')
  })
})
describe('PLY disambiguation', () => {
  const bytes = (name: string) => {
    const buffer = readFileSync(`public/samples/${name}`)
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
  }
  it('distinguishes face meshes, point clouds and covariance splats', () => {
    expect(classifyPLY(bytes('mesh.ply'))).toBe('mesh')
    expect(classifyPLY(bytes('cloud.ply'))).toBe('cloud')
    expect(classifyPLY(bytes('gaussian.ply'))).toBe('splat')
  })
  it('normalizes ASCII Gaussian PLY while preserving covariance properties', () => {
    const output = binaryGaussianPLY(bytes('gaussian.ply')),
      text = new TextDecoder().decode(output.slice(0, 700))
    expect(text).toContain('format binary_little_endian 1.0')
    expect(text).toContain('property float scale_0')
    expect(classifyPLY(output)).toBe('splat')
  })
  it('passes binary Gaussian PLY through without copying or altering its payload', () => {
    const binary = binaryGaussianPLY(bytes('gaussian.ply'))
    expect(binaryGaussianPLY(binary)).toBe(binary)
  })
  it('rejects malformed and incomplete Gaussian properties', () => {
    expect(() => classifyPLY(bytes('malformed.ply'))).toThrow()
    expect(() =>
      classifyPLY(new TextEncoder().encode('ply\nproperty float scale_0\nend_header\n').buffer)
    ).toThrow('Incomplete')
  })
})
