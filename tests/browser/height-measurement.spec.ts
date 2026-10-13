import { test, expect, type Page } from '@playwright/test'

async function pickPlinth(page: Page) {
  await page.getByRole('button', { name: /^(Re)?pick surface point$/i }).click()
  const point = await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    const node = e.state.doc.nodes.find((node: any) => node.name === 'Test plinth')
    const group = e.nodes.get(node.id).group
    const point = group.position.clone().set(0, 0.45, 0)
    group.localToWorld(point)
    point.project(e.camera)
    const rect = e.renderer.domElement.getBoundingClientRect()
    return {
      x: rect.left + ((point.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - point.y) * rect.height) / 2
    }
  })
  await page.mouse.click(point.x, point.y)
  await expect(page.getByLabel('Projector height', { exact: true })).toContainText('1.30 m')
}

test('height dimensions toggle, survive deselection, update live, and save a picked surface reference', async ({
  page
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.viewport canvas')).toBeVisible()
  const toggle = page.getByLabel('Show height measurement', { exact: true })
  const label = page.locator('.height-dimension-label')
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(label).toContainText('2.20 m')
  await expect(label).toContainText('above Ground')
  await page.keyboard.press('Escape')
  await expect(label).toContainText('Projector 01')
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await page.getByLabel('Y', { exact: true }).fill('3.4')
  await page.getByLabel('Y', { exact: true }).press('Tab')
  await expect(label).toContainText('3.40 m')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(label).toContainText('2.20 m')
  await toggle.uncheck()
  await expect(label).toHaveCount(0)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(label).toContainText('2.20 m')
  await pickPlinth(page)
  await expect(label).toContainText('above Test plinth')
  await expect(page.locator('.height-guide')).toHaveCount(1)
  await expect(page.getByText('Picked level: 0.90 m.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Repick surface point', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Cancel height reference picking')).toHaveCount(0)
  await expect(page.getByLabel('Object name', { exact: true })).toHaveValue('Projector 01')
  await expect(label).toContainText('1.30 m')

  await page.getByRole('button', { name: 'Orthographic', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Orthographic', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(label).toContainText('1.30 m')
  await page.screenshot({ path: info.outputPath('height-surface-orthographic.png') })
  await page.getByRole('button', { name: 'Perspective', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Perspective', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.screenshot({ path: info.outputPath('height-surface-perspective.png') })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('height.tmp3d')
  await (await download).saveAs(file)
  await page.getByRole('button', { name: 'Ground (Y = 0)', exact: true }).click()
  await expect(label).toContainText('2.20 m')
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(label).toContainText('1.30 m')
  await expect(label).toContainText('above Test plinth')
  await page.reload()
  await expect(label).toContainText('1.30 m')
  expect(errors).toEqual([])
})

test('picked references follow the surface and recover after deletion is undone', async ({
  page
}) => {
  await page.goto('/')
  await expect(page.locator('.viewport canvas')).toBeVisible()
  await pickPlinth(page)
  const label = page.locator('.height-dimension-label')
  await page.getByRole('button', { name: 'Test plinth', exact: true }).click()
  await page.getByLabel('Y', { exact: true }).fill('1.45')
  await page.getByLabel('Y', { exact: true }).press('Tab')
  await expect(label).toContainText('0.30 m')
  await page.getByLabel('Y', { exact: true }).fill('3.45')
  await page.getByLabel('Y', { exact: true }).press('Tab')
  await expect(label).toContainText('1.70 m')
  await expect(label).toContainText('below Test plinth')
  await page.getByRole('button', { name: 'Test plinth', exact: true }).click()
  await page.keyboard.press('Delete')
  await expect(label).toHaveCount(0)
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await expect(page.getByText('Reference surface removed.', { exact: false })).toBeVisible()
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(label).toContainText('1.70 m')
  await expect(label).toContainText('below Test plinth')
})

test('dimensions track a live gizmo drag and keep nearby projector labels readable in top view', async ({
  page
}, info) => {
  await page.goto('/')
  await page.getByLabel('Show height measurement', { exact: true }).check()
  const labels = page.locator('.height-dimension-label')
  await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    e.transform.dispatchEvent({ type: 'dragging-changed', value: true })
    e.transform.object.position.y += 1
    e.transform.dispatchEvent({ type: 'objectChange' })
  })
  await expect(labels).toContainText('3.20 m')
  await page.evaluate(() => {
    ;(window as any).__TMP_VIEWPORT__.transform.dispatchEvent({
      type: 'dragging-changed',
      value: false
    })
  })
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(labels).toContainText('2.20 m')
  await page.getByRole('button', { name: 'Projector 01', exact: true }).click()
  await page.keyboard.press('Control+d')
  await expect(labels).toHaveCount(2)
  const bounds = await labels.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    })
  )
  expect(
    bounds[0].x + bounds[0].width <= bounds[1].x ||
      bounds[1].x + bounds[1].width <= bounds[0].x ||
      bounds[0].y + bounds[0].height <= bounds[1].y ||
      bounds[1].y + bounds[1].height <= bounds[0].y
  ).toBe(true)

  await page.keyboard.press('Escape')
  await page.screenshot({ path: info.outputPath('heights-deselected.png') })
  await page.evaluate(() => {
    const e = (window as any).__TMP_VIEWPORT__
    e.camera.position.set(0, 20, 6)
    e.controls.target.set(0, 0, 6)
    e.controls.update()
    e.invalidate()
  })
  await expect(labels).toHaveCount(2)
  await expect(labels.nth(0)).toContainText('2.20 m')
  await expect(labels.nth(1)).toContainText('2.20 m')
  await expect
    .poll(() =>
      page
        .locator('.height-dimension-line')
        .evaluateAll((lines) =>
          lines.every((line) => !/NaN|Infinity/.test(line.getAttribute('d') ?? ''))
        )
    )
    .toBe(true)
  await page.screenshot({ path: info.outputPath('heights-top-view.png') })
})
