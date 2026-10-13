import { Mesh, OrthographicCamera, Scene, WebGLRenderTarget, NoToneMapping } from 'three'
import type { ViewportEngine } from '../../src/lib/engine'

// Exercise the actual imported geometry, material slots and projection shaders.
export function importedMeshSample(engine: ViewportEngine) {
  const runtime = engine.nodes.get(engine.state.selected!)!,
    scene = new Scene(),
    camera = new OrthographicCamera(-1, 4, 1, -1, 0.1, 100),
    target = new WebGLRenderTarget(100, 80),
    renderer = engine.renderer,
    previousTarget = renderer.getRenderTarget(),
    previousTone = renderer.toneMapping,
    object = runtime.group.clone(true)
  scene.add(object)
  camera.position.set(0, 2, 10)
  camera.lookAt(0, 2, 0)
  const slots: { color: number[]; sourceColor: number[]; textured: boolean; normals: boolean }[] =
    []
  runtime.group.traverse((o) => {
    if (o instanceof Mesh) {
      const source = o.userData.originalMaterial
      const originals = Array.isArray(source) ? source : [source]
      const projected = Array.isArray(o.material) ? o.material : [o.material]
      projected.forEach((m, i) =>
        slots.push({
          color: (m as any).color.toArray(),
          sourceColor: originals[i].color.toArray(),
          textured: !!(m as any).map,
          normals: o.geometry.hasAttribute('normal')
        })
      )
    }
  })
  try {
    renderer.toneMapping = NoToneMapping
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixels = [20, 80].map((x) => {
      const pixel = new Uint8Array(4)
      renderer.readRenderTargetPixels(target, x, 40, 1, 1, pixel)
      return [...pixel].slice(0, 3)
    })
    return { slots, pixels }
  } finally {
    renderer.setRenderTarget(previousTarget)
    renderer.toneMapping = previousTone
    target.dispose()
    engine.invalidate()
  }
}
