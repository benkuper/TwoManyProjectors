import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Scene,
  OrthographicCamera,
  WebGLRenderTarget,
  NoToneMapping,
  Color
} from 'three'
import { projectionGLSL } from '../../src/lib/projection'
import type { ViewportEngine } from '../../src/lib/engine'
export function gpuSample(
  engine: ViewportEngine,
  point: [number, number, number],
  normal: [number, number, number]
) {
  const renderer = engine.renderer,
    target = new WebGLRenderTarget(1, 1),
    scene = new Scene(),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
  camera.position.z = 1
  const material = new ShaderMaterial({
      uniforms: engine.projection.uniforms,
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `${projectionGLSL}\nvoid main(){gl_FragColor=vec4(tmpShade(vec3(${point.map((v) => v.toFixed(8)).join(',')}),vec3(${normal.map((v) => v.toFixed(8)).join(',')}),vec3(1.),1.,0.,1.),1.);}`
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
