import { describe, expect, it } from 'vitest'
import { Euler, Quaternion } from 'three'
import { projectorHeight, heightText, heightRelation } from '../src/lib/height-measurement'
import { sampleDocument } from '../src/lib/store'
import { validateDocument } from '../src/lib/persistence'

describe('projector height dimensions', () => {
  it('measures vertical height to Y=0 or an offset surface point, independently of horizontal distance', () => {
    const doc = sampleDocument(),
      p = doc.projectors[0],
      node = doc.nodes[2]
    expect(projectorHeight(p, doc.nodes)?.height).toBe(2.2)
    p.heightMeasurement = { visible: true, reference: { nodeId: node.id, point: [0, 0.45, 0] } }
    const height = projectorHeight(p, doc.nodes)!
    expect(height.height).toBeCloseTo(1.3)
    expect(height.base.toArray()).toEqual([0, 0.9, 6])
    expect(height.point!.toArray()).toEqual([2.2, 0.9, 1.4])
    expect(height.referenceName).toBe('Test plinth')
    node.transform.position[0] = 100
    expect(projectorHeight(p, doc.nodes)?.height).toBeCloseTo(1.3)
  })

  it('follows receiver translation, rotation, and scale in world space', () => {
    const doc = sampleDocument(),
      p = doc.projectors[0],
      node = doc.nodes[2]
    p.heightMeasurement = { visible: true, reference: { nodeId: node.id, point: [1, 0, 0] } }
    node.transform.position = [5, 1, 8]
    node.transform.scale = [2, 3, 4]
    node.transform.rotation = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)).toArray()
    const measurement = projectorHeight(p, doc.nodes)!
    expect(measurement.point!.y).toBeCloseTo(3)
    expect(measurement.height).toBeCloseTo(-0.8)
    expect(heightText(measurement.height)).toBe('0.80 m')
    expect(heightRelation(measurement.height)).toBe('below')
    expect(heightText(0)).toBe('0.00 m')
  })

  it('does not silently fall back to ground when the reference receiver is deleted', () => {
    const doc = sampleDocument(),
      p = doc.projectors[0]
    p.heightMeasurement = { visible: true, reference: { nodeId: 'deleted', point: [0, 1, 0] } }
    expect(projectorHeight(p, doc.nodes)).toBeNull()
    expect(validateDocument(structuredClone(doc))).toEqual(doc)
  })

  it('supports old projects and round-trips measurements in active and inactive projector versions', () => {
    const doc = sampleDocument()
    expect(validateDocument(structuredClone(doc)).projectors[0].heightMeasurement).toBeUndefined()
    doc.projectors[0].heightMeasurement = {
      visible: true,
      reference: { nodeId: doc.nodes[2].id, point: [0, 0.45, 0] }
    }
    doc.projectorVersions!.items.push({
      id: 'alternative',
      name: 'Alternative',
      projectors: structuredClone(doc.projectors)
    })
    doc.projectorVersions!.items[1].projectors![0].heightMeasurement!.visible = false
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('rejects malformed measurement settings in every projector version', () => {
    for (const invalid of [
      null,
      true,
      {},
      { visible: 1, reference: null },
      { visible: true },
      { visible: true, reference: { nodeId: '', point: [0, 1, 0] } },
      { visible: true, reference: { nodeId: 'receiver', point: [0, NaN, 0] } },
      { visible: true, reference: { nodeId: 'receiver', point: [0, 1] } }
    ]) {
      for (const inactive of [false, true]) {
        const doc = sampleDocument(),
          projectors = structuredClone(doc.projectors)
        Object.assign(projectors[0], { heightMeasurement: invalid })
        if (inactive) doc.projectorVersions!.items.push({ id: 'other', name: 'Other', projectors })
        else doc.projectors = projectors
        expect(() => validateDocument(doc)).toThrow('invalid projector height measurement')
      }
    }
  })
})
