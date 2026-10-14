import { zip, unzip, strToU8, strFromU8 } from 'fflate'
import { get } from 'svelte/store'
import {
  editor,
  emptyDocument,
  endEdit,
  ensureProjectorVersions,
  replaceDocument,
  sampleDocument,
  updateUI
} from './store'
import { loadAsset, originalFiles, runtimeAssets, type RuntimeAsset } from './assets'
import type { ProjectorConfig, SceneDocument, SceneNode } from './types'
import { makeCustomSpec } from './catalogue'
import { constrainShift } from './optics'

export function validateDocument(value: unknown): SceneDocument {
  const fail = (message: string): never => {
    throw new Error(`Invalid project: ${message}`)
  }
  if (!value || typeof value !== 'object') fail('missing scene document')
  const d = value as SceneDocument
  if (d.format !== 'TwoManyProjectors' || d.version !== 1) fail('unsupported format or version')
  if (
    typeof d.name !== 'string' ||
    typeof d.id !== 'string' ||
    !Array.isArray(d.nodes) ||
    !Array.isArray(d.projectors) ||
    !Array.isArray(d.assets)
  )
    fail('missing scene fields')
  if (d.nodes.length > 10000 || d.projectors.length > 1000 || d.assets.length > 10000)
    fail('too many scene objects')
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n),
    tuple = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every(finite)
  const ids = new Set<string>()
  const validateIdentity = (o: { id: string; name: string }, ids: Set<string>) => {
    if (!o || typeof o !== 'object') fail('invalid scene object')
    if (typeof o.id !== 'string' || ids.has(o.id)) fail('duplicate or missing object ID')
    ids.add(o.id)
    if (typeof o.name !== 'string') fail('missing object name')
  }
  for (const o of [...d.nodes, ...d.projectors, ...d.assets]) validateIdentity(o, ids)
  const validateTransform = (o: SceneNode | ProjectorConfig) => {
    if (o.locked === undefined) o.locked = false
    if (typeof o.locked !== 'boolean') fail('invalid object lock')
    if (
      !o.transform ||
      !tuple(o.transform.position, 3) ||
      !tuple(o.transform.rotation, 4) ||
      !tuple(o.transform.scale, 3) ||
      o.transform.scale.some((s) => s <= 0)
    )
      fail('invalid transform')
    const q = o.transform.rotation
    if (Math.abs(Math.hypot(...q) - 1) > 0.001) fail('rotation quaternion must be normalized')
  }
  for (const o of [...d.nodes, ...d.projectors]) validateTransform(o)
  for (const n of d.nodes) {
    if (
      !['plane', 'box', 'cylinder', 'mesh', 'cloud', 'splat'].includes(n.kind) ||
      !tuple(n.dimensions, 3) ||
      n.dimensions.some((v) => v <= 0) ||
      typeof n.visible !== 'boolean'
    )
      fail('invalid receiver')
    if (n.assetId && !d.assets.some((a) => a.id === n.assetId)) fail('missing receiver asset')
    if (
      n.textureId !== undefined &&
      (typeof n.textureId !== 'string' ||
        !['plane', 'box', 'cylinder', 'mesh'].includes(n.kind) ||
        !d.assets.some((a) => a.id === n.textureId && a.kind === 'image'))
    )
      fail('invalid surface texture')
    if (
      n.gaussian !== undefined &&
      (!n.gaussian ||
        !finite(n.gaussian.opacity) ||
        n.gaussian.opacity < 0 ||
        n.gaussian.opacity > 5 ||
        !finite(n.gaussian.size) ||
        n.gaussian.size < 0.1 ||
        n.gaussian.size > 5)
    )
      fail('invalid Gaussian rendering options')
    const m = n.material
    if (
      !m ||
      !/^#[\da-f]{6}$/i.test(m.color) ||
      (m.colorBoost !== undefined &&
        (!finite(m.colorBoost) || m.colorBoost < 0 || m.colorBoost > 10)) ||
      (m.forceUniformColor !== undefined && typeof m.forceUniformColor !== 'boolean') ||
      ![m.reflectance, m.roughness, m.transmission].every((v) => finite(v) && v >= 0 && v <= 1)
    )
      fail('invalid surface material')
  }
  const validateProjectors = (projectors: ProjectorConfig[]) => {
    if (projectors.length > 1000) fail('too many projectors in version')
    if (projectors.filter((p) => p.enabled).length > 8) fail('more than eight enabled projectors')
    for (const p of projectors) {
    if (typeof p.enabled !== 'boolean') fail('invalid projector enabled state')
    if (p.heightMeasurement !== undefined) {
      const measurement = p.heightMeasurement
      if (
        !measurement ||
        typeof measurement.visible !== 'boolean' ||
        (measurement.reference !== null &&
          (!measurement.reference ||
            typeof measurement.reference.nodeId !== 'string' ||
            !measurement.reference.nodeId ||
            !tuple(measurement.reference.point, 3)))
      )
        fail('invalid projector height measurement')
    }
    // Existing v1 projects keep the smooth preview and use 120 px square cells.
    p.nativePixelPreview ??= false
    p.patternCellSize ??= 120
    const s = p.spec
    if (
      !s ||
      !tuple(s.resolution, 2) ||
      s.resolution.some((v) => v < 1 || v > 32768) ||
      !finite(s.lumens) ||
      s.lumens < 0 ||
      !tuple(s.throwRange, 2) ||
      s.throwRange[0] <= 0 ||
      s.throwRange[1] < s.throwRange[0] ||
      !finite(p.throwRatio) ||
      p.throwRatio <= 0 ||
      !tuple(p.shift, 2) ||
      !finite(p.multiplier) ||
      p.multiplier < 0 ||
      !finite(p.extent) ||
      p.extent <= 0.02 ||
      (p.volumeOpacity !== undefined &&
        (!finite(p.volumeOpacity) || p.volumeOpacity < 0 || p.volumeOpacity > 1)) ||
      !/^#[\da-f]{6}$/i.test(p.color) ||
      typeof p.nativePixelPreview !== 'boolean' ||
      !finite(p.patternCellSize) ||
      !Number.isInteger(p.patternCellSize) ||
      p.patternCellSize < 8 ||
      p.patternCellSize > 4096 ||
      !['grid', 'checker', 'uvmap', 'crosshair', 'alignment', 'bars', 'white', 'image', 'camera'].includes(
        p.pattern
      )
    )
      fail('invalid projector optics')
    if (!['contain', 'cover', 'stretch'].includes(p.imageFit)) fail('invalid projection media fit')
    if (
      p.camera !== undefined &&
      (!p.camera || typeof p.camera.deviceId !== 'string' || typeof p.camera.label !== 'string')
    )
      fail('invalid camera preference')
    if (
      !s.shift ||
      !finite(s.shift.horizontal) ||
      !finite(s.shift.vertical) ||
      !['diamond', 'ellipse', 'rectangle'].includes(s.shift.coupled) ||
      s.shift.polygon?.some((v) => !tuple(v, 2))
    )
      fail('invalid shift constraints')
    // Older custom copies retained manufacturer references and lens limits.
    if (s.id === 'custom' && s.sources?.length) {
      p.spec = makeCustomSpec(s)
      p.shift = constrainShift(p, p.shift)
    }
    if (p.imageId && !d.assets.some((a) => a.id === p.imageId && a.kind === 'image'))
      fail('missing projection image')
    }
  }
  validateProjectors(d.projectors)
  for (const a of d.assets) {
    if (
      !['mesh', 'cloud', 'splat', 'image'].includes(a.kind) ||
      !Array.isArray(a.files) ||
      !a.files.includes(a.primary) ||
      !['auto', 'm', 'cm', 'mm', 'ft'].includes(a.units) ||
      !['y', 'z'].includes(a.upAxis) ||
      (a.flipAxes !== undefined &&
        (!Array.isArray(a.flipAxes) ||
          a.flipAxes.length !== 3 ||
          a.flipAxes.some((v) => typeof v !== 'boolean')))
    )
      fail('invalid asset')
    for (const path of a.files)
      if (!path.startsWith('assets/') || path.includes('..') || path.includes('\\'))
        fail('unsafe asset path')
  }
  const s = d.settings
  if (s && s.dynamicRenderingQuality === undefined) s.dynamicRenderingQuality = false
  if (
    !s ||
    !['preview', 'lux', 'density', 'distortion', 'overlap'].includes(s.analysis) ||
    !tuple(s.range, 2) ||
    s.range[1] <= s.range[0] ||
    typeof s.materialResponse !== 'boolean' ||
    typeof s.grid !== 'boolean' ||
    typeof s.dynamicRenderingQuality !== 'boolean' ||
    typeof s.snap !== 'boolean'
  )
    fail('invalid analysis settings')
  if (s.viewShading === undefined) s.viewShading = 'directional'
  if (s.lightAzimuth === undefined) s.lightAzimuth = 45
  if (s.lightElevation === undefined) s.lightElevation = 45
  if (
    !['none', 'directional', 'projectors'].includes(s.viewShading) ||
    !finite(s.lightAzimuth) ||
    s.lightAzimuth < -180 ||
    s.lightAzimuth > 180 ||
    !finite(s.lightElevation) ||
    s.lightElevation < -90 ||
    s.lightElevation > 90
  )
    fail('invalid viewport shading settings')
  if (s.luxDisplay === undefined) s.luxDisplay = 'smooth'
  if (s.luxTarget === undefined) s.luxTarget = [80, 120]
  if (
    !['smooth', 'bands', 'target'].includes(s.luxDisplay) ||
    !tuple(s.luxTarget, 2) ||
    s.luxTarget[0] < 0 ||
    s.luxTarget[1] <= s.luxTarget[0]
  )
    fail('invalid lux display settings')
  // Migrate existing v1 projects to shared viewport visualization settings.
  s.volumeOpacity ??= d.projectors[0]?.volumeOpacity ?? 0.045
  s.outlineOpacity ??= 0.32
  if (![s.volumeOpacity, s.outlineOpacity].every((v) => finite(v) && v >= 0 && v <= 1))
    fail('invalid frustum opacity')
  if (s.shadowBoost === undefined) s.shadowBoost = 1
  if (!finite(s.shadowBoost) || s.shadowBoost < 1 || s.shadowBoost > 10)
    fail('invalid shadow boost')
  if (s.shadowHighlight === undefined) s.shadowHighlight = false
  if (typeof s.shadowHighlight !== 'boolean') fail('invalid shadow highlight')
  if (d.projectorVersions !== undefined) {
    const versions = d.projectorVersions
    if (
      !versions ||
      typeof versions.activeId !== 'string' ||
      !Array.isArray(versions.items) ||
      !versions.items.length ||
      versions.items.length > 1000
    )
      fail('invalid projector versions')
    const versionIds = new Set<string>()
    for (const version of versions.items) {
      if (
        !version ||
        typeof version.id !== 'string' ||
        !version.id ||
        versionIds.has(version.id) ||
        typeof version.name !== 'string' ||
        !version.name.trim()
      )
        fail('duplicate or invalid projector version')
      versionIds.add(version.id)
      if (version.id === versions.activeId) {
        if (version.projectors !== undefined) fail('active projector version must use scene projectors')
      } else {
        if (!Array.isArray(version.projectors)) fail('missing projectors in version')
        const setupIds = new Set([...d.nodes, ...d.assets].map((o) => o.id))
        for (const projector of version.projectors!) {
          validateIdentity(projector, setupIds)
          validateTransform(projector)
        }
        validateProjectors(version.projectors!)
      }
    }
    if (!versionIds.has(versions.activeId)) fail('missing active projector version')
  }
  ensureProjectorVersions(d)
  return d
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export async function saveProject() {
  updateUI({ busy: 0.1, busyText: 'Packing project…', error: '' })
  try {
    const doc = get(editor).doc,
      entries: Record<string, Uint8Array> = { 'scene.json': strToU8(JSON.stringify(doc, null, 2)) }
    for (const a of doc.assets)
      for (const path of a.files) {
        const file = originalFiles.get(path)
        if (!file) throw new Error(`Original asset is missing: ${path}`)
        entries[path] = new Uint8Array(await file.arrayBuffer())
      }
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      zip(entries, { level: 1 }, (err, data) => (err ? reject(err) : resolve(data)))
    )
    download(
      new Blob([bytes as BlobPart], { type: 'application/zip' }),
      `${doc.name.replace(/[^a-z\d _-]/gi, '_')}.tmp3d`
    )
    updateUI({ notice: 'Project saved with original assets' })
  } catch (e) {
    updateUI({ error: (e as Error).message })
  } finally {
    updateUI({ busy: null })
  }
}
export async function hydrate(doc: SceneDocument, files: Map<string, File>) {
  validateDocument(doc)
  const staged = new Map<string, RuntimeAsset>()
  try {
    for (const a of doc.assets) {
      for (const path of a.files)
        if (!files.has(path)) throw new Error(`Project is missing ${path}`)
      staged.set(a.id, await loadAsset(a, files))
    }
  } catch (e) {
    for (const a of staged.values()) a.dispose()
    throw e
  }
  // Do not discard the existing document until all new assets have loaded.
  const previous = [...new Set(runtimeAssets.values())]
  runtimeAssets.clear()
  originalFiles.clear()
  for (const [key, value] of staged) runtimeAssets.set(key, value)
  for (const [key, value] of files) originalFiles.set(key, value)
  replaceDocument(doc)
  setTimeout(() => previous.forEach((a) => a.dispose()), 100)
  updateUI({ frame: Date.now() })
}
export async function openProject(file: File) {
  return changeProject(async () => {
    let total = 0
    // Inspect uncompressed lengths before allocating an archive entry.
    const data = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
      file
        .arrayBuffer()
        .then((buffer) =>
          unzip(
            new Uint8Array(buffer),
            {
              filter: (entry) => {
                total += entry.originalSize
                if (total > 1_500_000_000 || entry.originalSize > 1_000_000_000)
                  throw new Error('Project exceeds the 1.5 GB archive limit.')
                return true
              }
            },
            (err, value) => (err ? reject(err) : resolve(value))
          )
        )
        .catch(reject)
    )
    if (!data['scene.json']) throw new Error('Not a .tmp3d project: scene.json is missing.')
    const doc = validateDocument(JSON.parse(strFromU8(data['scene.json']))),
      files = new Map<string, File>()
    for (const a of doc.assets)
      for (const path of a.files) {
        if (!data[path]) throw new Error(`Project is missing ${path}`)
        files.set(path, new File([data[path] as BlobPart], path.split('/').pop()!))
      }
    return { doc, files }
  }, 'Project opened')
}

interface StoredProject {
  doc: SceneDocument
}
export interface LocalProject {
  id: string
  name: string
  modified: string
  projectors: number
  receivers: number
  assets: number
}

let databasePromise: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  return (databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('twomanyprojectors', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery')
      const projects = db.createObjectStore('projects')
      const files = db.createObjectStore('projectFiles')
      const recovery = request.transaction!.objectStore('recovery')
      // Move the single-session autosave and its original files into the library
      // in the upgrade transaction, so interruption cannot leave a partial move.
      const latest = recovery.get('latest')
      latest.onsuccess = () => {
        const legacy = latest.result as { doc?: SceneDocument; files?: [string, File][] } | undefined
        if (!legacy?.doc) return
        const id = legacy.doc.id
        projects.put({ doc: legacy.doc }, id)
        for (const [path, file] of legacy.files ?? []) files.put(file, [id, path])
        const cursor = recovery.openCursor()
        cursor.onsuccess = () => {
          const entry = cursor.result
          if (!entry) return
          if (typeof entry.key === 'string' && entry.key.startsWith('file:')) {
            files.put(entry.value, [id, entry.key.slice(5)])
            entry.delete()
          }
          entry.continue()
        }
        recovery.put({ projectId: id }, 'latest')
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = undefined
      }
      resolve(request.result)
    }
    request.onerror = () => {
      databasePromise = undefined
      reject(request.error)
    }
  }))
}
const checkpointKey = 'twomanyprojectors.latest'
const savedFiles = new Map<string, File>()
let savedFileSignature = ''
let savedProjectId = ''
let saveQueue: Promise<void> = Promise.resolve()

function transactionComplete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Local storage transaction was aborted'))
  })
}
function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function fileRange(projectId: string) {
  return IDBKeyRange.bound([projectId], [projectId, []])
}
async function writeSnapshot(doc: SceneDocument, files: [string, File][]) {
  const paths = new Set(files.map(([path]) => path))
  for (const asset of doc.assets)
    for (const path of asset.files)
      if (!paths.has(path)) throw new Error(`Original asset is missing: ${path}`)
  const db = await database()
  if (savedProjectId !== doc.id) {
    savedFiles.clear()
    savedFileSignature = ''
    savedProjectId = doc.id
  }
  const changedFiles = files.filter(([path, file]) => savedFiles.get(path) !== file)
  const signature = JSON.stringify([...paths].sort())
  const tx = db.transaction(['projects', 'projectFiles', 'recovery'], 'readwrite')
  const complete = transactionComplete(tx)
  const store = tx.objectStore('projectFiles')
  for (const [path, file] of changedFiles) store.put(file, [doc.id, path])
  tx.objectStore('projects').put({ doc }, doc.id)
  tx.objectStore('recovery').put({ projectId: doc.id }, 'latest')
  if (signature !== savedFileSignature) {
    const cursor = store.openKeyCursor(fileRange(doc.id))
    cursor.onsuccess = () => {
      const entry = cursor.result
      if (!entry) return
      if (!paths.has((entry.key as string[])[1])) store.delete(entry.key)
      entry.continue()
    }
  }
  await complete
  for (const path of savedFiles.keys()) if (!paths.has(path)) savedFiles.delete(path)
  for (const [path, file] of changedFiles) savedFiles.set(path, file)
  savedFileSignature = signature
}

export function autosave(): Promise<boolean> {
  // Capture before awaiting, and synchronously checkpoint small scene data so an
  // immediate reload cannot lose the most recent edit while IndexedDB is opening.
  const doc = get(editor).doc
  const files = [...originalFiles].filter(([path]) =>
    doc.assets.some((a) => a.files.includes(path))
  )
  try {
    localStorage.setItem(checkpointKey, JSON.stringify(doc))
  } catch {
    /* IndexedDB remains available when localStorage is full or disabled. */
  }
  // Serialize snapshots so rapid edits, undo and project changes cannot race
  // file cleanup or write an older document over a newer one.
  const save = saveQueue.catch(() => {}).then(() => writeSnapshot(doc, files))
  saveQueue = save
  return save.then(
    () => true,
    (e) => {
      savedFiles.clear()
      savedFileSignature = ''
      updateUI({
        error: `Autosave unavailable: ${(e as Error).message}. Use Save project to keep your work.`
      })
      return false
    }
  )
}

export async function listLocalProjects(): Promise<LocalProject[]> {
  await saveQueue.catch(() => {})
  const db = await database()
  const projects = await requestResult<StoredProject[]>(
    db.transaction('projects').objectStore('projects').getAll()
  )
  return projects
    .map(({ doc }) => ({
      id: doc.id,
      name: doc.name,
      modified: doc.modified,
      projectors: doc.projectors.length,
      receivers: doc.nodes.length,
      assets: doc.assets.length
    }))
    .sort((a, b) => b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name))
}
async function readLocalDocument(id: string): Promise<SceneDocument | undefined> {
  const db = await database()
  const stored = await requestResult<StoredProject | undefined>(
    db.transaction('projects').objectStore('projects').get(id)
  )
  return stored ? validateDocument(stored.doc) : undefined
}
async function readProjectFiles(doc: SceneDocument): Promise<Map<string, File>> {
  const db = await database()
  const tx = db.transaction('projectFiles')
  const complete = transactionComplete(tx)
  const files = new Map<string, File>()
  for (const path of new Set(doc.assets.flatMap((a) => a.files))) {
    const request = tx.objectStore('projectFiles').get([doc.id, path])
    request.onsuccess = () => {
      if (request.result) files.set(path, request.result)
    }
  }
  await complete
  return files
}

async function changeProject(
  load: () => Promise<{ doc: SceneDocument; files: Map<string, File> }>,
  notice: string
): Promise<boolean> {
  const state = get(editor)
  if (state.recovering || state.busy !== null) return false
  endEdit()
  updateUI({ busy: 0.1, busyText: 'Opening project…', error: '' })
  try {
    if (!(await autosave())) return false
    const { doc, files } = await load()
    await hydrate(doc, files)
    if (!(await autosave())) return false
    updateUI({ notice })
    return true
  } catch (e) {
    updateUI({ error: (e as Error).message })
    return false
  } finally {
    updateUI({ busy: null })
  }
}
export function createProject(name = 'Untitled studio', template: 'empty' | 'sample' = 'empty') {
  return changeProject(async () => {
    const doc = template === 'sample' ? sampleDocument() : emptyDocument(name)
    doc.name = name.trim() || 'Untitled studio'
    return { doc, files: new Map() }
  }, 'New project created')
}
export function openLocalProject(id: string) {
  return changeProject(async () => {
    const doc = await readLocalDocument(id)
    if (!doc) throw new Error('This local project is no longer available.')
    return { doc, files: await readProjectFiles(doc) }
  }, 'Local project opened')
}
export async function deleteLocalProject(id: string) {
  await saveQueue.catch(() => {})
  if (get(editor).doc.id === id) throw new Error('Open another project before deleting this one.')
  const db = await database()
  const tx = db.transaction(['projects', 'projectFiles'], 'readwrite')
  const complete = transactionComplete(tx)
  tx.objectStore('projects').delete(id)
  tx.objectStore('projectFiles').delete(fileRange(id))
  await complete
  if (savedProjectId === id) {
    savedFiles.clear()
    savedFileSignature = ''
    savedProjectId = ''
  }
}

export async function readRecovery(): Promise<{
  doc: SceneDocument
  files: [string, File][]
} | null> {
  try {
    let checkpoint: SceneDocument | undefined
    try {
      const json = localStorage.getItem(checkpointKey)
      if (json) checkpoint = validateDocument(JSON.parse(json))
    } catch {
      /* Fall back to the last complete IndexedDB snapshot. */
    }
    const db = await database()
    const latest = await requestResult<{ projectId: string } | undefined>(
      db.transaction('recovery').objectStore('recovery').get('latest')
    )
    const candidates = [checkpoint]
    if (checkpoint) candidates.push(await readLocalDocument(checkpoint.id))
    if (latest?.projectId) candidates.push(await readLocalDocument(latest.projectId))
    for (const doc of candidates) {
      if (!doc) continue
      const files = await readProjectFiles(doc)
      if (doc.assets.some((a) => a.files.some((path) => !files.has(path)))) continue
      return { doc, files: [...files] }
    }
    return null
  } catch {
    return null
  }
}
