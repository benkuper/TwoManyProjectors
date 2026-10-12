import { zip, unzip, strToU8, strFromU8 } from 'fflate'
import { get } from 'svelte/store'
import { editor, replaceDocument, updateUI } from './store'
import { loadAsset, originalFiles, runtimeAssets, type RuntimeAsset } from './assets'
import type { SceneDocument } from './types'
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
  for (const o of [...d.nodes, ...d.projectors, ...d.assets]) {
    if (typeof o.id !== 'string' || ids.has(o.id)) fail('duplicate or missing object ID')
    ids.add(o.id)
    if (typeof o.name !== 'string') fail('missing object name')
  }
  for (const o of [...d.nodes, ...d.projectors]) {
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
      ![m.reflectance, m.roughness, m.transmission].every((v) => finite(v) && v >= 0 && v <= 1)
    )
      fail('invalid surface material')
  }
  if (d.projectors.filter((p) => p.enabled).length > 8) fail('more than eight enabled projectors')
  for (const p of d.projectors) {
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
      !['grid', 'checker', 'crosshair', 'alignment', 'bars', 'white', 'image'].includes(p.pattern)
    )
      fail('invalid projector optics')
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
  for (const a of d.assets) {
    if (
      !['mesh', 'cloud', 'splat', 'image'].includes(a.kind) ||
      !Array.isArray(a.files) ||
      !a.files.includes(a.primary) ||
      !['m', 'cm', 'mm', 'ft'].includes(a.units) ||
      !['y', 'z'].includes(a.upAxis)
    )
      fail('invalid asset')
    for (const path of a.files)
      if (!path.startsWith('assets/') || path.includes('..') || path.includes('\\'))
        fail('unsafe asset path')
  }
  const s = d.settings
  if (
    !s ||
    !['preview', 'lux', 'density', 'distortion'].includes(s.analysis) ||
    !tuple(s.range, 2) ||
    s.range[1] <= s.range[0] ||
    typeof s.materialResponse !== 'boolean' ||
    typeof s.grid !== 'boolean' ||
    typeof s.snap !== 'boolean'
  )
    fail('invalid analysis settings')
  // Migrate existing v1 projects to shared viewport visualization settings.
  s.volumeOpacity ??= d.projectors[0]?.volumeOpacity ?? 0.045
  s.outlineOpacity ??= 0.32
  if (![s.volumeOpacity, s.outlineOpacity].every((v) => finite(v) && v >= 0 && v <= 1))
    fail('invalid frustum opacity')
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
      if (a.kind !== 'image') staged.set(a.id, await loadAsset(a, files))
    }
  } catch (e) {
    for (const a of staged.values()) a.dispose()
    throw e
  }
  // Do not discard the existing document until all new assets have loaded.
  const previous = [...runtimeAssets.values()]
  runtimeAssets.clear()
  originalFiles.clear()
  for (const [key, value] of staged) runtimeAssets.set(key, value)
  for (const [key, value] of files) originalFiles.set(key, value)
  replaceDocument(doc)
  setTimeout(() => previous.forEach((a) => a.dispose()), 100)
  updateUI({ frame: Date.now() })
}
export async function openProject(file: File) {
  updateUI({ busy: 0.1, busyText: 'Opening project…', error: '' })
  try {
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
    await hydrate(doc, files)
  } catch (e) {
    updateUI({ error: (e as Error).message })
  } finally {
    updateUI({ busy: null })
  }
}
let databasePromise: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  return (databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('twomanyprojectors', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('recovery')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = undefined
      reject(request.error)
    }
  }))
}
const checkpointKey = 'twomanyprojectors.latest'
const savedFiles = new Map<string, File>()
let savedFileSignature = ''
export async function autosave() {
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
  try {
    const db = await database()
    const changedFiles = files.filter(([path, file]) => savedFiles.get(path) !== file)
    const paths = new Set(files.map(([path]) => path))
    const signature = JSON.stringify([...paths].sort())
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite')
      const store = tx.objectStore('recovery')
      for (const [path, file] of changedFiles) store.put(file, `file:${path}`)
      store.put({ doc }, 'latest')
      if (signature !== savedFileSignature) {
        const cursor = store.openKeyCursor()
        cursor.onsuccess = () => {
          const entry = cursor.result
          if (!entry) return
          if (
            typeof entry.key === 'string' &&
            entry.key.startsWith('file:') &&
            !paths.has(entry.key.slice(5))
          )
            store.delete(entry.key)
          entry.continue()
        }
      }
      // Track queued transactions synchronously so a quick undo cannot skip
      // rewriting a file that an earlier, still-pending transaction deletes.
      for (const path of savedFiles.keys()) if (!paths.has(path)) savedFiles.delete(path)
      for (const [path, file] of changedFiles) savedFiles.set(path, file)
      savedFileSignature = signature
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (e) {
    savedFiles.clear()
    savedFileSignature = ''
    updateUI({
      error: `Autosave unavailable: ${(e as Error).message}. Use Save project to keep your work.`
    })
  }
}
export async function readRecovery(): Promise<{
  doc: SceneDocument
  files: [string, File][]
} | null> {
  try {
    const db = await database(),
      result = await new Promise<any>((resolve, reject) => {
        const r = db.transaction('recovery').objectStore('recovery').get('latest')
        r.onsuccess = () => resolve(r.result ?? null)
        r.onerror = () => reject(r.error)
      })
    let checkpoint: SceneDocument | undefined
    try {
      const json = localStorage.getItem(checkpointKey)
      if (json) checkpoint = validateDocument(JSON.parse(json))
    } catch {
      /* Fall back to the last complete IndexedDB snapshot. */
    }
    const doc: SceneDocument | undefined = checkpoint ?? result?.doc
    if (!doc) return null
    const files = new Map<string, File>(result?.files ?? [])
    const paths = [...new Set(doc.assets.flatMap((a) => a.files))]
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery')
      for (const path of paths) {
        const req = tx.objectStore('recovery').get(`file:${path}`)
        req.onsuccess = () => {
          if (req.result) files.set(path, req.result)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    if (paths.some((path) => !files.has(path))) {
      if (!result?.doc) return null
      const fallback = result.doc as SceneDocument
      if (fallback.assets.some((a) => a.files.some((path) => !files.has(path)))) return null
      return { doc: fallback, files: [...files] }
    }
    return { doc, files: [...files] }
  } catch {
    return null
  }
}
