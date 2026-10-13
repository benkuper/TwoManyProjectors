import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  beginEdit,
  editObject,
  editor,
  makeNode,
  makeProjector,
  redo,
  removeAsset,
  replaceDocument,
  sampleDocument,
  setSelection,
  undo,
  updateUI
} from '../src/lib/store'
import { validateDocument } from '../src/lib/persistence'
import { identity, type AssetRecord } from '../src/lib/types'

function asset(id: string, kind: AssetRecord['kind'] = 'mesh'): AssetRecord {
  const name = `${id}.${kind === 'image' ? 'png' : 'glb'}`
  const primary = `assets/${id}/${name}`
  return {
    id,
    name,
    kind,
    primary,
    files: [primary],
    units: 'm',
    upAxis: 'y',
    normals: 'unavailable',
    originalBytes: 100
  }
}

beforeEach(() => replaceDocument(sampleDocument()))

describe('asset removal', () => {
  it('removes all scene copies, reconciles selection, and restores everything with one undo', () => {
    const doc = sampleDocument()
    doc.assets = [asset('remove'), asset('keep')]
    const copies = [makeNode('mesh'), makeNode('mesh')]
    copies.forEach((node) => (node.assetId = 'remove'))
    copies[0].visible = false
    doc.nodes.push(...copies)
    replaceDocument(doc)
    setSelection([doc.nodes[0].id, copies[1].id])
    updateUI({ calibration: [[0, 0, 0]], calibrationPreview: identity() })

    removeAsset('remove')
    const removed = get(editor)
    expect(removed.doc.assets).toEqual([doc.assets[1]])
    expect(removed.doc.nodes).toEqual(doc.nodes.slice(0, 3))
    expect(removed.selectedIds).toEqual([doc.nodes[0].id])
    expect(removed.selected).toBe(doc.nodes[0].id)
    expect(removed.calibration).toEqual([])
    expect(removed.calibrationPreview).toBeNull()
    expect(validateDocument(structuredClone(removed.doc))).toEqual(removed.doc)
    undo()
    expect(get(editor).doc).toEqual(doc)
    expect(get(editor).canUndo).toBe(false)
    redo()
    expect(get(editor).doc).toEqual(removed.doc)
  })

  it('clears image references in every version and only resets projectors displaying that image', () => {
    const doc = sampleDocument()
    doc.assets = [asset('remove', 'image'), asset('keep', 'image')]
    const active = doc.projectors[0]
    active.imageId = 'remove'
    active.pattern = 'image'
    const inactive = structuredClone(active)
    inactive.pattern = 'white'
    const other = makeProjector()
    other.imageId = 'keep'
    other.pattern = 'image'
    doc.projectorVersions!.items.push({
      id: 'alternative',
      name: 'Alternative',
      projectors: [inactive, other]
    })
    replaceDocument(doc)

    removeAsset('remove')
    const removed = get(editor).doc
    expect(removed.projectors[0].imageId).toBeUndefined()
    expect(removed.projectors[0].pattern).toBe('grid')
    expect(removed.projectorVersions!.items[1].projectors![0].imageId).toBeUndefined()
    expect(removed.projectorVersions!.items[1].projectors![0].pattern).toBe('white')
    expect(removed.projectorVersions!.items[1].projectors![1]).toEqual(other)
    expect(validateDocument(structuredClone(removed))).toEqual(removed)
    undo()
    expect(get(editor).doc).toEqual(doc)
    redo()
    expect(get(editor).doc).toEqual(removed)
  })

  it('clears shared surface textures without deleting meshes and restores them with undo', () => {
    const doc = sampleDocument()
    doc.assets = [asset('texture', 'image')]
    doc.nodes[0].textureId = 'texture'
    doc.nodes[1].textureId = 'texture'
    replaceDocument(doc)
    removeAsset('texture')
    const removed = get(editor).doc
    expect(removed.nodes).toHaveLength(doc.nodes.length)
    expect(removed.nodes.every((node) => node.textureId === undefined)).toBe(true)
    expect(validateDocument(structuredClone(removed))).toEqual(removed)
    undo()
    expect(get(editor).doc).toEqual(doc)
    redo()
    expect(get(editor).doc).toEqual(removed)
  })

  it.each(['receiver', 'textured receiver', 'active projector', 'inactive projector'])(
    'preserves assets used by a locked %s',
    (usage) => {
      const doc = sampleDocument()
      doc.assets = [asset('locked', usage === 'receiver' ? 'mesh' : 'image')]
      if (usage === 'receiver' || usage === 'textured receiver') {
        if (usage === 'receiver') doc.nodes[0].assetId = 'locked'
        else doc.nodes[0].textureId = 'locked'
        doc.nodes[0].locked = true
      } else {
        const p = usage === 'active projector' ? doc.projectors[0] : makeProjector()
        p.imageId = 'locked'
        p.locked = true
        if (usage === 'inactive projector')
          doc.projectorVersions!.items.push({ id: 'other', name: 'Other', projectors: [p] })
      }
      replaceDocument(doc)
      removeAsset('locked')
      expect(get(editor).doc).toBe(doc)
      expect(get(editor).canUndo).toBe(false)
      expect(get(editor).notice).toContain('is locked. Unlock it')
    }
  )

  it('finishes pending edits so removing an unused asset is a separate undo step', () => {
    const doc = sampleDocument()
    doc.assets = [asset('unused')]
    replaceDocument(doc)
    beginEdit()
    editObject(doc.nodes[0].id, { name: 'Edited screen' })
    removeAsset('unused')
    expect(get(editor).doc.assets).toEqual([])
    undo()
    expect(get(editor).doc.assets).toEqual(doc.assets)
    expect(get(editor).doc.nodes[0].name).toBe('Edited screen')
    undo()
    expect(get(editor).doc).toEqual(doc)
  })

  it('ignores an asset that is already absent without recording a command', () => {
    const before = get(editor)
    removeAsset('missing')
    expect(get(editor)).toBe(before)
  })
})
