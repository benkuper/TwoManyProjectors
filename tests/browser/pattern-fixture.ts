import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Scene,
  OrthographicCamera,
  WebGLRenderTarget,
  Vector2,
  NoToneMapping
} from 'three'
import { projectionGLSL } from '../../src/lib/projection'
import type { ViewportEngine } from '../../src/lib/engine'

// Read generated pattern colors before lighting so geometric/rasterization checks
// remain independent of surface response, exposure and projector overlap.
export function patternSamples(engine: ViewportEngine, points: [number, number][], projector = 0) {
  const renderer = engine.renderer
  const target = new WebGLRenderTarget(points.length, 1)
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10)
  const material = new ShaderMaterial({
    uniforms: {
      ...engine.projection.uniforms,
      sampleUV: { value: points.map(([x, y]) => new Vector2(x, y)) }
    },
    vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `${projectionGLSL}
      uniform vec2 sampleUV[${points.length}];
      void main(){gl_FragColor=vec4(tmpPattern(sampleUV[int(gl_FragCoord.x)],${projector}),1.);}`
  })
  const geometry = new PlaneGeometry(2, 2)
  scene.add(new Mesh(geometry, material))
  const previousTarget = renderer.getRenderTarget()
  const previousToneMapping = renderer.toneMapping
  renderer.toneMapping = NoToneMapping
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  const pixels = new Uint8Array(points.length * 4)
  renderer.readRenderTargetPixels(target, 0, 0, points.length, 1, pixels)
  renderer.setRenderTarget(previousTarget)
  renderer.toneMapping = previousToneMapping
  geometry.dispose()
  material.dispose()
  target.dispose()
  engine.invalidate()
  return points.map((_, i) => [...pixels.slice(i * 4, i * 4 + 3)])
}
