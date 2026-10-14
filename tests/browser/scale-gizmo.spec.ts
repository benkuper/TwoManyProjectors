import { test, expect, type Page } from '@playwright/test'

async function handlePoint(page: Page, axis: string) {
  return page.evaluate((axis) => {
    const e = (window as any).__TMP_VIEWPORT__,
      t = e.transform,
      rect = e.renderer.domElement.getBoundingClientRect()
    t.getHelper().updateMatrixWorld(true)
    const gizmo = t.getHelper().children[0],
      ray = t.getRaycaster()
    for (const mesh of gizmo.gizmo.scale.children.filter(
      (o: any) => o.name === axis && o.visible
    )) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const p = mesh.position.clone().fromBufferAttribute(positions, i)
        mesh.localToWorld(p)
        p.project(e.camera)
        ray.setFromCamera({ x: p.x, y: p.y }, e.camera)
        const hit = ray.intersectObject(gizmo.picker.scale, true).find((h: any) => h.object.visible)
        if (hit?.object.name === axis)
          return {
            x: rect.left + ((p.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - p.y) * rect.height) / 2
          }
      }
    }
    throw new Error(`No hittable ${axis} scale handle`)
  }, axis)
}

async function ready(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Test plinth', exact: true }).click()
  for (const [axis, value] of [
    ['X', '2'],
    ['Y', '3'],
    ['Z', '4']
  ]) {
    await page.getByLabel(`${axis} scale`, { exact: true }).fill(value)
    await page.getByLabel(`${axis} scale`, { exact: true }).press('Tab')
  }
  await page.getByRole('button', { name: 'Scale', exact: true }).click()
}

const scale = (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e.state.doc.nodes.find((n: any) => n.id === e.state.selected).transform.scale as number[]
  })

for (const plane of ['XY', 'XZ', 'YZ']) {
  test(`${plane} scale preserves the plane proportions and untouched axis, with undo`, async ({
    page
  }) => {
    await ready(page)
    const before = await scale(page),
      point = await handlePoint(page, plane)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 45, point.y - 30, { steps: 8 })
    await page.mouse.up()
    const after = await scale(page),
      axes = ['X', 'Y', 'Z'],
      changed = axes.map((axis, i) => (plane.includes(axis) ? i : -1)).filter((i) => i >= 0),
      other = axes.findIndex((axis) => !plane.includes(axis))
    expect(after[changed[0]] / before[changed[0]]).not.toBeCloseTo(1, 3)
    expect(after[changed[0]] / before[changed[0]]).toBeCloseTo(
      after[changed[1]] / before[changed[1]],
      8
    )
    expect(after[other]).toBe(before[other])
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await scale(page)).toEqual(before)
  })
}

test('center scale is gradual, positive, independent of click offset and reversible', async ({
  page
}) => {
  await ready(page)
  const before = await scale(page)
  const point = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      rect = e.renderer.domElement.getBoundingClientRect(),
      p = e.transform.object.position.clone().project(e.camera)
    return {
      x: rect.left + ((p.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - p.y) * rect.height) / 2
    }
  })
  const results: number[][] = []
  for (const offset of [0, 3]) {
    await page.mouse.move(point.x + offset, point.y)
    await page.mouse.down()
    expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.axis)).toBe('XYZ')
    await page.mouse.move(point.x + offset + 30, point.y - 30, { steps: 6 })
    await page.mouse.up()
    const after = await scale(page)
    results.push(after)
    for (let i = 0; i < 3; i++) {
      expect(after[i] / before[i]).toBeGreaterThan(1.1)
      expect(after[i] / before[i]).toBeLessThan(1.3)
    }
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await scale(page)).toEqual(before)
  }
  results[0].forEach((value, i) => expect(value).toBeCloseTo(results[1][i], 8))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x - 150, point.y + 150, { steps: 10 })
  await page.mouse.up()
  for (const value of await scale(page)) expect(value).toBeGreaterThan(0)
})
