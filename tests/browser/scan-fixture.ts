import { addProjector, commit, select, updateUI } from '../../src/lib/store'
import type { ViewportEngine } from '../../src/lib/engine'

export function scanInteractionSample(e: ViewportEngine) {
  addProjector()
  e.tick(1 / 60)
  e.renderDepth()
  e.tick(1 / 60)
  const mesh = [...e.nodes.values()].find((n: any) => n.splat) as any
  let renders = 0
  const render = e.renderer.render.bind(e.renderer)
  e.renderer.render = (scene: any, camera: any) => {
    if (scene === e.depthScene) renders++
    return render(scene, camera)
  }
  try {
    const before = mesh.splat.mesh.version
    select(e.state.doc.nodes[0].id)
    updateUI({ tool: 'probe' })
    commit('Changed helper opacity', (doc: any) => {
      doc.settings.outlineOpacity = 0.2
    })
    e.tick(1 / 60)
    const unchanged = mesh.splat.mesh.version === before
    const p = e.state.doc.projectors[0]
    select(p.id)
    e.transform.object.position.x += 0.25
    e.transform.dragging = true
    e.dirtyDepth = true
    const version = mesh.splat.mesh.version
    e.tick(1 / 60)
    const live = mesh.splat.mesh.version > version,
      projectorRenders = renders
    e.transform.dragging = false
    commit('Moved receiver', (doc: any) => {
      doc.nodes[0].transform.position[0] += 0.2
    })
    renders = 0
    e.tick(1 / 60)
    const receiverRenders = renders
    e.lowQuality()
    const previewBudget = e.spark.lodSplatScale
    e.fullQuality()
    return {
      unchanged,
      live,
      projectorRenders,
      receiverRenders,
      previewBudget,
      restoredBudget: e.spark.lodSplatScale
    }
  } finally {
    e.renderer.render = render
  }
}
