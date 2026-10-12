import { test, expect, type Page } from '@playwright/test'

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
}

async function handlePoint(page: Page, axis = 'X') {
  return page.evaluate((axis) => {
    const e = (window as any).__TMP_VIEWPORT__,
      t = e.transform
    t.getHelper().updateMatrixWorld(true)
    const gizmo = t.getHelper().children[0],
      ray = t.getRaycaster(),
      rect = e.renderer.domElement.getBoundingClientRect()
    const handles = gizmo.gizmo[t.getMode()].children.filter(
      (o: any) => o.name === axis && o.visible
    )
    for (const mesh of handles) {
      const positions = mesh.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i += 3) {
        const p = mesh.position.clone().fromBufferAttribute(positions, i)
        mesh.localToWorld(p)
        p.project(e.camera)
        ray.setFromCamera({ x: p.x, y: p.y }, e.camera)
        const hit = ray
          .intersectObject(gizmo.picker[t.getMode()], true)
          .find((h: any) => h.object.visible)
        if (hit?.object.name === axis)
          return {
            x: rect.left + ((p.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - p.y) * rect.height) / 2
          }
      }
    }
    throw new Error(`No hittable ${axis} handle`)
  }, axis)
}

test('tree multiselection supports toggles, ranges, select all and batch commands', async ({
  page
}) => {
  await ready(page)
  const screen = page.getByRole('button', { name: 'Main screen', exact: true })
  await screen.click({ modifiers: ['Control'] })
  await expect(page.locator('.tree-row.selected')).toHaveCount(2)
  await expect(page.locator('.inspector')).toContainText('2 objects selected')
  await screen.click({ modifiers: ['Control'] })
  await expect(page.locator('.tree-row.selected')).toHaveCount(1)
  await screen.click()
  await page
    .getByRole('button', { name: 'Test plinth', exact: true })
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('.tree-row.selected')).toHaveCount(3)
  await page
    .getByRole('button', { name: 'Stage floor', exact: true })
    .click({ modifiers: ['Shift'] })
  await expect(page.locator('.tree-row.selected')).toHaveCount(2)
  await page.keyboard.press('Control+a')
  await expect(page.locator('.tree-row.selected')).toHaveCount(4)
  await page.keyboard.press('Control+d')
  await expect(page.locator('.tree-row')).toHaveCount(8)
  await expect(page.locator('.tree-row.selected')).toHaveCount(4)
  await page.keyboard.press('Delete')
  await expect(page.locator('.tree-row')).toHaveCount(4)
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.locator('.tree-row')).toHaveCount(8)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.locator('.tree-row')).toHaveCount(4)
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
})

test('viewport modifier clicks select multiple receivers and Escape clears all outlines', async ({
  page
}) => {
  await ready(page)
  await page.keyboard.press('Escape')
  const points = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__,
      rect = e.renderer.domElement.getBoundingClientRect()
    return ['Main screen', 'Test plinth'].map((name) => {
      const node = e.state.doc.nodes.find((n: any) => n.name === name)
      const p = e.nodes.get(node.id).group.position.clone().project(e.camera)
      return {
        x: rect.left + ((p.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - p.y) * rect.height) / 2
      }
    })
  })
  await page.mouse.click(points[0].x, points[0].y)
  await page.keyboard.down('Control')
  await page.mouse.click(points[1].x, points[1].y)
  await page.keyboard.up('Control')
  await expect(page.locator('.tree-row.selected')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.selection.targets.length)).toBe(
    2
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.selection.copies.length)).toBe(
    0
  )
})

test('a real group move updates both objects and projector preview, with one undo', async ({
  page
}) => {
  await ready(page)
  await page
    .getByRole('button', { name: 'Test plinth', exact: true })
    .click({ modifiers: ['Control'] })
  const before = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return [...e.state.doc.projectors, ...e.state.doc.nodes]
      .filter((o: any) => e.state.selectedIds.includes(o.id))
      .map((o: any) => ({ id: o.id, position: o.transform.position }))
  })
  const point = await handlePoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 55, point.y + 8, { steps: 8 })
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpOrigins.value[0].x
      )
    )
    .not.toBe(before[0].position[0])
  await page.mouse.up()
  const positions = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return [...e.state.doc.projectors, ...e.state.doc.nodes]
      .filter((o: any) => e.state.selectedIds.includes(o.id))
      .map((o: any) => o.transform.position)
  })
  expect(positions[0][0]).not.toBe(before[0].position[0])
  expect(positions[0][0] - before[0].position[0]).toBeCloseTo(
    positions[1][0] - before[1].position[0]
  )
  await page.getByLabel('Undo', { exact: true }).click()
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return [...e.state.doc.projectors, ...e.state.doc.nodes]
        .filter((o: any) => e.state.selectedIds.includes(o.id))
        .map((o: any) => o.transform.position)
    })
  ).toEqual(before.map((o: any) => o.position))
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
})

test('group inspector translation preserves spacing and is undone together', async ({ page }) => {
  await ready(page)
  await page
    .getByRole('button', { name: 'Test plinth', exact: true })
    .click({ modifiers: ['Control'] })
  await page.getByLabel('X', { exact: true }).fill('5')
  await page.getByLabel('X', { exact: true }).press('Tab')
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return [
        e.state.doc.projectors[0].transform.position[0],
        e.state.doc.nodes[2].transform.position[0]
      ]
    })
  ).toEqual([3.9, 6.1])
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('1.1')
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
})

for (const mode of ['Rotate', 'Scale'] as const) {
  test(`a real group ${mode.toLowerCase()} preserves the center and projector optics`, async ({
    page
  }, info) => {
    await ready(page)
    await page
      .getByRole('button', { name: 'Test plinth', exact: true })
      .click({ modifiers: ['Control'] })
    await page.getByRole('button', { name: mode, exact: true }).click()
    const snapshot = () =>
      page.evaluate(() => {
        const e = (window as any).__TMP_VIEWPORT__
        const objects = [...e.state.doc.projectors, ...e.state.doc.nodes].filter((o: any) =>
          e.state.selectedIds.includes(o.id)
        )
        return objects.map((o: any) => o.transform)
      })
    const before = await snapshot()
    const point = await handlePoint(page, mode === 'Rotate' ? 'Y' : 'X')
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.mouse.move(point.x + 40, point.y + 25, { steps: 8 })
    await page.mouse.up()
    const after = await snapshot()
    expect(after[0].position).not.toEqual(before[0].position)
    for (let axis = 0; axis < 3; axis++)
      expect((after[0].position[axis] + after[1].position[axis]) / 2).toBeCloseTo(
        (before[0].position[axis] + before[1].position[axis]) / 2
      )
    expect(after[0].scale).toEqual(before[0].scale)
    if (mode === 'Rotate') {
      expect(after[0].rotation).not.toEqual(before[0].rotation)
      expect(after[0].rotation).toEqual(after[1].rotation)
      expect(after[1].scale).toEqual(before[1].scale)
    } else {
      expect(after[1].scale[0]).not.toBe(before[1].scale[0])
      expect(after[1].scale[0]).toBeCloseTo(after[1].scale[1])
      expect(after[1].scale[0]).toBeCloseTo(after[1].scale[2])
      expect(after[0].rotation).toEqual(before[0].rotation)
    }
    await page.screenshot({ path: info.outputPath('group-selection.png') })
    await page.getByLabel('Undo', { exact: true }).click()
    expect(await snapshot()).toEqual(before)
    await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  })
}

test('Escape during a group drag restores every object without creating an undo command', async ({
  page
}) => {
  await ready(page)
  await page
    .getByRole('button', { name: 'Test plinth', exact: true })
    .click({ modifiers: ['Control'] })
  const before = await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.doc)
  const point = await handlePoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 50, point.y + 10, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.doc)).toEqual(before)
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return e.state.doc.nodes.map((n: any) => e.nodes.get(n.id).group.position.toArray())
    })
  ).toEqual(before.nodes.map((n: any) => n.transform.position))
  await expect(page.locator('.tree-row.selected')).toHaveCount(0)
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
})
