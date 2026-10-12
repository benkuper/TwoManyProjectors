import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  editor,
  sampleDocument,
  replaceDocument,
  select,
  selectAll,
  setSelection,
  duplicateSelected,
  removeSelected,
  toggleObjectLock,
  editObject,
  updateUI,
  undo,
  redo
} from '../src/lib/store'
import { selectionPivot, transformSelection } from '../src/lib/selection-transform'
import { identity } from '../src/lib/types'

beforeEach(() => replaceDocument(sampleDocument()))

describe('multiple object selection', () => {
  it('toggles objects and keeps an active object until the selection is empty', () => {
    const { doc } = get(editor),
      projector = doc.projectors[0].id,
      node = doc.nodes[0].id
    select(node, { toggle: true })
    expect(get(editor).selectedIds).toEqual([projector, node])
    expect(get(editor).selected).toBe(node)
    select(node, { toggle: true })
    expect(get(editor).selected).toBe(projector)
    select(projector, { toggle: true })
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).selected).toBeNull()
  })

  it('selects ranges in tree order and keeps the anchor while extending or shrinking', () => {
    const ids = get(editor).doc.nodes.map((n) => n.id)
    select(ids[0])
    select(ids[2], { range: true })
    expect(get(editor).selectedIds).toEqual(ids)
    select(ids[1], { range: true })
    expect(get(editor).selectedIds).toEqual(ids.slice(0, 2))
    select(ids[2])
    select(ids[0], { range: true })
    expect(get(editor).selectedIds).toEqual(ids)
    expect(get(editor).selected).toBe(ids[0])
  })

  it('adds a range with Ctrl+Shift and replaces the selection on an ordinary click', () => {
    const { doc } = get(editor),
      ids = doc.nodes.map((n) => n.id),
      projector = doc.projectors[0].id
    select(ids[0], { toggle: true })
    select(ids[2], { toggle: true, range: true })
    expect(get(editor).selectedIds).toEqual([projector, ...ids])
    select(ids[1])
    expect(get(editor).selectedIds).toEqual([ids[1]])
  })

  it('ignores missing IDs and modified empty clicks, and clears on ordinary empty clicks', () => {
    const initial = get(editor).selectedIds
    select('missing')
    select(null, { toggle: true })
    expect(get(editor).selectedIds).toEqual(initial)
    setSelection([...initial, ...initial, 'missing'])
    expect(get(editor).selectedIds).toEqual(initial)
    select(null)
    expect(get(editor).selectedIds).toEqual([])
  })

  it('duplicates and deletes a mixed selection as one command each', () => {
    const before = structuredClone(get(editor).doc)
    select(before.nodes[0].id, { toggle: true })
    duplicateSelected()
    const duplicated = get(editor)
    expect(duplicated.selectedIds).toHaveLength(2)
    expect(duplicated.doc.nodes).toHaveLength(before.nodes.length + 1)
    expect(duplicated.doc.projectors).toHaveLength(before.projectors.length + 1)
    for (const copy of [...duplicated.doc.nodes, ...duplicated.doc.projectors].filter((o) =>
      duplicated.selectedIds.includes(o.id)
    )) {
      const original = [...before.nodes, ...before.projectors].find(
        (o) => `${o.name} copy` === copy.name
      )!
      expect(copy.id).not.toBe(original.id)
      expect(copy.transform.position).toEqual([
        original.transform.position[0] + 0.5,
        ...original.transform.position.slice(1)
      ])
    }
    removeSelected()
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).doc.nodes).toHaveLength(before.nodes.length)
    undo()
    expect(get(editor).doc).toEqual(duplicated.doc)
    undo()
    expect(get(editor).doc).toEqual(before)
    expect(get(editor).canUndo).toBe(false)
    redo()
    redo()
    expect(get(editor).doc.nodes).toHaveLength(before.nodes.length)
  })

  it('enforces the enabled-projector limit when duplicating several projectors', () => {
    const doc = sampleDocument()
    doc.projectors = Array.from({ length: 6 }, (_, i) => ({
      ...structuredClone(doc.projectors[0]),
      id: `p${i}`
    }))
    replaceDocument(doc)
    setSelection(doc.projectors.map((p) => p.id))
    duplicateSelected()
    expect(get(editor).doc.projectors).toHaveLength(12)
    expect(get(editor).doc.projectors.filter((p) => p.enabled)).toHaveLength(8)
    undo()
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).selected).toBeNull()
  })

  it('selects all scene objects and resets selection when opening a document', () => {
    selectAll()
    const { doc, selectedIds } = get(editor)
    expect(selectedIds).toHaveLength(doc.nodes.length + doc.projectors.length)
    expect(doc).not.toHaveProperty('selectedIds')
    const next = sampleDocument()
    replaceDocument(next)
    expect(get(editor).selectedIds).toEqual([next.projectors[0].id])
  })
})

describe('per-object locks', () => {
  it('removes locked items from the selection and cancels their calibration preview', () => {
    const { doc } = get(editor),
      projector = doc.projectors[0].id,
      node = doc.nodes[0].id
    select(node, { toggle: true })
    updateUI({ calibration: [[0, 0, 0]], calibrationPreview: identity() })
    toggleObjectLock(node)
    expect(get(editor).selectedIds).toEqual([projector])
    expect(get(editor).selected).toBe(projector)
    expect(get(editor).selectionAnchor).toBeNull()
    expect(get(editor).calibration).toEqual([])
    expect(get(editor).calibrationPreview).toBeNull()
    toggleObjectLock(projector)
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).selected).toBeNull()
  })

  it('skips locked projectors and receivers for direct, toggle, range and all selections', () => {
    const { doc } = get(editor),
      projector = doc.projectors[0].id,
      [screen, floor, plinth] = doc.nodes.map((n) => n.id)
    toggleObjectLock(projector)
    toggleObjectLock(floor)
    select(screen)
    for (const options of [{}, { toggle: true }, { range: true }]) {
      select(projector, options)
      select(floor, options)
      expect(get(editor).selectedIds).toEqual([screen])
    }
    select(plinth, { range: true })
    expect(get(editor).selectedIds).toEqual([screen, plinth])
    setSelection([projector, floor])
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).selectionAnchor).toBeNull()
    selectAll()
    expect(get(editor).selectedIds).toEqual([screen, plinth])
  })

  it('prevents stale property edits, duplication and deletion while keeping visibility independent', () => {
    const { doc } = get(editor),
      projector = doc.projectors[0],
      node = doc.nodes[0]
    toggleObjectLock(node.id)
    toggleObjectLock(projector.id)
    const locked = get(editor).doc
    editObject(node.id, { transform: identity() })
    editObject(projector.id, { name: 'Changed', throwRatio: 2 })
    expect(get(editor).doc).toBe(locked)
    // A selection captured before locking cannot modify the protected objects.
    updateUI({ selectedIds: [node.id, projector.id], selected: node.id })
    duplicateSelected()
    removeSelected()
    expect(get(editor).doc).toBe(locked)
    editObject(node.id, { visible: false })
    editObject(projector.id, { enabled: false })
    expect(get(editor).doc.nodes[0]).toEqual({ ...node, locked: true, visible: false })
    expect(get(editor).doc.projectors[0]).toEqual({ ...projector, locked: true, enabled: false })
  })

  it('undoes and redoes locks and allows selection after unlocking', () => {
    const id = get(editor).doc.projectors[0].id
    toggleObjectLock(id)
    undo()
    expect(get(editor).doc.projectors[0].locked).toBe(false)
    select(id)
    redo()
    expect(get(editor).doc.projectors[0].locked).toBe(true)
    expect(get(editor).selected).toBeNull()
    toggleObjectLock(id)
    select(id)
    expect(get(editor).selectedIds).toEqual([id])
  })

  it('opens documents with the first unlocked object selected, or no selection when all are locked', () => {
    const doc = sampleDocument()
    doc.projectors[0].locked = true
    doc.nodes[0].locked = true
    replaceDocument(doc)
    expect(get(editor).selectedIds).toEqual([doc.nodes[1].id])
    for (const node of doc.nodes) node.locked = true
    replaceDocument(doc)
    selectAll()
    expect(get(editor).selectedIds).toEqual([])
    expect(get(editor).selected).toBeNull()
    expect(get(editor).selectionAnchor).toBeNull()
  })
})

describe('shared transform pivot', () => {
  it('rotates and scales positions about the center while preserving relative orientation', () => {
    const left = {
      ...identity(),
      position: [-2, 1, 0] as [number, number, number],
      scale: [2, 3, 4] as [number, number, number]
    }
    left.rotation = new Quaternion().setFromEuler(new Euler(0.2, 0.3, 0.4)).toArray()
    const right = { ...identity(), position: [2, 1, 0] as [number, number, number] }
    const from = selectionPivot([left, right]),
      to = structuredClone(from)
    expect(from.position).toEqual([0, 1, 0])
    to.position = [1, 2, 3]
    to.rotation = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2)).toArray()
    to.scale = [2, 2, 2]
    const result = transformSelection(left, from, to)
    result.position.forEach((v, i) => expect(v).toBeCloseTo([1, -2, 3][i]))
    expect(result.scale).toEqual([4, 6, 8])
    const expected = new Quaternion()
      .fromArray(to.rotation)
      .multiply(new Quaternion().fromArray(left.rotation))
    expect(new Quaternion().fromArray(result.rotation).angleTo(expected)).toBeCloseTo(0)
    expect(transformSelection(left, from, to, false).scale).toEqual(left.scale)
    const other = transformSelection(right, from, to)
    expect(
      new Vector3().fromArray(result.position).distanceTo(new Vector3().fromArray(other.position))
    ).toBeCloseTo(8)
  })
})
