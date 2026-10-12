import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Object3D
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js'
import { computeBoundsTree, acceleratedRaycast, PointsBVH } from 'three-mesh-bvh'
import { SplatMesh } from '@sparkjsdev/spark'
import { classifyPLY, binaryGaussianPLY } from './formats'
export { classifyPLY } from './formats'
import { get } from 'svelte/store'
import type { AssetKind, AssetRecord, SceneNode, Vec3 } from './types'
import { identity, materials } from './types'
import { commit, editor, select, uid, updateUI } from './store'

export interface RuntimeAsset {
  record: AssetRecord
  root: Object3D
  proxy?: Points
  dispose: () => void
}
export const runtimeAssets = new Map<string, RuntimeAsset>()
export const originalFiles = new Map<string, File>()
function assetNode(record: AssetRecord): SceneNode {
  if (record.kind === 'image') throw new Error('Projection images cannot be added as receivers.')
  return {
    id: uid(),
    name: record.name.replace(/\.[^.]+$/, ''),
    kind: record.kind,
    transform: identity(),
    visible: true,
    locked: false,
    material: structuredClone(materials.captured),
    assetId: record.id,
    dimensions: [1, 1, 1]
  }
}
export function addAssetToScene(assetId: string, point?: Vec3) {
  const record = get(editor).doc.assets.find((a) => a.id === assetId),
    asset = runtimeAssets.get(assetId)
  if (!record || record.kind === 'image' || !asset) return
  const node = assetNode(record)
  if (point) {
    // Place the asset's bottom center at the drop point, respecting its source units and up axis.
    const box =
      asset.proxy && record.kind === 'splat'
        ? asset.proxy.geometry.boundingBox!.clone().applyMatrix4(asset.root.matrixWorld)
        : new Box3().setFromObject(asset.root)
    if (!box.isEmpty()) {
      const center = box.getCenter(new Vector3())
      node.transform.position = [point[0] - center.x, point[1] - box.min.y, point[2] - center.z]
    }
  }
  commit(`Added ${node.name} to scene`, (d) => d.nodes.push(node))
  select(node.id)
  updateUI({ tool: 'translate', frame: Date.now() })
}
const meshes = new Set(['glb', 'gltf', 'obj', 'stl', 'ply', 'pcd', 'xyz', 'splat', 'spz'])
export function validateGeometry(g: BufferGeometry) {
  const pos = g.getAttribute('position')
  if (!pos?.count) throw new Error('This asset contains no positions.')
  for (let i = 0; i < pos.array.length; i++)
    if (!Number.isFinite(pos.array[i]))
      throw new Error('Asset contains invalid vertex coordinates.')
  g.computeBoundingBox()
  g.computeBoundingSphere()
}
function estimate(g: BufferGeometry, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./normal-worker.ts', import.meta.url), { type: 'module' })
    const stop = () => {
      worker.terminate()
      reject(new DOMException('Import cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', stop, { once: true })
    worker.onmessage = (e) => {
      g.setAttribute('normal', new BufferAttribute(e.data.normals, 3))
      g.setAttribute('confidence', new BufferAttribute(e.data.confidence, 1))
      worker.terminate()
      signal.removeEventListener('abort', stop)
      resolve()
    }
    worker.onerror = (e) => {
      worker.terminate()
      signal.removeEventListener('abort', stop)
      reject(new Error(e.message))
    }
    const array = new Float32Array(g.getAttribute('position').array)
    worker.postMessage(array, [array.buffer])
  })
}
export async function loadAsset(
  record: AssetRecord,
  files: Map<string, File>,
  signal = new AbortController().signal
): Promise<RuntimeAsset> {
  const primary = files.get(record.primary)
  if (!primary) throw new Error(`Missing original file: ${record.primary}`)
  const urls = new Map<string, string>(),
    manager = new LoadingManager(),
    missing = new Set<string>()
  let resourcesPending = false,
    resourcesComplete: () => void = () => {}
  const resourcesReady = new Promise<void>((resolve) => (resourcesComplete = resolve))
  manager.onStart = () => {
    resourcesPending = true
  }
  manager.onLoad = resourcesComplete
  manager.onError = (url) => missing.add(url)
  for (const path of record.files) {
    const file = files.get(path)
    if (file) {
      const url = URL.createObjectURL(file)
      urls.set(path.toLowerCase(), url)
      urls.set((file.webkitRelativePath || file.name).toLowerCase(), url)
      if (!urls.has(file.name.toLowerCase())) urls.set(file.name.toLowerCase(), url)
    }
  }
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    const decoded = decodeURIComponent(url).replace(/\\/g, '/').replace(/^\.\//, '')
    const found =
      urls.get(decoded.toLowerCase()) ??
      [...urls.entries()].find(([path]) => path.endsWith('/' + decoded.toLowerCase()))?.[1] ??
      urls.get(decoded.split('/').pop()!.toLowerCase())
    if (!found) {
      missing.add(decoded)
      throw new Error(
        `Missing companion file “${decoded}”. Select the model and all buffers, textures and MTL files together.`
      )
    }
    return found
  })
  const bytes = await primary.arrayBuffer()
  signal.throwIfAborted()
  const ext = primary.name.split('.').pop()!.toLowerCase()
  let root: Object3D, proxy: Points | undefined
  try {
    if (record.kind === 'splat') {
      const splat = new SplatMesh({
        fileBytes: ext === 'ply' ? binaryGaussianPLY(bytes) : bytes,
        fileName: primary.name,
        lod: true,
        nonLod: true,
        onProgress: (e) =>
          updateUI({ busy: Math.min(0.85, 0.2 + 0.6 * (e.total ? e.loaded / e.total : 0.5)) })
      })
      await splat.initialized
      signal.throwIfAborted()
      root = splat
      const positions: number[] = [],
        normals: number[] = [],
        colors: number[] = [],
        confidence: number[] = [],
        scales: number[] = []
      const stride = Math.max(1, Math.ceil(splat.numSplats / 250000))
      splat.forEachSplat((i, c, s, q, opacity, color) => {
        if (i % stride || opacity < 0.25) return
        positions.push(c.x, c.y, c.z)
        const dims = [s.x, s.y, s.z],
          index = dims.indexOf(Math.min(...dims)),
          n = new Vector3(
            index === 0 ? 1 : 0,
            index === 1 ? 1 : 0,
            index === 2 ? 1 : 0
          ).applyQuaternion(q)
        normals.push(n.x, n.y, n.z)
        colors.push(color.r, color.g, color.b)
        confidence.push(Math.min(...dims) / Math.max(...dims) < 0.35 ? 1 : 0)
        scales.push(Math.max(...dims))
      })
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
      g.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
      g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
      g.setAttribute('confidence', new BufferAttribute(new Float32Array(confidence), 1))
      validateGeometry(g)
      proxy = new Points(g, new PointsMaterial({ size: 0.035, vertexColors: true }))
      Object.assign(g, { boundsTree: new PointsBVH(g) })
      proxy.raycast = acceleratedRaycast
      record.normals = 'estimated'
    } else if (ext === 'gltf' || ext === 'glb')
      root = (
        await new GLTFLoader(manager).parseAsync(
          ext === 'gltf' ? new TextDecoder().decode(bytes) : bytes,
          ''
        )
      ).scene
    else if (ext === 'obj') {
      const loader = new OBJLoader(manager),
        text = new TextDecoder().decode(bytes)
      for (const match of text.matchAll(/^mtllib\s+(.+)$/gm)) {
        const name = match[1].trim()
        const file = Array.from(files.values()).find(
          (f) => f.name.toLowerCase() === name.toLowerCase()
        )
        if (!file) throw new Error(`Missing MTL file “${name}”. Select companion files together.`)
        const mtl = new MTLLoader(manager).parse(await file.text(), '')
        mtl.preload()
        loader.setMaterials(mtl)
      }
      root = loader.parse(text)
    } else {
      let g: BufferGeometry
      if (ext === 'stl') g = new STLLoader().parse(bytes)
      else if (ext === 'ply') g = new PLYLoader().parse(bytes)
      else if (ext === 'pcd') g = new PCDLoader().parse(bytes).geometry
      else if (ext === 'xyz') {
        const positions: number[] = [],
          colors: number[] = []
        for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
          if (!line.trim() || line.trim().startsWith('#')) continue
          const v = line
            .trim()
            .split(/[\s,;]+/)
            .map(Number)
          if (v.length < 3 || v.slice(0, 3).some((v) => !Number.isFinite(v)))
            throw new Error('XYZ requires x y z on each line, optionally followed by r g b.')
          positions.push(...v.slice(0, 3))
          if (v.length >= 6) colors.push(...v.slice(3, 6).map((x) => (x > 1 ? x / 255 : x)))
        }
        g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
        if (colors.length === positions.length)
          g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
      } else throw new Error(`Unsupported format: ${ext}`)
      validateGeometry(g)
      if (record.kind === 'cloud') {
        // Uniform preview sampling bounds GPU memory while preserving original bytes.
        const count = g.getAttribute('position').count
        if (count > 1000000) {
          const sampled = new BufferGeometry(),
            stride = Math.ceil(count / 1000000)
          for (const [name, attribute] of Object.entries(g.attributes)) {
            const data: number[] = []
            for (let i = 0; i < count; i += stride)
              for (let j = 0; j < attribute.itemSize; j++)
                data.push(attribute.array[i * attribute.itemSize + j])
            sampled.setAttribute(
              name,
              new BufferAttribute(new Float32Array(data), attribute.itemSize)
            )
          }
          g.dispose()
          g = sampled
        }
        if (g.hasAttribute('normal')) {
          record.normals = 'imported'
          const n = g.getAttribute('normal'),
            c = new Float32Array(g.getAttribute('position').count)
          for (let i = 0; i < c.length; i++) {
            const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i))
            c[i] = Number.isFinite(length) && length > 1e-6 ? 1 : 0
          }
          g.normalizeNormals()
          g.setAttribute('confidence', new BufferAttribute(c, 1))
        } else {
          updateUI({ busyText: 'Estimating scan normals…', busy: 0.6 })
          await estimate(g, signal)
          record.normals = 'estimated'
        }
        root = new Points(
          g,
          new PointsMaterial({ vertexColors: g.hasAttribute('color'), size: 0.025 })
        )
        Object.assign(g, { boundsTree: new PointsBVH(g) })
        root.raycast = acceleratedRaycast
        proxy = root as Points
      } else {
        if (!g.hasAttribute('normal')) g.computeVertexNormals()
        root = new Mesh(
          g,
          new MeshStandardMaterial({ color: '#d0d0cc', vertexColors: g.hasAttribute('color') })
        )
        record.normals = 'imported'
      }
    }
    if (resourcesPending) await resourcesReady
    signal.throwIfAborted()
    root.traverse((object) => {
      if (object instanceof Mesh) {
        validateGeometry(object.geometry)
        if (!object.geometry.boundsTree) computeBoundsTree.call(object.geometry)
        object.raycast = acceleratedRaycast
      }
    })
    if (missing.size) throw new Error(`Missing companion files: ${[...missing].join(', ')}`)
    const wrapper = new Group()
    wrapper.add(root)
    if (record.upAxis === 'z') wrapper.rotation.x = -Math.PI / 2
    wrapper.scale.setScalar({ m: 1, cm: 0.01, mm: 0.001, ft: 0.3048 }[record.units])
    wrapper.updateMatrixWorld(true)
    return {
      record,
      root: wrapper,
      proxy,
      dispose: () => {
        root.traverse((o) => {
          if (o instanceof Mesh || o instanceof Points) {
            o.geometry.dispose()
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              for (const value of Object.values(m))
                if (value && typeof value === 'object' && 'isTexture' in value)
                  (value as unknown as { dispose: () => void }).dispose()
              m.dispose()
            }
          }
        })
        if (root instanceof SplatMesh) root.dispose()
        if (proxy && proxy !== root) {
          proxy.geometry.dispose()
          ;(proxy.material as PointsMaterial).dispose()
        }
      }
    }
  } finally {
    for (const url of new Set(urls.values())) URL.revokeObjectURL(url)
  }
}
let controller: AbortController | null = null
export function cancelImport() {
  controller?.abort()
}
export async function importFiles(
  input: File[],
  units: AssetRecord['units'] = 'm',
  upAxis: AssetRecord['upAxis'] = 'y'
) {
  if (controller) return
  controller = new AbortController()
  updateUI({ busy: 0.05, busyText: 'Reading local files…', error: '' })
  const added: RuntimeAsset[] = [],
    fileMap = new Map<string, File>(),
    records: AssetRecord[] = [],
    nodes: SceneNode[] = []
  try {
    const primaries = input.filter((f) => meshes.has(f.name.split('.').pop()!.toLowerCase()))
    if (!primaries.length)
      throw new Error(
        'Choose GLB, glTF, OBJ, STL, PLY, PCD, XYZ, SPLAT or SPZ, with companion files.'
      )
    for (let i = 0; i < primaries.length; i++) {
      const file = primaries[i],
        ext = file.name.split('.').pop()!.toLowerCase(),
        id = uid()
      updateUI({ busy: (i + 0.1) / primaries.length, busyText: `Importing ${file.name}…` })
      const kind: AssetKind =
        ext === 'ply'
          ? classifyPLY(await file.arrayBuffer())
          : ext === 'pcd' || ext === 'xyz'
            ? 'cloud'
            : ext === 'splat' || ext === 'spz'
              ? 'splat'
              : 'mesh'
      const companions = ext === 'obj' || ext === 'gltf' ? input : [file]
      const paths = companions.map((f) => `assets/${id}/${f.webkitRelativePath || f.name}`)
      companions.forEach((f, j) => fileMap.set(paths[j], f))
      const record: AssetRecord = {
        id,
        name: file.name,
        kind,
        files: paths,
        primary: `assets/${id}/${file.webkitRelativePath || file.name}`,
        units,
        upAxis,
        normals: 'unavailable',
        originalBytes: companions.reduce((n, f) => n + f.size, 0)
      }
      const runtime = await loadAsset(record, fileMap, controller.signal)
      added.push(runtime)
      records.push(record)
      nodes.push(assetNode(record))
    }
    controller.signal.throwIfAborted()
    for (const runtime of added) runtimeAssets.set(runtime.record.id, runtime)
    for (const [path, file] of fileMap) originalFiles.set(path, file)
    commit(`Imported ${records.length} asset${records.length > 1 ? 's' : ''}`, (d) => {
      d.assets.push(...records)
      d.nodes.push(...nodes)
    })
    select(nodes[0].id)
    updateUI({ frame: Date.now() })
  } catch (e) {
    added.forEach((a) => a.dispose())
    updateUI({ error: e instanceof Error ? e.message : String(e) })
  } finally {
    controller = null
    updateUI({ busy: null, busyText: '' })
  }
}
export async function importImage(file: File, projectorId: string) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Projection images must be PNG, JPEG or WebP.')
  const bitmap = await createImageBitmap(file)
  bitmap.close()
  const id = uid(),
    path = `assets/${id}/${file.name}`
  originalFiles.set(path, file)
  commit('Imported projection image', (d) => {
    d.assets.push({
      id,
      name: file.name,
      kind: 'image',
      files: [path],
      primary: path,
      units: 'm',
      upAxis: 'y',
      normals: 'unavailable',
      originalBytes: file.size
    })
    const p = d.projectors.find((p) => p.id === projectorId)
    if (p) {
      p.imageId = id
      p.pattern = 'image'
    }
  })
}
