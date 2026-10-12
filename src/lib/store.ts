import { get, writable } from 'svelte/store'
import { Quaternion, Euler } from 'three'
import {
  identity,
  materials,
  type SceneDocument,
  type SceneNode,
  type ProjectorConfig,
  type ProjectorSpec,
  type Vec3,
  type AnalysisSample
} from './types'
import { customSpec } from './catalogue'
import { constrainShift } from './optics'

export const uid = () => crypto.randomUUID()
export function makeProjector(spec = customSpec): ProjectorConfig {
  return {
    id: uid(),
    name: 'Projector',
    transform: { ...identity(), position: [0, 2.2, 6] },
    enabled: true,
    locked: false,
    spec: structuredClone(spec),
    throwRatio: Math.max(spec.throwRange[0], Math.min(1, spec.throwRange[1])),
    shift: [0, 0],
    multiplier: 1,
    pattern: 'grid',
    nativePixelPreview: false,
    patternCellSize: 120,
    imageFit: 'contain',
    color: '#b0e65c',
    showOutline: true,
    showVolume: true,
    extent: 12
  }
}
export function makeNode(kind: SceneNode['kind']): SceneNode {
  return {
    id: uid(),
    name: kind[0].toUpperCase() + kind.slice(1),
    kind,
    transform: identity(),
    visible: true,
    locked: false,
    material: structuredClone(materials.white),
    dimensions: kind === 'plane' ? [6, 3.75, 0.1] : [1, 1, 1]
  }
}
export function sampleDocument(): SceneDocument {
  const screen = makeNode('plane')
  screen.name = 'Main screen'
  screen.transform.position = [0, 2.2, 0]
  const floor = makeNode('plane')
  floor.name = 'Stage floor'
  floor.dimensions = [12, 10, 0.1]
  floor.transform.rotation = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)).toArray()
  floor.material = structuredClone(materials.concrete)
  const box = makeNode('box')
  box.name = 'Test plinth'
  box.dimensions = [0.8, 0.9, 0.8]
  box.transform.position = [2.2, 0.45, 1.4]
  box.material = structuredClone(materials.concrete)
  const projector = makeProjector()
  projector.name = 'Projector 01'
  return {
    format: 'TwoManyProjectors',
    version: 1,
    id: uid(),
    name: 'Untitled studio',
    nodes: [screen, floor, box],
    projectors: [projector],
    assets: [],
    settings: {
      materialResponse: true,
      analysis: 'preview',
      analysisProjector: 'all',
      range: [0, 500],
      grid: true,
      snap: false,
      volumeOpacity: 0.045,
      outlineOpacity: 0.32
    },
    modified: new Date().toISOString()
  }
}
export interface EditorState {
  doc: SceneDocument
  selected: string | null
  selectedIds: string[]
  selectionAnchor: string | null
  tool: 'select' | 'translate' | 'rotate' | 'scale' | 'calibrate' | 'aim' | 'probe'
  orthographic: boolean
  revision: number
  canUndo: boolean
  canRedo: boolean
  notice: string
  error: string
  busy: number | null
  busyText: string
  probe: AnalysisSample | null
  calibration: Vec3[]
  calibrationPreview: import('./types').Transform | null
  frame: number
  recovering: boolean
  stats: { fps: number; primitives: number; gpu: string }
  contextLost: boolean
  interacting: boolean
}
const doc = sampleDocument()
export const editor = writable<EditorState>({
  doc,
  selected: doc.projectors[0].id,
  selectedIds: [doc.projectors[0].id],
  selectionAnchor: doc.projectors[0].id,
  tool: 'translate',
  orthographic: false,
  revision: 0,
  canUndo: false,
  canRedo: false,
  notice: 'Ready · everything stays on this device',
  error: '',
  busy: null,
  busyText: '',
  probe: null,
  calibration: [],
  calibrationPreview: null,
  frame: 0,
  recovering: false,
  stats: { fps: 0, primitives: 0, gpu: '' },
  contextLost: false,
  interacting: false
})
const undoStack: SceneDocument[] = [],
  redoStack: SceneDocument[] = []
let editStart: SceneDocument | null = null
let editLabel = 'Properties updated'
// Publish every input immediately, but record an entire drag/typing session as one command.
export function beginEdit() {
  if (editStart) return
  editStart = get(editor).doc
  updateUI({ interacting: true })
}
export function endEdit() {
  const start = editStart
  editStart = null
  editor.update((s) => {
    if (start && start !== s.doc) {
      undoStack.push(start)
      if (undoStack.length > 80) undoStack.shift()
      redoStack.length = 0
    }
    return {
      ...s,
      interacting: false,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      notice: start && start !== s.doc ? editLabel : s.notice
    }
  })
}
export function updateUI(patch: Partial<EditorState>) {
  editor.update((s) => ({ ...s, ...patch }))
}
function reconcileSelection(s: EditorState, doc: SceneDocument) {
  const existing = new Set(
    [...doc.projectors, ...doc.nodes].filter((o) => !o.locked).map((o) => o.id)
  )
  const selectedIds = s.selectedIds.filter((id) => existing.has(id))
  const selected =
    s.selected && selectedIds.includes(s.selected) ? s.selected : (selectedIds.at(-1) ?? null)
  return {
    selectedIds,
    selected,
    ...(selected !== s.selected ? { calibration: [], calibrationPreview: null } : {}),
    selectionAnchor: s.selectionAnchor && existing.has(s.selectionAnchor) ? s.selectionAnchor : null
  }
}
export function commit(label: string, change: (doc: SceneDocument) => void) {
  editor.update((s) => {
    const next = structuredClone(s.doc)
    change(next)
    next.modified = new Date().toISOString()
    if (editStart) editLabel = label
    else {
      undoStack.push(s.doc)
      if (undoStack.length > 80) undoStack.shift()
      redoStack.length = 0
    }
    return {
      ...s,
      doc: next,
      ...reconcileSelection(s, next),
      revision: s.revision + 1,
      canUndo: editStart ? s.canUndo : true,
      canRedo: false,
      notice: label,
      error: ''
    }
  })
}
export function undo() {
  endEdit()
  editor.update((s) => {
    const prev = undoStack.pop()
    if (!prev) return s
    redoStack.push(s.doc)
    return {
      ...s,
      doc: prev,
      ...reconcileSelection(s, prev),
      revision: s.revision + 1,
      canUndo: undoStack.length > 0,
      canRedo: true,
      notice: 'Undone',
      calibration: []
    }
  })
}
export function redo() {
  endEdit()
  editor.update((s) => {
    const next = redoStack.pop()
    if (!next) return s
    undoStack.push(s.doc)
    return {
      ...s,
      doc: next,
      ...reconcileSelection(s, next),
      revision: s.revision + 1,
      canRedo: redoStack.length > 0,
      canUndo: true,
      notice: 'Redone',
      calibration: []
    }
  })
}
export function replaceDocument(doc: SceneDocument) {
  editStart = null
  undoStack.length = redoStack.length = 0
  const selected = [...doc.projectors, ...doc.nodes].find((o) => !o.locked)?.id ?? null
  editor.update((s) => ({
    ...s,
    doc,
    selected,
    selectedIds: selected ? [selected] : [],
    selectionAnchor: selected,
    revision: s.revision + 1,
    canUndo: false,
    canRedo: false,
    probe: null,
    calibration: [],
    calibrationPreview: null,
    interacting: false,
    notice: 'Project opened'
  }))
}
export function setSelection(ids: string[], active = ids.at(-1) ?? null, anchor = active) {
  endEdit()
  const s = get(editor),
    existing = new Set(
      [...s.doc.projectors, ...s.doc.nodes].filter((o) => !o.locked).map((o) => o.id)
    )
  const selectedIds = [...new Set(ids)].filter((id) => existing.has(id))
  updateUI({
    selectedIds,
    selected: active && selectedIds.includes(active) ? active : (selectedIds.at(-1) ?? null),
    selectionAnchor: anchor && existing.has(anchor) ? anchor : null,
    calibration: [],
    calibrationPreview: null,
    probe: null
  })
}
export function select(id: string | null, options: { toggle?: boolean; range?: boolean } = {}) {
  const s = get(editor)
  if (!id) {
    if (!options.toggle && !options.range) setSelection([])
    return
  }
  const order = [...s.doc.projectors, ...s.doc.nodes].filter((o) => !o.locked).map((o) => o.id)
  if (!order.includes(id)) return
  if (options.range && s.selectionAnchor && order.includes(s.selectionAnchor)) {
    const start = order.indexOf(s.selectionAnchor),
      end = order.indexOf(id)
    const range = order.slice(Math.min(start, end), Math.max(start, end) + 1)
    setSelection(options.toggle ? [...s.selectedIds, ...range] : range, id, s.selectionAnchor)
  } else if (options.toggle) {
    const ids = s.selectedIds.includes(id)
      ? s.selectedIds.filter((selected) => selected !== id)
      : [...s.selectedIds, id]
    setSelection(ids, ids.includes(id) ? id : (ids.at(-1) ?? null), id)
  } else setSelection([id])
}
export function selectAll() {
  const s = get(editor)
  setSelection([...s.doc.projectors, ...s.doc.nodes].map((o) => o.id))
}
export function selectedObject() {
  const s = get(editor)
  return [...s.doc.nodes, ...s.doc.projectors].find((n) => n.id === s.selected)
}
export function editObject(
  id: string,
  patch: Partial<SceneNode> | Partial<ProjectorConfig>,
  label = 'Properties updated'
) {
  const object = [...get(editor).doc.nodes, ...get(editor).doc.projectors].find((n) => n.id === id)
  if (
    !object ||
    (object.locked &&
      Object.keys(patch).some((key) => !['locked', 'visible', 'enabled'].includes(key)))
  )
    return
  commit(label, (d) => {
    const object = [...d.nodes, ...d.projectors].find((n) => n.id === id)
    if (object) Object.assign(object, patch)
  })
}
export function toggleObjectLock(id: string) {
  endEdit()
  const object = [...get(editor).doc.nodes, ...get(editor).doc.projectors].find((o) => o.id === id)
  if (object)
    editObject(
      id,
      { locked: !object.locked },
      `${object.locked ? 'Unlocked' : 'Locked'} ${object.name}`
    )
}
export function addNode(kind: SceneNode['kind']) {
  const n = makeNode(kind)
  n.transform.position = [0, kind === 'plane' ? 2 : 0.5, 2]
  commit(`Added ${kind}`, (d) => d.nodes.push(n))
  select(n.id)
}
export function addProjector(spec?: ProjectorSpec) {
  const s = get(editor),
    p = makeProjector(spec)
  p.name = `Projector ${String(s.doc.projectors.length + 1).padStart(2, '0')}`
  p.transform.position[0] = s.doc.projectors.length * 0.7
  if (s.doc.projectors.filter((p) => p.enabled).length >= 8) p.enabled = false
  commit('Added projector', (d) => d.projectors.push(p))
  select(p.id)
}
export function toggleProjector(p: ProjectorConfig) {
  if (!p.enabled && get(editor).doc.projectors.filter((x) => x.enabled).length >= 8)
    return updateUI({ error: 'Eight projectors are already enabled. Disable one first.' })
  editObject(p.id, { enabled: !p.enabled })
}
export function removeSelected() {
  const s = get(editor)
  const ids = new Set(
    [...s.doc.projectors, ...s.doc.nodes]
      .filter((o) => !o.locked && s.selectedIds.includes(o.id))
      .map((o) => o.id)
  )
  if (!ids.size) return
  endEdit()
  commit(ids.size === 1 ? 'Deleted object' : `Deleted ${ids.size} objects`, (d) => {
    d.nodes = d.nodes.filter((n) => !ids.has(n.id))
    d.projectors = d.projectors.filter((n) => !ids.has(n.id))
  })
  select(null)
}
export function duplicateSelected() {
  const s = get(editor)
  const copies = [...s.doc.projectors, ...s.doc.nodes]
    .filter((o) => !o.locked && s.selectedIds.includes(o.id))
    .map((obj) => {
      const copy = structuredClone(obj)
      copy.id = uid()
      copy.name += ' copy'
      copy.transform.position[0] += 0.5
      return copy
    })
  if (!copies.length) return
  endEdit()
  commit(copies.length === 1 ? 'Duplicated object' : `Duplicated ${copies.length} objects`, (d) => {
    for (const copy of copies) {
      if ('spec' in copy) {
        if (d.projectors.filter((p) => p.enabled).length >= 8) copy.enabled = false
        d.projectors.push(copy)
      } else d.nodes.push(copy)
    }
  })
  setSelection(copies.map((o) => o.id))
}
export function setShift(p: ProjectorConfig, shift: [number, number]) {
  editObject(p.id, { shift: constrainShift(p, shift) }, 'Lens shift updated')
}
