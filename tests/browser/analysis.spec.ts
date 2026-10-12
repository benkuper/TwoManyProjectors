import { test, expect } from '@playwright/test'
test('CPU probes and GPU overlays agree, overlap adds, blockers occlude', async ({
  page
}, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Illuminance', exact: true }).click()
  const result = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__,
      { gpuSample } = await import('./gpu-fixture.ts' as string).catch(
        () => import('/tests/browser/gpu-fixture.ts' as string)
      ),
      surface = [...e.nodes.values()][0] as any
    const point = surface.group.position.clone(),
      hit = {
        point,
        object: surface.group.children[0],
        face: { normal: point.clone().set(0, 0, 1) }
      }
    return { cpu: e.probe(hit), gpu: gpuSample(e, [0, 2.2, 0], [0, 0, 1]) }
  })
  expect(result.cpu.lux).toBeCloseTo(266.6667, 2)
  expect(result.cpu.distortion).toBeCloseTo(1)
  expect(result.gpu[0]).toBeCloseTo(161, 0)
  expect(result.gpu[1]).toBe(255)
  expect(result.gpu[2]).toBe(93)
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await page.getByLabel('X', { exact: true }).fill('0')
  await page.getByLabel('X', { exact: true }).press('Tab')
  const overlap = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      surface = [...e.nodes.values()][0] as any,
      point = surface.group.position.clone()
    return e.probe({
      point,
      object: surface.group.children[0],
      face: { normal: point.clone().set(0, 0, 1) }
    }).lux
  })
  expect(overlap).toBeCloseTo(533.3333, 2)
  await page.getByRole('button', { name: 'Add receiver', exact: true }).click()
  await page.getByRole('button', { name: 'Box', exact: true }).click()
  await page.getByLabel('Y', { exact: true }).fill('2.2')
  await page.getByLabel('Y', { exact: true }).press('Tab')
  await page.getByLabel('Z', { exact: true }).fill('3')
  await page.getByLabel('Z', { exact: true }).press('Tab')
  const blocked = await page.evaluate(async () => {
    const e = (window as any).__TMP_VIEWPORT__,
      surface = [...e.nodes.values()][0] as any,
      point = surface.group.position.clone(),
      { gpuSample } = await import('/tests/browser/gpu-fixture.ts' as string)
    e.renderDepth()
    return {
      lux: e.probe({
        point,
        object: surface.group.children[0],
        face: { normal: point.clone().set(0, 0, 1) }
      }).lux,
      gpu: gpuSample(e, [0, 2.2, 0], [0, 0, 1])
    }
  })
  expect(blocked.lux).toBe(0)
  expect(blocked.gpu.slice(0, 3)).toEqual([0, 0, 128])
  await page.screenshot({ path: testInfo.outputPath('occlusion.png') })
})
