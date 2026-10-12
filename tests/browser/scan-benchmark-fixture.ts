import { get } from 'svelte/store'
import { Box3, Vector3 } from 'three'
import { importFiles } from '../../src/lib/assets'
import { beginEdit, commit, editObject, endEdit, editor, select } from '../../src/lib/store'
import { aimRotation } from '../../src/lib/optics'
import type { ViewportEngine } from '../../src/lib/engine'

export async function loadBenchmarkScan(url: string, e: ViewportEngine) {
  const bytes = await (await fetch(url)).arrayBuffer()
  await importFiles([new File([bytes], 'benchmark.ply')])
  if (get(editor).error) throw new Error(get(editor).error)
  const node = get(editor).doc.nodes.find((n) => n.assetId)!,
    group = e.nodes.get(node.id)!.group,
    box = new Box3().setFromObject(group),
    center = box.getCenter(new Vector3()),
    radius = box.getSize(new Vector3()).length() / 2,
    projectorId = get(editor).doc.projectors[0].id,
    position = center
      .clone()
      .add(new Vector3(0, 0, radius * 1.5))
      .toArray()
  commit('Benchmark scan setup', (doc) => {
    for (const n of doc.nodes) n.visible = n.id === node.id
    const p = doc.projectors[0]
    p.transform.position = position
    p.transform.rotation = aimRotation(position, center.toArray())
    p.extent = radius * 4
  })
  select(node.id)
  e.frame()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return { projectorId, nodeId: node.id, radius, center: center.toArray() }
}

export async function benchmarkScan(e: ViewportEngine, projectorId: string) {
  const modes = ['orbit', 'lens-shift', 'projector-drag'] as const,
    results: Record<string, unknown> = {},
    startCamera = e.camera.position.clone(),
    offset = startCamera.clone().sub(e.controls.target),
    p = get(editor).doc.projectors.find((p) => p.id === projectorId)!,
    startPosition = structuredClone(p.transform.position)
  select(projectorId)
  for (const mode of modes) {
    e.camera.position.copy(startCamera)
    e.controls.update()
    if (mode === 'lens-shift') beginEdit()
    else e.lowQuality()
    if (mode === 'projector-drag') e.transform.dragging = true
    const times: number[] = [],
      counts: number[] = []
    const start = performance.now()
    let last = start
    await new Promise<void>((resolve) => {
      const frame = () => {
        const now = performance.now(),
          elapsed = now - start
        if (elapsed > 750) {
          times.push(now - last)
          counts.push(e.spark.current.numSplats)
        }
        last = now
        if (mode === 'orbit') {
          const angle = elapsed * 0.00015
          e.camera.position.set(
            e.controls.target.x + offset.x * Math.cos(angle) + offset.z * Math.sin(angle),
            startCamera.y,
            e.controls.target.z + offset.z * Math.cos(angle) - offset.x * Math.sin(angle)
          )
          e.controls.update()
        } else if (mode === 'lens-shift') {
          editObject(projectorId, { shift: [Math.sin(elapsed * 0.002) * 0.1, 0] })
        } else {
          e.transform.object!.position.x = startPosition[0] + Math.sin(elapsed * 0.002) * 0.4
          e.dirtyDepth = true
        }
        e.invalidate()
        if (elapsed < 6000) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    results[mode] = {
      fps: (1000 * times.length) / times.reduce((sum, t) => sum + t, 0),
      p95FrameMs: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
      meanRenderedSplats: counts.reduce((sum, count) => sum + count, 0) / counts.length,
      pixelRatio: e.renderer.getPixelRatio()
    }
    if (mode === 'projector-drag') e.transform.dragging = false
    endEdit()
    e.fullQuality()
    editObject(projectorId, {
      shift: [0, 0],
      transform: { ...p.transform, position: [...startPosition] }
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const gl = e.renderer.getContext(),
    ext = gl.getExtension('WEBGL_debug_renderer_info')
  return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', results }
}

// Include the quality transition: steady-state averages hide drag-start stalls.
export async function benchmarkInteractionStarts(e: ViewportEngine, projectorId: string) {
  const results = [],
    startCamera = e.camera.position.clone(),
    offset = startCamera.clone().sub(e.controls.target),
    projector = e.projectors.get(projectorId)!,
    startPosition = projector.position.clone()
  select(projectorId)
  for (const mode of ['orbit', 'projector-drag'] as const) {
    for (let repeat = 0; repeat < 3; repeat++) {
      if (e.disposed) throw new Error('Viewport disposed during benchmark (hot reload?)')
      e.camera.position.copy(startCamera)
      projector.position.copy(startPosition)
      e.controls.update()
      e.invalidate()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      const samples: {
          elapsed: number
          ms: number
          splats: number
          budget: number
          ratio: number
        }[] = [],
        start = performance.now(),
        before = e.spark.current.numSplats,
        render = e.renderer.render.bind(e.renderer)
      let renderedFrames = 0
      e.renderer.render = (scene, camera) => {
        if (scene === e.scene) renderedFrames++
        render(scene, camera)
      }
      let last = start
      e.lowQuality()
      if (mode === 'projector-drag') e.transform.dragging = true
      await new Promise<void>((resolve) => {
        const frame = () => {
          const now = performance.now(),
            elapsed = now - start
          samples.push({
            elapsed,
            ms: now - last,
            splats: e.spark.current.numSplats,
            budget: e.spark.lodSplatScale,
            ratio: e.renderer.getPixelRatio()
          })
          last = now
          if (mode === 'orbit') {
            const angle = elapsed * 0.00015
            e.camera.position.set(
              e.controls.target.x + offset.x * Math.cos(angle) + offset.z * Math.sin(angle),
              startCamera.y,
              e.controls.target.z + offset.z * Math.cos(angle) - offset.x * Math.sin(angle)
            )
            e.controls.update()
          } else {
            projector.position.x = startPosition.x + Math.sin(elapsed * 0.002) * 0.4
            e.dirtyDepth = true
          }
          e.invalidate()
          if (elapsed < 3000) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      e.renderer.render = render
      if (e.disposed || renderedFrames < 10)
        throw new Error('Benchmark did not exercise an active viewport')
      const stats = (frames: typeof samples) => {
        const times = frames.map((f) => f.ms).sort((a, b) => a - b)
        return {
          fps: (1000 * times.length) / times.reduce((sum, t) => sum + t, 0),
          p95Ms: times[Math.floor(times.length * 0.95)],
          maxMs: times.at(-1)
        }
      }
      results.push({
        mode,
        repeat,
        before,
        renderedFrames,
        firstFrameMs: samples[0].ms,
        firstSecond: stats(samples.filter((f) => f.elapsed <= 1000)),
        steady: stats(samples.filter((f) => f.elapsed > 2000)),
        samples
      })
      if (mode === 'projector-drag') e.transform.dragging = false
      e.fullQuality()
    }
  }
  e.camera.position.copy(startCamera)
  projector.position.copy(startPosition)
  e.controls.update()
  e.dirtyDepth = true
  e.invalidate()
  return { results }
}
