import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Scene,
  OrthographicCamera,
  WebGLRenderTarget,
  NoToneMapping,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  Vector2,
  SRGBColorSpace
} from 'three'
import { projectionGLSL } from '../../src/lib/projection'
import type { ViewportEngine } from '../../src/lib/engine'
import { materials, overlapColors } from '../../src/lib/types'

export const overlapPalette = overlapColors.map((hex) =>
  new Color(hex).toArray().map((v) => Math.round(v * 255))
)

// Offscreen reads return linear RGB; screen reads exercise tone mapping and sRGB output.
export function receiverDisplaySample(
  engine: ViewportEngine,
  point: [number, number, number],
  kind: 'mesh' | 'cloud',
  screenOutput = false
) {
  const renderer = engine.renderer
  const target = new WebGLRenderTarget(1, 1)
  target.texture.colorSpace = SRGBColorSpace
  const scene = new Scene()
  const camera = new OrthographicCamera(-0.01, 0.01, 0.01, -0.01, 0.01, 10)
  camera.position.set(point[0], point[1], point[2] + 1)
  camera.lookAt(...point)
  const geometry = kind === 'mesh' ? new PlaneGeometry(0.02, 0.02) : new BufferGeometry()
  if (kind === 'cloud') {
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 0, 1], 3))
    geometry.setAttribute('confidence', new Float32BufferAttribute([1], 1))
  }
  const material =
    kind === 'mesh'
      ? engine.projection.meshMaterial(undefined, materials.white)
      : engine.projection.pointsMaterial(materials.white, false)
  const receiver = kind === 'mesh' ? new Mesh(geometry, material) : new Points(geometry, material)
  receiver.position.fromArray(point)
  scene.add(receiver)
  const previousTarget = renderer.getRenderTarget()
  try {
    renderer.setRenderTarget(screenOutput ? null : target)
    renderer.render(scene, camera)
    const pixel = new Uint8Array(4)
    if (screenOutput) {
      const size = renderer.getDrawingBufferSize(new Vector2())
      const gl = renderer.getContext()
      gl.readPixels(Math.floor(size.x / 2), Math.floor(size.y / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    } else renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    return [...pixel].slice(0, 3)
  } finally {
    renderer.setRenderTarget(previousTarget)
    geometry.dispose()
    material.dispose()
    target.dispose()
    engine.invalidate()
  }
}
export function gpuSample(
  engine: ViewportEngine,
  point: [number, number, number],
  normal: [number, number, number],
  confidence = 1
) {
  const renderer = engine.renderer,
    target = new WebGLRenderTarget(1, 1),
    scene = new Scene(),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
  camera.position.z = 1
  const material = new ShaderMaterial({
      uniforms: engine.projection.uniforms,
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `${projectionGLSL}\nvoid main(){gl_FragColor=vec4(tmpShade(vec3(${point.map((v) => v.toFixed(8)).join(',')}),vec3(${normal.map((v) => v.toFixed(8)).join(',')}),vec3(1.),1.,0.,${confidence.toFixed(8)}),1.);}`
    }),
    geometry = new PlaneGeometry(2, 2)
  scene.add(new Mesh(geometry, material))
  const old = renderer.getRenderTarget(),
    tone = renderer.toneMapping
  renderer.toneMapping = NoToneMapping
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  const pixel = new Uint8Array(4)
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
  renderer.setRenderTarget(old)
  renderer.toneMapping = tone
  geometry.dispose()
  material.dispose()
  target.dispose()
  engine.invalidate()
  return [...pixel]
}
