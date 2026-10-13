import { PackedSplats, SplatMesh, SparkRenderer, writeSpz } from '@sparkjsdev/spark'
import { Vector3, Quaternion, Color, Scene, PerspectiveCamera, WebGLRenderTarget } from 'three'
import type { ViewportEngine } from '../../src/lib/engine'
import { materials } from '../../src/lib/types'

// Exercise Spark's real generator and output conversion, reading linear RGB like the mesh fixture.
export async function splatAmbientSample(
  engine: ViewportEngine,
  {
    size = 1,
    opacity = 1,
    sourceOpacity = 1,
    offset = 0,
    projected = false,
    point = [0, 0, 0]
  }: {
    size?: number
    opacity?: number
    sourceOpacity?: number
    offset?: number
    projected?: boolean
    point?: [number, number, number]
  } = {}
) {
  const renderer = engine.renderer,
    scene = new Scene(),
    camera = new PerspectiveCamera(45, 1, 0.01, 10),
    target = new WebGLRenderTarget(33, 33),
    splats = new PackedSplats({ maxSplats: 1 }),
    oldTarget = renderer.getRenderTarget(),
    oldClear = renderer.getClearColor(new Color()),
    oldAlpha = renderer.getClearAlpha(),
    uniforms = engine.projection.uniforms,
    previous = [uniforms.tmpCount.value, uniforms.tmpMode.value, uniforms.tmpResponse.value]
  camera.position.set(point[0], point[1], point[2] + 3)
  camera.lookAt(...point)
  camera.updateMatrixWorld(true)
  splats.pushSplat(
    new Vector3(...point),
    new Vector3(0.5, 0.5, 0.05),
    new Quaternion(),
    sourceOpacity,
    new Color(1, 1, 1)
  )
  const appearance = engine.projection.splatUniforms(materials.captured, size)
  const mesh = new SplatMesh({
      packedSplats: splats,
      worldModifier: engine.projection.splatModifier(materials.captured, appearance)
    }),
    spark = new SparkRenderer({ renderer, autoUpdate: false })
  scene.add(mesh, spark)
  mesh.opacity = opacity
  try {
    if (!projected) {
      uniforms.tmpCount.value = 0
      uniforms.tmpMode.value = 0
      uniforms.tmpResponse.value = true
    }
    renderer.setRenderTarget(target)
    renderer.setClearColor(0, 1)
    await spark.update({ scene, camera })
    // The studio may draw while Spark awaits its worker and restore the canvas target.
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(target, 16 + offset, 16, 1, 1, pixel)
    return [...pixel]
  } finally {
    ;[uniforms.tmpCount.value, uniforms.tmpMode.value, uniforms.tmpResponse.value] = previous
    renderer.setRenderTarget(oldTarget)
    renderer.setClearColor(oldClear, oldAlpha)
    mesh.dispose()
    spark.dispose()
    target.dispose()
    engine.invalidate()
  }
}
export async function spzFixture() {
  const splats = new PackedSplats({ maxSplats: 441 })
  for (let x = 0; x < 21; x++)
    for (let y = 0; y < 21; y++)
      splats.pushSplat(
        new Vector3(x / 10 - 1, y / 10 + 1, 0),
        new Vector3(0.055, 0.055, 0.005),
        new Quaternion(),
        1,
        new Color('#c6daef')
      )
  const result = await writeSpz(splats)
  splats.dispose()
  return [...result.fileBytes]
}
