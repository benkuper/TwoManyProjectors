import {
  SphereGeometry,
  Mesh,
  Group,
  MeshDepthMaterial,
  RGBADepthPacking,
  DoubleSide,
  Vector2
} from 'three'
import type { ViewportEngine } from '../../src/lib/engine'
export async function benchmark(e: ViewportEngine) {
  const doc = structuredClone(e.state.doc),
    base = doc.projectors[0]
  doc.projectors = Array.from({ length: 8 }, (_, i) => ({
    ...structuredClone(base),
    id: `benchmark-${i}`,
    transform: { ...structuredClone(base.transform), position: [(i - 3.5) * 0.2, 2.2, 6] }
  }))
  e.projection.update(doc, base.id, e.invalidate)
  const geometry = new SphereGeometry(0.65, 512, 512)
  for (let i = 0; i < 4; i++) {
    const group = new Group(),
      depth = new Group(),
      material = e.projection.meshMaterial(undefined, {
        preset: 'white',
        color: '#eeeeee',
        reflectance: 0.85,
        roughness: 0.9,
        transmission: 0
      }),
      mesh = new Mesh(geometry, material)
    mesh.position.set((i - 1.5) * 1.4, 1.2, 1.5)
    group.add(mesh)
    e.scene.add(group)
    const d = new Mesh(
      geometry,
      new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide })
    )
    d.position.copy(mesh.position)
    depth.add(d)
    e.depthScene.add(depth)
    e.nodes.set(`benchmark-${i}`, {
      group,
      depth,
      key: 'benchmark',
      materialKey: 'benchmark',
      ownedGeometry: false
    })
  }
  e.renderer.setPixelRatio(1)
  e.renderDepth()
  e.invalidate()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const start = performance.now(),
    times: number[] = [],
    cameraStart = e.camera.position.clone(),
    offset = cameraStart.clone().sub(e.controls.target)
  let last = start
  await new Promise<void>((resolve) => {
    const frame = () => {
      const now = performance.now()
      times.push(now - last)
      last = now
      const angle = (now - start) * 0.00015
      e.camera.position.set(
        e.controls.target.x + offset.x * Math.cos(angle) + offset.z * Math.sin(angle),
        cameraStart.y,
        e.controls.target.z + offset.z * Math.cos(angle) - offset.x * Math.sin(angle)
      )
      e.controls.update()
      e.invalidate()
      if (now - start < 5000) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
  const extension = e.renderer.getContext().getExtension('WEBGL_debug_renderer_info'),
    result = {
      gpu: extension
        ? e.renderer.getContext().getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : 'unknown',
      resolution: e.renderer.getDrawingBufferSize(new Vector2()).toArray(),
      triangles: (geometry.index!.count / 3) * 4,
      enabledProjectors: 8,
      frames: times.length,
      seconds: (last - start) / 1000,
      fps: times.length / ((last - start) / 1000),
      p95FrameMs: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
      depthAtlas: '2048 × 1024; cached during navigation',
      mode: 'projection preview',
      devicePixelRatio: 1,
      userAgent: navigator.userAgent,
      date: '2026-10-12'
    }
  return result
}
