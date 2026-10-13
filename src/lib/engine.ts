import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  Raycaster,
  RGBADepthPacking,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Material
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { get, writable } from 'svelte/store'
import { editor, commit, select, updateUI, type EditorState } from './store'
import { runtimeAssets } from './assets'
import { ProjectionSystem } from './projection'
import { analysisProjectors } from './analysis'
import { projectorHeight, type HeightOverlay } from './height-measurement'
import { SelectionOutline } from './selection-outline'
import { selectionPivot, transformSelection } from './selection-transform'
import { aimRotation, pixelFootprint, projectionEnvelope, projectorCamera } from './optics'
import type { AnalysisSample, ProjectorConfig, SceneNode, Transform, Vec3 } from './types'

interface RuntimeNode {
  group: Group
  depth: Group
  key: string
  materialKey: string
  ownedGeometry: boolean
  splat?: {
    mesh: SplatMesh
    uniforms: ReturnType<ProjectionSystem['splatUniforms']>
  }
}
function layers(object: Object3D, layer: number) {
  object.traverse((o) => o.layers.set(layer))
}
function apply(object: Object3D, t: Transform) {
  object.position.fromArray(t.position)
  object.quaternion.fromArray(t.rotation)
  object.scale.fromArray(t.scale)
  object.updateMatrixWorld(true)
}
function read(object: Object3D): Transform {
  return {
    position: object.position.toArray(),
    rotation: object.quaternion.toArray(),
    scale: object.scale.toArray()
  }
}
function release(object: Object3D, geometry = true) {
  object.traverse((o) => {
    if (o instanceof Mesh || o instanceof Points || o instanceof LineSegments) {
      if (geometry) o.geometry.dispose()
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
    }
    if (o instanceof SplatMesh) {
      if (o.userData.sharedSource) {
        o.splats = undefined
        o.packedSplats = undefined
        o.extSplats = undefined
      }
      o.dispose()
    }
  })
  object.removeFromParent()
}
const pointDepth = () =>
  new ShaderMaterial({
    vertexShader:
      'void main(){vec4 v=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(32./max(.1,-v.z),2.,12.);}',
    fragmentShader: `${ShaderChunk.packing}\nvoid main(){if(length(gl_PointCoord-.5)>.45)discard;gl_FragColor=packDepthToRGBA(gl_FragCoord.z);}`
  })
export let currentViewport: ViewportEngine | undefined
const defaultSplatPixelSize = 2
const defaultSplatScale = 0.4

export class ViewportEngine {
  controls: OrbitControls
  transform: TransformControls
  projection = new ProjectionSystem()
  depthScene = new Scene()
  nodes = new Map<string, RuntimeNode>()
  projectors = new Map<string, Group>()
  projectorKeys = new Map<string, string>()
  helpers = new Group()
  selection = new SelectionOutline()
  calibrationHelpers = new Group()
  calibrationKey = ''
  heightMeasurements = writable<HeightOverlay[]>([])
  heightMeasurementKey = ''
  spark: SparkRenderer
  dirtyDepth = true
  dirtySplats = true
  depthTileKeys: string[] = []
  state: EditorState = get(editor)
  unsubscribe: () => void
  depthKey = ''
  frameKey = 0
  ortho = false
  dragStart: Transform | null = null
  dragObjects = new Map<string, Transform>()
  selectionGroup = new Group()
  raycaster = new Raycaster()
  down = new Vector2()
  manipulationMode: 'translate' | 'rotate' | 'scale' = 'translate'
  pointerManipulated = false
  manipulating = false
  previewRatio = Math.min(1, window.devicePixelRatio)
  splatPixelSize = defaultSplatPixelSize
  slowFrames = 0
  disposed = false
  fpsFrames = 0
  fpsStart = performance.now()
  frameDuration = 0
  constructor(
    public scene: Scene,
    public renderer: WebGLRenderer,
    public camera: PerspectiveCamera | OrthographicCamera,
    public invalidate: () => void,
    public setCamera: (camera: PerspectiveCamera | OrthographicCamera) => void,
    public controlsChanged: (controls: OrbitControls) => void
  ) {
    currentViewport = this
    if (import.meta.env.DEV) Object.assign(window, { __TMP_VIEWPORT__: this })
    camera.position.set(10, 8, 12)
    camera.layers.enableAll()
    scene.background = new Color('#181c23')
    this.controls = new OrbitControls(camera, renderer.domElement)
    this.controls.target.set(0, 1.5, 1)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxDistance = 10000
    this.controls.minDistance = 0.05
    this.controls.mouseButtons.MIDDLE = MOUSE.PAN
    this.controls.mouseButtons.RIGHT = MOUSE.DOLLY
    this.controls.update()
    this.transform = new TransformControls(camera, renderer.domElement)
    this.transform.setSize(0.85)
    layers(this.transform.getHelper(), 2)
    this.transform.getRaycaster().layers.set(2)
    this.transform.addEventListener('change', this.onCamera)
    scene.add(this.transform.getHelper())
    scene.add(this.selectionGroup)
    this.helpers.layers.set(1)
    scene.add(this.helpers)
    const ambient = new AmbientLight('#ffffff', 1)
    scene.add(ambient)
    this.helpers.add(this.calibrationHelpers)
    this.spark = new SparkRenderer({
      renderer,
      onDirty: invalidate,
      lodSplatScale: defaultSplatScale,
      // Picking uses our BVH proxy; Spark's separate raycast LOD is unused.
      lodRaycast: 0
    })
    this.setRenderRatio(Math.min(1.75, window.devicePixelRatio))
    scene.add(this.spark)
    this.controls.addEventListener('change', this.onCamera)
    this.controls.addEventListener('start', this.lowQuality)
    this.controls.addEventListener('end', this.fullQuality)
    this.transform.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value
      if (event.value) {
        this.pointerManipulated = true
        this.dragStart = this.transform.object ? read(this.transform.object) : null
        this.dragObjects = new Map(
          [...this.state.doc.nodes, ...this.state.doc.projectors]
            .filter((o) => !o.locked && this.state.selectedIds.includes(o.id))
            .map((o) => [o.id, structuredClone(o.transform)])
        )
        this.lowQuality()
      } else {
        if (this.transform.object && this.dragStart) {
          const t = read(this.transform.object),
            start = this.dragStart
          if (t.scale.every((v) => v > 0) && JSON.stringify(t) !== JSON.stringify(this.dragStart))
            commit(
              this.dragObjects.size > 1 ? 'Transformed selection' : 'Transformed object',
              (d) => {
                for (const obj of [...d.nodes, ...d.projectors]) {
                  const original = this.dragObjects.get(obj.id)
                  if (original && !obj.locked)
                    obj.transform =
                      this.dragObjects.size > 1
                        ? transformSelection(original, start, t, !('spec' in obj))
                        : t
                }
              }
            )
          else {
            this.sync()
            this.dirtyDepth = true
          }
        }
        this.dragStart = null
        this.dragObjects.clear()
        this.fullQuality()
      }
    })
    this.transform.addEventListener('objectChange', () => {
      const node = this.state.doc.nodes.find((n) => n.id === this.state.selected)
      if (
        (node?.kind === 'splat' || this.dragObjects.size > 1) &&
        this.transform.getMode() === 'scale' &&
        this.transform.object &&
        this.dragStart
      ) {
        const values = this.transform.object.scale.toArray(),
          base = this.dragStart.scale,
          axis = values
            .map((v, i) => Math.abs(v / base[i] - 1))
            .indexOf(Math.max(...values.map((v, i) => Math.abs(v / base[i] - 1))))
        if (this.dragObjects.size > 1)
          this.transform.object.scale.fromArray(
            base.map((v) => (v * values[axis]) / base[axis]) as Vec3
          )
        else this.transform.object.scale.setScalar(values[axis])
      }
      if (this.dragObjects.size > 1 && this.dragStart && this.transform.object) {
        const pivot = read(this.transform.object)
        for (const [id, original] of this.dragObjects) {
          const group = this.nodes.get(id)?.group ?? this.projectors.get(id)
          if (group)
            apply(
              group,
              transformSelection(original, this.dragStart, pivot, !this.projectors.has(id))
            )
        }
      }
      this.dirtyDepth = true
      this.invalidate()
    })
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', this.pointerDown)
    canvas.addEventListener('pointerup', this.pointerUp)
    canvas.addEventListener('contextmenu', this.contextMenu)
    canvas.addEventListener('webglcontextlost', this.contextLost)
    canvas.addEventListener('webglcontextrestored', this.contextRestored)
    window.addEventListener('blur', this.blur)
    this.raycaster.params.Points.threshold = 0.045
    Object.assign(this.raycaster, { firstHitOnly: true })
    let initialized = false
    this.unsubscribe = editor.subscribe((s) => {
      const old = this.state
      this.state = s
      if (s.documentGeneration !== old.documentGeneration) this.projection.cameras.stopAll()
      if (s.interacting !== old.interacting) {
        if (s.interacting) this.lowQuality()
        else this.fullQuality()
      }
      if (s.doc.settings.dynamicRenderingQuality !== old.doc.settings.dynamicRenderingQuality)
        this.updateRenderQuality()
      if (
        !initialized ||
        s.doc !== old.doc ||
        s.selected !== old.selected ||
        s.selectedIds !== old.selectedIds ||
        s.tool !== old.tool ||
        s.frame !== old.frame ||
        s.orthographic !== old.orthographic ||
        s.calibration !== old.calibration ||
        s.calibrationPreview !== old.calibrationPreview
      ) {
        initialized = true
        this.sync()
      }
    })
    this.controlsChanged(this.controls)
  }
  onCamera = () => this.invalidate()
  onProjectionChange = () => {
    this.dirtySplats = true
    this.invalidate()
  }
  lowQuality = () => {
    if (this.manipulating) return
    this.manipulating = true
    this.slowFrames = 0
    this.updateRenderQuality()
  }
  fullQuality = () => {
    this.manipulating = false
    this.updateRenderQuality()
  }
  updateRenderQuality() {
    const dynamic = this.state.doc.settings.dynamicRenderingQuality
    if (!dynamic) {
      this.previewRatio = Math.min(1, window.devicePixelRatio)
      this.splatPixelSize = defaultSplatPixelSize
      this.spark.lodSplatScale = defaultSplatScale
      this.slowFrames = 0
    }
    this.setRenderRatio(
      Math.min(dynamic && this.manipulating ? this.previewRatio : 1.75, window.devicePixelRatio)
    )
    this.invalidate()
  }
  setRenderRatio(ratio: number) {
    // Keep the scan's LOD in CSS pixels across raster-resolution changes.
    // Rebuilding a full-detail mapping on release left it on screen for hundreds
    // of milliseconds on the next drag, waiting for a new mapping and sort.
    // Retain the working splat budget and learned preview quality between drags.
    this.spark.lodRenderScale = this.splatPixelSize * ratio
    // Even setting the same ratio resizes Three's canvas/drawing buffer.
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio)
  }
  contextMenu = (e: Event) => e.preventDefault()
  contextLost = (e: Event) => {
    e.preventDefault()
    updateUI({
      contextLost: true,
      error:
        'WebGL context lost. Your document is preserved. Save your project or wait for recovery.'
    })
  }
  contextRestored = () => {
    this.dirtyDepth = true
    this.depthTileKeys = []
    this.projection.media.needsUpdate = true
    updateUI({ contextLost: false, error: '', notice: 'Graphics context restored' })
    this.invalidate()
  }
  blur = () => {
    if (this.transform.dragging) this.transform.pointerUp(null)
    this.controls.enabled = true
    this.fullQuality()
  }
  pointerDown = (e: PointerEvent) => {
    this.down.set(e.clientX, e.clientY)
    this.pointerManipulated = this.transform.dragging
  }
  pointerUp = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      this.pointerManipulated ||
      this.transform.dragging ||
      this.transform.axis ||
      this.down.distanceTo(new Vector2(e.clientX, e.clientY)) > 4
    )
      return
    this.pick(e)
  }
  pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(
      new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1
      ),
      this.camera
    )
    const receivers = [...this.nodes.values()].map((n) => n.group).filter((g) => g.visible),
      hits = this.raycaster.intersectObjects(receivers, true),
      surface = hits.find((h) => this.nodeId(h.object))
    const lockedIds = new Set(
      [...this.state.doc.nodes, ...this.state.doc.projectors]
        .filter((o) => o.locked)
        .map((o) => o.id)
    )
    if (this.state.tool === 'height-reference') {
      const projector = this.state.doc.projectors.find((p) => p.id === this.state.selected)
      if (!projector || projector.locked) return
      const nodeId = surface && this.nodeId(surface.object)
      const group = nodeId && this.nodes.get(nodeId)?.group
      if (!surface || !nodeId || !group) {
        updateUI({ error: 'Pick a point on a visible surface, or choose Ground in Height measurement.' })
        return
      }
      const point = group.worldToLocal(surface.point.clone()).toArray() as Vec3
      commit('Height reference point picked', (doc) => {
        doc.projectors.find((p) => p.id === projector.id)!.heightMeasurement = {
          visible: true,
          reference: { nodeId, point }
        }
      })
      updateUI({ tool: 'select', error: '' })
      return
    }
    if (this.state.tool === 'probe' && surface) {
      updateUI({ probe: this.probe(surface) })
      return
    }
    if (this.state.tool === 'calibrate' && surface) {
      const id = this.nodeId(surface.object)
      if (id === null || id !== this.state.selected || lockedIds.has(id)) {
        updateUI({ error: 'Pick both points on the selected imported asset.' })
        return
      }
      if (this.state.calibration.length < 2)
        updateUI({
          calibration: [...this.state.calibration, surface.point.toArray() as Vec3],
          notice: 'Calibration point picked'
        })
      return
    }
    if (this.state.tool === 'aim' && surface) {
      const p = this.state.doc.projectors.find((p) => p.id === this.state.selected)
      if (p && !p.locked) {
        commit('Aimed projector', (d) => {
          d.projectors.find((x) => x.id === p.id)!.transform.rotation = aimRotation(
            p.transform.position,
            surface.point.toArray() as Vec3
          )
        })
        updateUI({ tool: 'select' })
      }
      return
    }
    this.raycaster.layers.enableAll()
    const selectableSurface = hits.find((h) => {
      const id = this.nodeId(h.object)
      return id && !lockedIds.has(id)
    })
    const projectorHit = this.raycaster
      .intersectObjects(
        [...this.projectors.entries()]
          .filter(([id]) => !lockedIds.has(id))
          .map(([, group]) => group),
        true
      )
      .find((h) => h.object.userData.projectorId)
    this.raycaster.layers.set(0)
    if (projectorHit && (!selectableSurface || projectorHit.distance < selectableSurface.distance))
      select(projectorHit.object.userData.projectorId, {
        toggle: event.ctrlKey || event.metaKey || event.shiftKey
      })
    else
      select(selectableSurface ? this.nodeId(selectableSurface.object) : null, {
        toggle: event.ctrlKey || event.metaKey || event.shiftKey
      })
  }
  placementPoint(clientX: number, clientY: number): Vec3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(
      new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((clientY - rect.top) / rect.height) * 2
      ),
      this.camera
    )
    const receivers = [...this.nodes.values()].filter((n) => n.group.visible).map((n) => n.group),
      surface = this.raycaster.intersectObjects(receivers, true)[0],
      point =
        surface?.point.clone() ??
        this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0)), new Vector3())
    if (!point) return null
    if (this.state.doc.settings.snap) point.divideScalar(0.1).round().multiplyScalar(0.1)
    return point.toArray()
  }
  nodeId(object: Object3D): string | null {
    let o: Object3D | null = object
    while (o) {
      if (o.userData.nodeId) return o.userData.nodeId
      o = o.parent
    }
    return null
  }
  createNode(node: SceneNode): RuntimeNode {
    const group = new Group(),
      depth = new Group()
    group.userData.nodeId = node.id
    let root: Object3D,
      ownedGeometry = !node.assetId
    let splatRuntime: RuntimeNode['splat']
    const asset = node.assetId ? runtimeAssets.get(node.assetId) : null
    if (asset) {
      const originalSplat = asset.root.children.find((o) => o instanceof SplatMesh) as
        SplatMesh | undefined
      if (originalSplat) {
        root = new Group()
        root.rotation.copy(asset.root.rotation)
        root.scale.copy(asset.root.scale)
        const uniforms = this.projection.splatUniforms(node.material, node.gaussian?.size ?? 1)
        const splat = new SplatMesh({
          packedSplats: originalSplat.packedSplats,
          splatEncoding: originalSplat.packedSplats?.splatEncoding,
          extSplats: originalSplat.extSplats ?? false,
          enableLod: true,
          editable: false,
          raycastable: false,
          worldModifier: this.projection.splatModifier(node.material, uniforms)
        })
        splatRuntime = { mesh: splat, uniforms }
        splat.userData.sharedSource = true
        root.add(splat)
        if (asset.proxy) {
          const proxy = asset.proxy.clone()
          proxy.visible = false
          proxy.userData.splatProxy = true
          root.add(proxy)
          const d = asset.root.clone(false)
          const points = asset.proxy.clone()
          points.material = pointDepth()
          d.add(points)
          depth.add(d)
        }
      } else root = asset.root.clone(true)
    } else {
      const [x, y, z] = node.dimensions,
        g =
          node.kind === 'plane'
            ? new PlaneGeometry(x, y)
            : node.kind === 'cylinder'
              ? new CylinderGeometry(x / 2, x / 2, y, 48)
              : new BoxGeometry(x, y, z)
      root = new Mesh(g, new MeshBasicMaterial({ color: 'white' }))
    }
    group.add(root)
    root.traverse((o) => {
      if ((o instanceof Mesh || o instanceof Points) && o.geometry.boundsTree)
        o.raycast = acceleratedRaycast
    })
    if (!depth.children.length) {
      const copy = root.clone(true)
      copy.traverse((o) => {
        if (o instanceof Mesh)
          o.material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
        if (o instanceof Points) o.material = pointDepth()
      })
      depth.add(copy)
    }
    depth.traverse((o) => {
      if ((o instanceof Mesh || o instanceof Points) && o.geometry.boundsTree)
        o.raycast = acceleratedRaycast
    })
    this.scene.add(group)
    this.depthScene.add(depth)
    return {
      group,
      depth,
      key: JSON.stringify([node.kind, node.assetId, node.dimensions, asset?.root.uuid]),
      materialKey: '',
      ownedGeometry,
      splat: splatRuntime
    }
  }
  sync() {
    if (this.disposed) return
    const { doc, selected, tool } = this.state
    for (const [id, runtime] of this.nodes)
      if (!doc.nodes.some((n) => n.id === id)) {
        release(runtime.group, runtime.ownedGeometry)
        release(runtime.depth, false)
        this.nodes.delete(id)
      }
    for (const node of doc.nodes) {
      const key = JSON.stringify([
        node.kind,
        node.assetId,
        node.dimensions,
        node.assetId ? runtimeAssets.get(node.assetId)?.root.uuid : undefined
      ])
      let runtime = this.nodes.get(node.id)
      if (runtime && runtime.key !== key) {
        release(runtime.group, runtime.ownedGeometry)
        release(runtime.depth, false)
        this.nodes.delete(node.id)
        runtime = undefined
      }
      if (!runtime) {
        runtime = this.createNode(node)
        this.nodes.set(node.id, runtime)
      }
      const transform =
        !node.locked && node.id === selected && this.state.calibrationPreview
          ? this.state.calibrationPreview
          : node.transform
      apply(runtime.group, transform)
      apply(runtime.depth, transform)
      runtime.group.visible = runtime.depth.visible = node.visible
      const materialKey = JSON.stringify(node.material)
      if (runtime.materialKey !== materialKey) {
        runtime.materialKey = materialKey
        runtime.group.traverse((o) => {
          if (o instanceof Mesh) {
            const source = o.userData.originalMaterial ?? o.material
            o.userData.originalMaterial = source
            if (o.userData.projected) (o.material as Material).dispose()
            o.material = this.projection.meshMaterial(source, node.material)
            o.userData.projected = true
          } else if (o instanceof Points && !o.userData.splatProxy) {
            if (o.userData.projected) (o.material as Material).dispose()
            o.material = this.projection.pointsMaterial(
              node.material,
              o.geometry.hasAttribute('color')
            )
            o.userData.projected = true
          }
        })
      }
      if (runtime.splat) {
        const { mesh, uniforms } = runtime.splat,
          size = node.gaussian?.size ?? 1,
          opacity = node.gaussian?.opacity ?? 1,
          color = new Color(node.material.color)
        if (
          uniforms.tmpSplatSize.value !== size ||
          mesh.opacity !== opacity ||
          !uniforms.tmpSplatBase.value.equals(color) ||
          uniforms.tmpSplatReflectance.value !== node.material.reflectance ||
          uniforms.tmpSplatTransmission.value !== node.material.transmission
        ) {
          uniforms.tmpSplatSize.value = size
          uniforms.tmpSplatBase.value.copy(color)
          uniforms.tmpSplatReflectance.value = node.material.reflectance
          uniforms.tmpSplatTransmission.value = node.material.transmission
          mesh.opacity = opacity
          mesh.updateVersion()
        }
      }
    }
    for (const [id, group] of this.projectors)
      if (!doc.projectors.some((p) => p.id === id)) {
        release(group)
        this.projectors.delete(id)
        this.projectorKeys.delete(id)
      }
    for (const p of doc.projectors) {
      const key = JSON.stringify([
        p.throwRatio,
        p.shift,
        p.extent,
        p.showVolume,
        p.showOutline,
        doc.settings.volumeOpacity,
        doc.settings.outlineOpacity,
        p.color,
        p.enabled,
        p.spec.resolution,
        p.spec.shift,
        p.id === selected
      ])
      let group = this.projectors.get(p.id)
      if (!group || this.projectorKeys.get(p.id) !== key) {
        if (group) release(group)
        group = this.createProjector(p)
        this.projectors.set(p.id, group)
        this.projectorKeys.set(p.id, key)
      }
      apply(group, p.transform)
    }
    if (this.projection.update(doc, this.state.selectedIds, this.onProjectionChange))
      this.dirtySplats = true
    const depthKey = JSON.stringify([
      doc.nodes.map((n) => [n.id, n.transform, n.visible, this.nodes.get(n.id)?.key]),
      doc.projectors
        .filter((p) => p.enabled)
        .map((p) => [p.id, p.transform, p.throwRatio, p.shift, p.extent, p.spec.resolution]),
      this.state.calibrationPreview
    ])
    if (depthKey !== this.depthKey) {
      this.depthKey = depthKey
      this.dirtyDepth = true
    }
    const calibrationKey = JSON.stringify(this.state.calibration)
    if (calibrationKey !== this.calibrationKey) {
      this.calibrationKey = calibrationKey
      for (const child of [...this.calibrationHelpers.children]) release(child)
      const positions: number[] = []
      for (const point of this.state.calibration) {
        const dot = new Mesh(
          new SphereGeometry(0.04, 12, 8),
          new MeshBasicMaterial({ color: '#d3ff97', depthTest: false })
        )
        dot.position.fromArray(point)
        this.calibrationHelpers.add(dot)
        positions.push(...point)
      }
      if (positions.length === 6) {
        const g = new BufferGeometry()
        g.setAttribute('position', new Float32BufferAttribute(positions, 3))
        this.calibrationHelpers.add(
          new LineSegments(g, new LineBasicMaterial({ color: '#b8ed7a', depthTest: false }))
        )
      }
      layers(this.calibrationHelpers, 1)
    }
    const selectedObjects = [...doc.projectors, ...doc.nodes].filter(
      (o) => !o.locked && this.state.selectedIds.includes(o.id)
    )
    const targets = selectedObjects
      .map((o) => this.nodes.get(o.id)?.group ?? this.projectors.get(o.id))
      .filter((o): o is Group => !!o)
    const multiple = selectedObjects.length > 1
    if (multiple) {
      apply(this.selectionGroup, selectionPivot(selectedObjects.map((o) => o.transform)))
      this.selectionGroup.visible = targets.some((o) => o.visible)
    }
    const target = multiple ? this.selectionGroup : targets[0]
    if (['translate', 'rotate', 'scale'].includes(tool))
      this.manipulationMode = tool as 'translate' | 'rotate' | 'scale'
    if (target?.visible) {
      if (this.transform.object !== target) this.transform.attach(target)
      this.transform.setMode(
        !multiple && this.manipulationMode === 'scale' && this.projectors.has(selected ?? '')
          ? 'translate'
          : this.manipulationMode
      )
      this.transform.setSpace(this.manipulationMode === 'rotate' ? 'local' : 'world')
      this.transform.setTranslationSnap(doc.settings.snap ? 0.1 : null)
      this.transform.setRotationSnap(doc.settings.snap ? Math.PI / 12 : null)
      this.transform.setScaleSnap(doc.settings.snap ? 0.1 : null)
    } else this.transform.detach()
    this.transform.enabled = tool !== 'height-reference'
    if (tool === 'height-reference') this.transform.axis = null
    this.transform.getHelper().visible = !!target?.visible && tool !== 'height-reference'
    // Highlight only the projector body, leaving frustum helpers out of the silhouette.
    this.selection.setTargets(
      selectedObjects.flatMap((o) => {
        const outline = this.nodes.get(o.id)?.group ?? this.projectors.get(o.id)?.children[0]
        return outline ? [outline] : []
      })
    )
    if (this.ortho !== this.state.orthographic) this.switchCamera(this.state.orthographic)
    if (this.state.frame !== this.frameKey) {
      this.frameKey = this.state.frame
      this.frame()
    }
    this.invalidate()
  }
  createProjector(p: ProjectorConfig) {
    const group = new Group(),
      body = new Mesh(
        new BoxGeometry(0.35, 0.18, 0.28),
        new MeshBasicMaterial({ color: p.enabled ? '#697382' : '#353a44' })
      )
    body.position.z = 0.14
    body.userData.projectorId = p.id
    group.add(body)
    const lens = new Mesh(
      new CylinderGeometry(0.055, 0.055, 0.05, 24),
      new MeshBasicMaterial({ color: p.color })
    )
    lens.rotation.x = Math.PI / 2
    lens.userData.projectorId = p.id
    group.add(lens)
    if (p.enabled && (p.showOutline || p.showVolume)) {
      const camera = projectorCamera({
          ...p,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
        }),
        corners = [
          new Vector3(-1, -1, 1),
          new Vector3(1, -1, 1),
          new Vector3(1, 1, 1),
          new Vector3(-1, 1, 1)
        ].map((v) => v.unproject(camera))
      if (p.showOutline) {
        const vertices: number[] = []
        for (let i = 0; i < 4; i++) {
          vertices.push(
            0,
            0,
            0,
            ...corners[i].toArray(),
            ...corners[i].toArray(),
            ...corners[(i + 1) % 4].toArray()
          )
        }
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
        group.add(
          new LineSegments(
            geometry,
            new LineBasicMaterial({
              color: p.color,
              transparent: true,
              opacity: this.state.doc.settings.outlineOpacity
            })
          )
        )
      }
      if (p.showVolume) {
        const positions: number[] = []
        for (let i = 0; i < 4; i++)
          positions.push(0, 0, 0, ...corners[i].toArray(), ...corners[(i + 1) % 4].toArray())
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
        const volume = new Mesh(
          geometry,
          new MeshBasicMaterial({
            color: p.color,
            opacity: this.state.doc.settings.volumeOpacity,
            transparent: true,
            depthWrite: false,
            side: DoubleSide
          })
        )
        volume.renderOrder = 2
        group.add(volume)
      }
    }
    if (p.enabled && p.id === this.state.selected && (p.showOutline || p.showVolume))
      group.add(this.createShiftEnvelope(p))
    layers(group, 1)
    this.helpers.add(group)
    return group
  }
  createShiftEnvelope(p: ProjectorConfig) {
    const group = new Group(),
      corners = projectionEnvelope(p)
    group.name = 'lens-shift-envelope'
    const edges: number[] = [],
      faces: number[] = []
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i],
        b = corners[(i + 1) % corners.length]
      edges.push(...a.toArray(), ...b.toArray())
      // Curved limits need many rim segments. Keep just four guide rays plus
      // sharp corners so the envelope stays readable instead of becoming a cage.
      const previous = corners[(i + corners.length - 1) % corners.length]
      const incoming = a.clone().sub(previous).normalize(),
        outgoing = b.clone().sub(a).normalize()
      if (i % Math.ceil(corners.length / 4) === 0 || incoming.dot(outgoing) < 0.98)
        edges.push(0, 0, 0, ...a.toArray())
      faces.push(0, 0, 0, ...a.toArray(), ...b.toArray())
    }
    const { outlineOpacity, volumeOpacity } = this.state.doc.settings
    if (p.showOutline) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(edges, 3))
      const outline = new LineSegments(
        geometry,
        new LineDashedMaterial({
          color: '#70c8f2',
          transparent: true,
          opacity: outlineOpacity,
          depthWrite: false,
          dashSize: 0.12,
          gapSize: 0.08
        })
      )
      outline.computeLineDistances()
      group.add(outline)
    }
    if (p.showVolume) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(faces, 3))
      const volume = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: '#70c8f2',
          opacity: volumeOpacity * 0.5,
          transparent: true,
          depthWrite: false,
          side: DoubleSide
        })
      )
      volume.renderOrder = 1
      group.add(volume)
    }
    return group
  }
  switchCamera(orthographic: boolean) {
    const old = this.camera,
      aspect =
        this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight),
      distance = old.position.distanceTo(this.controls.target),
      height =
        old instanceof PerspectiveCamera
          ? 2 * distance * Math.tan((old.fov * Math.PI) / 360)
          : old.top - old.bottom
    const camera = orthographic
      ? new OrthographicCamera(
          (-height * aspect) / 2,
          (height * aspect) / 2,
          height / 2,
          -height / 2,
          0.01,
          10000
        )
      : new PerspectiveCamera(45, aspect, 0.01, 10000)
    camera.position.copy(old.position)
    camera.quaternion.copy(old.quaternion)
    camera.layers.enableAll()
    this.camera = camera
    this.controls.object = camera
    this.transform.camera = camera
    this.setCamera(camera)
    this.ortho = orthographic
    this.controls.update()
  }
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    if (this.camera instanceof PerspectiveCamera) this.camera.aspect = width / height
    else {
      const h = (this.camera.top - this.camera.bottom) / 2
      this.camera.left = (-h * width) / height
      this.camera.right = (h * width) / height
    }
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }
  frame(home = false) {
    const targets = home
      ? []
      : this.state.selectedIds
          .map((id) => this.nodes.get(id)?.group ?? this.projectors.get(id))
          .filter((o): o is Group => !!o && o.visible)
    const target = targets.length > 0
    const box = target ? new Box3() : new Box3().setFromObject(this.scene)
    for (const object of targets) box.expandByObject(object)
    if (box.isEmpty()) return
    const center = target ? box.getCenter(new Vector3()) : new Vector3(0, 1.5, 1),
      radius = target ? Math.max(1, box.getSize(new Vector3()).length()) : 12,
      direction = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(direction, radius * 1.2)
    if (this.camera instanceof OrthographicCamera) {
      const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight
      this.camera.top = radius / 2
      this.camera.bottom = -radius / 2
      this.camera.left = (-radius * aspect) / 2
      this.camera.right = (radius * aspect) / 2
      this.camera.zoom = 1
      this.camera.updateProjectionMatrix()
    }
    this.controls.update()
    this.invalidate()
  }
  tick(delta: number) {
    if (this.disposed || this.state.contextLost) return
    this.controls.update()
    this.updateHeightMeasurements()
    if (this.manipulating && this.state.doc.settings.dynamicRenderingQuality) {
      this.slowFrames = delta > 1 / 50 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1)
      if (this.slowFrames >= 6 && (this.previewRatio > 0.5 || this.spark.lodSplatScale > 0.1)) {
        this.previewRatio = Math.max(0.5, this.previewRatio * 0.8)
        this.spark.lodSplatScale = Math.max(0.1, this.spark.lodSplatScale * 0.75)
        this.splatPixelSize = Math.min(8, this.splatPixelSize * 1.5)
        this.setRenderRatio(this.previewRatio)
        this.slowFrames = 0
        this.invalidate()
      }
    }
    if (this.transform.dragging && this.transform.object && this.dirtyDepth) {
      for (const id of this.state.selectedIds) {
        const node = this.nodes.get(id)
        if (node) apply(node.depth, read(node.group))
      }
      if (this.state.doc.projectors.some((p) => this.state.selectedIds.includes(p.id))) {
        const doc = {
          ...this.state.doc,
          projectors: this.state.doc.projectors.map((x) =>
            this.state.selectedIds.includes(x.id) && this.projectors.has(x.id)
              ? { ...x, transform: read(this.projectors.get(x.id)!) }
              : x
          )
        }
        if (this.projection.update(doc, this.state.selectedIds, this.onProjectionChange))
          this.dirtySplats = true
      }
      this.dirtyDepth = true
    }
    if (this.dirtyDepth) this.renderDepth(false)
    // External uniforms and the depth atlas are baked into Spark's generated colors.
    // Refresh after depth rendering, including live projector gizmo movement.
    if (this.dirtySplats) {
      for (const runtime of this.nodes.values()) runtime.splat?.mesh.updateVersion()
      this.dirtySplats = false
    }
    const now = performance.now()
    if (now - this.fpsStart > 1500) {
      const extension = this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')
      updateUI({
        stats: {
          fps: this.frameDuration ? Math.round(1000 / this.frameDuration) : 0,
          primitives: [...this.nodes.values()].reduce((n, r) => {
            r.group.traverse((o) => {
              if (o instanceof Mesh || o instanceof Points)
                n += o.geometry.getAttribute('position')?.count ?? 0
              if (o instanceof SplatMesh) n += o.numSplats
            })
            return n
          }, 0),
          gpu: extension
            ? this.renderer.getContext().getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : 'WebGL2'
        }
      })
      this.fpsStart = now
    }
  }
  renderDepth(force = true) {
    this.dirtyDepth = false
    const renderer = this.renderer,
      depth = this.projection.depth,
      oldTarget = renderer.getRenderTarget(),
      oldCubeFace = renderer.getActiveCubeFace(),
      oldMipmapLevel = renderer.getActiveMipmapLevel(),
      viewport = depth.viewport.clone(),
      scissor = depth.scissor.clone(),
      scissorTest = depth.scissorTest,
      clear = renderer.getClearColor(new Color()),
      alpha = renderer.getClearAlpha()
    this.depthScene.updateMatrixWorld(true)
    const receivers: unknown[] = []
    this.depthScene.traverseVisible((o) => {
      if (o instanceof Mesh || o instanceof Points)
        receivers.push([o.uuid, o.geometry.uuid, o.matrixWorld.elements])
    })
    const receiverKey = JSON.stringify(receivers)
    try {
      renderer.setClearColor('#ffffff', 1)
      this.projection.projectors.forEach((p, i) => {
        const camera = projectorCamera(p),
          key = JSON.stringify([
            receiverKey,
            camera.projectionMatrix.elements,
            camera.matrixWorldInverse.elements
          ])
        // Moving one projector only redraws its tile; receiver changes redraw all tiles.
        if (!force && this.depthTileKeys[i] === key) return
        // Target rectangles use texture pixels. Renderer.setViewport/setScissor
        // instead scale by the display DPR, corrupting tiles when full quality
        // is restored after a drag (and when adaptive quality changes).
        depth.viewport.set((i % 4) * 512, Math.floor(i / 4) * 512, 512, 512)
        depth.scissor.copy(depth.viewport)
        depth.scissorTest = true
        renderer.setRenderTarget(depth)
        renderer.clear()
        renderer.render(this.depthScene, camera)
        this.depthTileKeys[i] = key
        this.dirtySplats = true
      })
    } finally {
      depth.viewport.copy(viewport)
      depth.scissor.copy(scissor)
      depth.scissorTest = scissorTest
      renderer.setRenderTarget(oldTarget, oldCubeFace, oldMipmapLevel)
      renderer.setClearColor(clear, alpha)
    }
  }
  normal(hit: Intersection): { normal: Vector3 | null; confidence: AnalysisSample['confidence'] } {
    const id = this.nodeId(hit.object),
      node = this.state.doc.nodes.find((n) => n.id === id)
    if (!node) return { normal: null, confidence: 'unavailable' }
    if (hit.object instanceof Points) {
      const g = hit.object.geometry,
        index = hit.index ?? 0
      if (!g.getAttribute('confidence') || g.getAttribute('confidence').getX(index) < 0.5)
        return { normal: null, confidence: 'unavailable' }
      const normal = new Vector3()
        .fromBufferAttribute(g.getAttribute('normal'), index)
        .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize()
      return { normal, confidence: 'estimated' }
    }
    if (hit.face)
      return {
        normal: hit.face.normal
          .clone()
          .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize(),
        confidence: 'mesh'
      }
    return { normal: null, confidence: 'unavailable' }
  }
  occluded(p: ProjectorConfig, point: Vector3) {
    const origin = new Vector3().fromArray(p.transform.position),
      direction = point.clone().sub(origin),
      distance = direction.length(),
      ray = new Raycaster(
        origin,
        direction.normalize(),
        0.02,
        distance - Math.max(0.0002, distance * 0.00002)
      )
    ray.params.Points.threshold = 0.035
    return (
      ray.intersectObjects(
        [...this.nodes.values()].filter((n) => n.depth.visible).map((n) => n.depth),
        true
      ).length > 0
    )
  }
  probe(hit: Intersection): AnalysisSample {
    const { normal, confidence } = this.normal(hit),
      point = hit.point,
      node = this.state.doc.nodes.find((n) => n.id === this.nodeId(hit.object))
    let lux = 0,
      overlap = 0,
      density: AnalysisSample['density'] = null,
      distortion: number | null = null,
      mm: AnalysisSample['millimetresPerPixel'] = null
    const results: AnalysisSample['projectors'] = [],
      chosen = new Set(analysisProjectors(this.state.doc, this.state.selectedIds).map((p) => p.id))
    for (const p of this.projection.projectors) {
      const f = normal ? pixelFootprint(p, point, normal) : null,
        blocked = f ? this.occluded(p, point) : false
      results.push({
        id: p.id,
        lux: f && !blocked ? f.lux : 0,
        occluded: blocked,
        density: f && !blocked ? f.density : null,
        millimetresPerPixel: f && !blocked ? f.millimetresPerPixel : null,
        distortion: f && !blocked ? f.distortion : null
      })
      if (f && !blocked) {
        overlap++
        if (this.state.doc.settings.analysisProjector === 'all' || chosen.has(p.id)) lux += f.lux
        if (chosen.has(p.id)) {
          if (!density || Math.min(...f.density) > Math.min(...density)) {
            density = f.density
            mm = f.millimetresPerPixel
          }
          distortion = Math.max(distortion ?? 0, f.distortion)
        }
      }
    }
    return {
      point: point.toArray(),
      normal: normal?.toArray() ?? null,
      confidence,
      lux: normal ? lux : null,
      overlap: normal ? overlap : null,
      density,
      millimetresPerPixel: mm,
      distortion,
      luminance: normal && node ? (lux * node.material.reflectance) / Math.PI : null,
      projectors: results
    }
  }
  async interceptedLumens(nodeId: string): Promise<number | null> {
    const runtime = this.nodes.get(nodeId)
    if (!runtime) return null
    let flux = 0
    for (const p of this.projection.projectors) {
      const camera = projectorCamera(p),
        ray = new Raycaster()
      ray.params.Points.threshold = 0.035
      const nx = 80,
        ny = 50
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          ray.setFromCamera(new Vector2(((x + 0.5) / nx) * 2 - 1, ((y + 0.5) / ny) * 2 - 1), camera)
          ray.near = 0.02
          ray.far = p.extent
          const hit = ray.intersectObjects(
            [...this.nodes.values()].filter((n) => n.group.visible).map((n) => n.group),
            true
          )[0]
          if (hit && this.nodeId(hit.object) === nodeId)
            flux += (p.spec.lumens * p.multiplier) / (nx * ny)
        }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return flux
  }
  updateHeightMeasurements() {
    const { doc } = this.state
    const measurements: HeightOverlay[] = []
    // Project into CSS pixels so annotation text and strokes remain legible at any zoom/DPR.
    const width = this.renderer.domElement.clientWidth,
      height = this.renderer.domElement.clientHeight
    this.camera.updateMatrixWorld()
    const project = (point: Vector3): [number, number] | null => {
      const ndc = point.clone().project(this.camera)
      if (![ndc.x, ndc.y, ndc.z].every(Number.isFinite) || ndc.z < -1 || ndc.z > 1) return null
      return [((ndc.x + 1) * width) / 2, ((1 - ndc.y) * height) / 2]
    }
    for (const projector of doc.projectors) {
      if (!projector.heightMeasurement?.visible) continue
      const group = this.projectors.get(projector.id)
      const referenceId = projector.heightMeasurement.reference?.nodeId
      const referenceGroup = referenceId ? this.nodes.get(referenceId)?.group : undefined
      const measurement = projectorHeight(
        projector,
        doc.nodes,
        group ? read(group) : projector.transform,
        referenceGroup ? read(referenceGroup) : undefined
      )
      if (!measurement) continue
      const origin = project(measurement.origin),
        base = project(measurement.base)
      if (!origin || !base) continue
      if (
        (origin[0] < 0 && base[0] < 0) ||
        (origin[0] > width && base[0] > width) ||
        (origin[1] < 0 && base[1] < 0) ||
        (origin[1] > height && base[1] > height)
      )
        continue
      measurements.push({
        id: projector.id,
        name: projector.name,
        height: measurement.height,
        referenceName: measurement.referenceName,
        origin,
        base,
        point: measurement.point ? project(measurement.point) : null
      })
    }
    const key = JSON.stringify(measurements)
    if (key !== this.heightMeasurementKey) {
      this.heightMeasurementKey = key
      this.heightMeasurements.set(measurements)
    }
  }
  dispose() {
    this.disposed = true
    this.unsubscribe()
    this.heightMeasurements.set([])
    this.controls.dispose()
    this.transform.dispose()
    this.transform.getHelper().removeFromParent()
    this.selectionGroup.removeFromParent()
    for (const n of this.nodes.values()) {
      release(n.group, n.ownedGeometry)
      release(n.depth, false)
    }
    for (const p of this.projectors.values()) release(p)
    this.spark.dispose()
    this.spark.removeFromParent()
    this.projection.dispose()
    this.selection.dispose()
    this.helpers.removeFromParent()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.pointerDown)
    canvas.removeEventListener('pointerup', this.pointerUp)
    canvas.removeEventListener('contextmenu', this.contextMenu)
    canvas.removeEventListener('webglcontextlost', this.contextLost)
    canvas.removeEventListener('webglcontextrestored', this.contextRestored)
    window.removeEventListener('blur', this.blur)
  }
}
