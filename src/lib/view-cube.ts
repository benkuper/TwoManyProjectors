import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace
} from 'three'
import type { ViewportGizmo } from 'three-viewport-gizmo'

export const cubeFaceInset = 0.86
export const cubeFaceColors = ['#475262', '#616e80', '#526073']
export const cubeBaseColor = cubeFaceColors[1]
const faceLabels = [
  ['LEFT', 'RIGHT'],
  ['BOTTOM', 'TOP'],
  ['BACK', 'FRONT']
]

function faceTexture(axis: number, sign: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')!
  context.font = '700 48px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (let hover = 0; hover < 2; hover++) {
    context.fillStyle = hover ? '#b5ed76' : cubeFaceColors[axis]
    context.fillRect(hover * 256, 0, 256, 256)
    context.fillStyle = hover ? '#172011' : '#e4eaf2'
    context.fillText(faceLabels[axis][sign > 0 ? 1 : 0], hover * 256 + 128, 128)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.repeat.set(0.5, 1)
  texture.userData.offsetX = 0
  return texture
}

// Keep the gizmo's snapping and camera animation, but tile its edge and corner
// targets onto the cube's six planes instead of using protruding indicator meshes.
export function refineViewCube(gizmo: ViewportGizmo) {
  const base = new Color(cubeBaseColor)
  const geometries: BufferGeometry[] = []
  const textures: CanvasTexture[] = []
  const replaced = new Set<BufferGeometry>()
  for (const child of gizmo.children) {
    if (!(child instanceof Mesh) || !child.userData.hover) continue
    const mesh = child as Mesh<BufferGeometry, MeshBasicMaterial>
    const signs = mesh.position.toArray().map(Math.sign)
    const fixed = signs.flatMap((sign, axis) => (sign ? [axis] : []))
    if (fixed.length === 1) {
      const texture = faceTexture(fixed[0], signs[fixed[0]])
      mesh.material.map?.dispose()
      mesh.material.map = texture
      mesh.material.needsUpdate = true
      textures.push(texture)
      continue
    }

    const positions: number[] = [],
      colors: number[] = []
    for (const axis of fixed) {
      const u = (axis + 1) % 3,
        v = (axis + 2) % 3
      const bounds = (index: number) =>
        signs[index]
          ? [signs[index] * cubeFaceInset, signs[index]].sort((a, b) => a - b)
          : [-cubeFaceInset, cubeFaceInset]
      const [u0, u1] = bounds(u),
        [v0, v1] = bounds(v)
      const corners = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1]
      ]
      const triangles = signs[axis] > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
      const color = new Color(cubeFaceColors[axis])
      for (const index of triangles) {
        const point = [0, 0, 0]
        point[axis] = signs[axis]
        point[u] = corners[index][0]
        point[v] = corners[index][1]
        positions.push(...point)
        colors.push(color.r / base.r, color.g / base.g, color.b / base.b)
      }
    }
    mesh.updateMatrix()
    const geometry = new BufferGeometry()
      .setAttribute('position', new Float32BufferAttribute(positions, 3))
      .setAttribute('color', new Float32BufferAttribute(colors, 3))
      .applyMatrix4(mesh.matrix.clone().invert())
    replaced.add(mesh.geometry)
    mesh.geometry = geometry
    mesh.material.vertexColors = true
    mesh.material.needsUpdate = true
    geometries.push(geometry)
  }
  for (const geometry of replaced) geometry.dispose()

  // A solid core covers subpixel seams between adjacent hover regions.
  const box = new BoxGeometry(2, 2, 2)
  const normals = box.getAttribute('normal')
  const colors: number[] = []
  for (let i = 0; i < normals.count; i++) {
    const axis = normals.getX(i) ? 0 : normals.getY(i) ? 1 : 2
    const color = new Color(cubeFaceColors[axis])
    colors.push(color.r, color.g, color.b)
  }
  box.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const core = new Mesh(box, new MeshBasicMaterial({ vertexColors: true }))
  core.scale.setScalar(0.999)
  gizmo.add(core)

  const outline = new LineSegments(
    new EdgesGeometry(box),
    new LineBasicMaterial({ color: '#8391a4', transparent: true, opacity: 0.55 })
  )
  outline.scale.setScalar(1.001)
  outline.renderOrder = 2
  gizmo.add(outline)
  return () => {
    gizmo.remove(core)
    core.geometry.dispose()
    core.material.dispose()
    gizmo.remove(outline)
    outline.geometry.dispose()
    outline.material.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const texture of textures) texture.dispose()
  }
}
