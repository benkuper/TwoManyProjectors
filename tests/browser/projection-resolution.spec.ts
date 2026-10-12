import { test, expect } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

test('projection and occlusion remain stable when manipulation restores full resolution', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await page.getByLabel('Y rotation', { exact: true }).fill('5')
  await page.getByLabel('Y rotation', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Illuminance', exact: true }).click()
  const samples = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    e.lowQuality()
    e.renderDepth()
    const receiver = [...e.nodes.values()][0] as any
    const normal = receiver.group.position
      .clone()
      .set(0, 0, 1)
      .applyQuaternion(receiver.group.quaternion)
      .toArray()
    const during = gpuSample(e, [0, 2.2, 0], normal)
    const previewRatio = e.renderer.getPixelRatio()
    e.fullQuality()
    e.renderDepth()
    return {
      during,
      after: gpuSample(e, [0, 2.2, 0], normal),
      previewRatio,
      fullRatio: e.renderer.getPixelRatio()
    }
  })
  expect(samples.previewRatio).toBe(1)
  expect(samples.fullRatio).toBe(1.75)
  expect(samples.during[1]).toBe(255)
  expect(samples.after).toEqual(samples.during)
})

test('releasing a real gizmo drag preserves projection on a rotated plane', async ({
  page
}, info) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await page.getByLabel('Y rotation', { exact: true }).fill('5')
  await page.getByLabel('Y rotation', { exact: true }).press('Tab')
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await page.getByRole('button', { name: 'Illuminance', exact: true }).click()
  const point = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    const rect = e.renderer.domElement.getBoundingClientRect()
    const p = e.transform.object.position.clone().project(e.camera)
    return {
      x: rect.left + ((p.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - p.y) * rect.height) / 2
    }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 20, point.y - 8, { steps: 6 })
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e.transform.dragging && !e.dirtyDepth && e.renderer.getPixelRatio() === 1
  })
  const during = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    const receiver = [...e.nodes.values()][0] as any
    const normal = receiver.group.position
      .clone()
      .set(0, 0, 1)
      .applyQuaternion(receiver.group.quaternion)
      .toArray()
    return gpuSample(e, [0, 2.2, 0], normal)
  })
  await page
    .locator('.viewport')
    .screenshot({ path: info.outputPath('during-drag.png'), scale: 'css' })
  await page.mouse.up()
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return !e.transform.dragging && !e.dirtyDepth && e.renderer.getPixelRatio() === 1.75
  })
  const after = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    const receiver = [...e.nodes.values()][0] as any
    const normal = receiver.group.position
      .clone()
      .set(0, 0, 1)
      .applyQuaternion(receiver.group.quaternion)
      .toArray()
    return gpuSample(e, [0, 2.2, 0], normal)
  })
  expect(during[1]).toBe(255)
  expect(after).toEqual(during)
  await page
    .locator('.viewport')
    .screenshot({ path: info.outputPath('after-release.png'), scale: 'css' })
})

test('all eight depth-map tiles and blocker shadows are independent of preview resolution', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
  await page.getByRole('button', { name: 'Main screen', exact: true }).click()
  await page.getByLabel('Y rotation', { exact: true }).fill('5')
  await page.getByLabel('Y rotation', { exact: true }).press('Tab')
  const results = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__
    const { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    const doc = structuredClone(e.state.doc)
    const projector = doc.projectors[0]
    doc.projectors = Array.from({ length: 8 }, (_, i) => ({
      ...structuredClone(projector),
      id: `resolution-${i}`,
      pattern: 'white'
    }))
    doc.nodes[2].transform.position = [0, 2.2, 3]
    doc.settings.analysis = 'lux'
    e.state = { ...e.state, doc }
    e.sync()
    const receiver = [...e.nodes.values()][0] as any
    const normal = receiver.group.position
      .clone()
      .set(0, 0, 1)
      .applyQuaternion(receiver.group.quaternion)
      .toArray()
    const visible = receiver.group
      .localToWorld(receiver.group.position.clone().set(-1.5, 0, 0))
      .toArray()
    return [1, 0.5, 0.8, 1.25, 1.75, 2].map((ratio) => {
      e.renderer.setPixelRatio(ratio)
      const before = {
        viewport: e.renderer
          .getViewport(e.projection.uniforms.tmpOutput.value[0].clone())
          .toArray(),
        scissor: e.renderer.getScissor(e.projection.uniforms.tmpOutput.value[0].clone()).toArray(),
        scissorTest: e.renderer.getScissorTest()
      }
      e.renderDepth()
      const after = {
        viewport: e.renderer
          .getViewport(e.projection.uniforms.tmpOutput.value[0].clone())
          .toArray(),
        scissor: e.renderer.getScissor(e.projection.uniforms.tmpOutput.value[0].clone()).toArray(),
        scissorTest: e.renderer.getScissorTest()
      }
      const bytes = new Uint8Array(e.projection.depth.width * e.projection.depth.height * 4)
      e.renderer.readRenderTargetPixels(
        e.projection.depth,
        0,
        0,
        e.projection.depth.width,
        e.projection.depth.height,
        bytes
      )
      let hash = 2166136261
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0
      const projectors = Array.from({ length: 8 }, (_, i) => {
        e.projection.uniforms.tmpSelected.value = i
        return {
          visible: gpuSample(e, visible, normal),
          blocked: gpuSample(e, [0, 2.2, 0], normal)
        }
      })
      return { ratio, hash, projectors, before, after }
    })
  })
  for (const result of results) {
    expect(result.hash, `Depth atlas at DPR ${result.ratio}`).toBe(results[0].hash)
    expect(result.projectors).toEqual(results[0].projectors)
    expect(result.after).toEqual(result.before)
    for (const projector of result.projectors) {
      expect(projector.visible[1]).toBeGreaterThan(128)
      expect(projector.blocked).toEqual([0, 0, 128, 255])
    }
  }
})
