import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.transform.object
  })
}

// Choose a point on a visible handle using its real geometry and hit-test it.
// The interaction itself always goes through mouse events, never synthetic control events.
async function handlePoint(page: Page, axis = 'X') {
  return page.evaluate((axis) => {
    const e = (window as any).__TMP_VIEWPORT__,
      t = e.transform
    t.getHelper().updateMatrixWorld(true)
    const gizmo = t.getHelper().children[0],
      visible = gizmo.gizmo[t.getMode()].children.filter((o: any) => o.name === axis && o.visible),
      ray = t.getRaycaster(),
      rect = e.renderer.domElement.getBoundingClientRect()
    for (const mesh of visible) {
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
    throw new Error(`No hittable ${axis} handle for ${t.getMode()}`)
  }, axis)
}

test('gizmos highlight and transform with real drags; selection keeps the tool and Escape clears it', async ({
  page
}, info) => {
  await ready(page)
  await page.keyboard.press('w')
  const point = await handlePoint(page)
  await page.mouse.move(point.x, point.y)
  await expect
    .poll(() => page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.axis))
    .toBe('X')
  const highlighted = await page.evaluate(() => {
    const t = (window as any).__TMP_VIEWPORT__.transform
    return t
      .getHelper()
      .children[0].gizmo.translate.children.some(
        (o: any) => o.name === 'X' && o.material.color.getHexString() === 'ffff00'
      )
  })
  expect(highlighted).toBe(true)
  const before = await page.getByLabel('X', { exact: true }).inputValue()
  await page.mouse.down()
  await expect
    .poll(() => page.evaluate(() => (window as any).__TMP_VIEWPORT__.controls.enabled))
    .toBe(false)
  await page.mouse.move(point.x + 55, point.y + 8, { steps: 8 })
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpOrigins.value[0].x
      )
    )
    .not.toBe(Number(before))
  await page.mouse.up()
  await expect(page.getByLabel('X', { exact: true })).not.toHaveValue(before)
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue(before)
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()

  await page.keyboard.press('r')
  await page.getByRole('button', { name: 'Test plinth', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.getMode()))
    .toBe('rotate')
  const rotation = await handlePoint(page, 'Y')
  await page.mouse.move(rotation.x, rotation.y)
  await page.mouse.down()
  await page.mouse.move(rotation.x + 35, rotation.y + 22, { steps: 8 })
  await page.mouse.up()
  const rotated = await page.getByLabel('Y rotation', { exact: true }).inputValue()
  expect(Number(rotated)).not.toBe(0)

  await page.keyboard.press('s')
  const scale = await handlePoint(page)
  await page.mouse.move(scale.x, scale.y)
  await page.mouse.down()
  await page.mouse.move(scale.x + 30, scale.y + 5, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByLabel('X scale', { exact: true })).not.toHaveValue('1')
  // A positive minimum must not prevent typing a fractional value from its leading zero.
  const xScale = page.getByLabel('X scale', { exact: true })
  await xScale.fill('')
  await xScale.pressSequentially('0.25')
  await xScale.press('Tab')
  await expect(xScale).toHaveValue('0.25')
  await page.screenshot({ path: info.outputPath('selected-contour.png') })
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return (
        e.selection.target === e.nodes.get(e.state.selected).group && e.selection.copies.length > 0
      )
    })
  ).toBe(true)
  await page.keyboard.press('Escape')
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return {
        selected: e.state.selected,
        attached: !!e.transform.object,
        contour: !!e.selection.target,
        tool: e.state.tool
      }
    })
  ).toEqual({ selected: null, attached: false, contour: false, tool: 'scale' })
})

test('rotation rings follow the selected object local axes and a real drag preserves that axis', async ({
  page
}) => {
  await ready(page)
  await page.getByRole('button', { name: 'Test plinth', exact: true }).click()
  for (const [label, value] of [
    ['X rotation', '25'],
    ['Y rotation', '35'],
    ['Z rotation', '15']
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel(label, { exact: true }).press('Tab')
  }
  await page.getByRole('button', { name: 'Rotate', exact: true }).click()
  const before = await page.evaluate(() => {
    const t = (window as any).__TMP_VIEWPORT__.transform
    t.getHelper().updateMatrixWorld(true)
    const ring = t.getHelper().children[0].gizmo.rotate.children.find((o: any) => o.name === 'Y')
    const axis = t.object.position.clone().set(0, 1, 0)
    return {
      space: t.space,
      object: t.object.quaternion.toArray(),
      objectAxis: axis.clone().applyQuaternion(t.object.quaternion).toArray(),
      ringAxis: axis.applyQuaternion(ring.quaternion).toArray()
    }
  })
  expect(before.space).toBe('local')
  before.ringAxis.forEach((v: number, i: number) => expect(v).toBeCloseTo(before.objectAxis[i], 5))
  const point = await handlePoint(page, 'Y')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 40, point.y + 25, { steps: 8 })
  await page.mouse.up()
  const rotated = await page.evaluate((before) => {
    const t = (window as any).__TMP_VIEWPORT__.transform
    // A local Y rotation preserves the object's Y axis in world space.
    const start = t.object.quaternion.clone().fromArray(before.object)
    const axis = t.object.position.clone().set(0, 1, 0)
    return {
      beforeAxis: axis.clone().applyQuaternion(start).toArray(),
      afterAxis: axis.applyQuaternion(t.object.quaternion).toArray(),
      quaternion: t.object.quaternion.toArray()
    }
  }, before)
  expect(rotated.quaternion).not.toEqual(before.object)
  rotated.afterAxis.forEach((v: number, i: number) =>
    expect(v).toBeCloseTo(rotated.beforeAxis[i], 5)
  )
  await page.getByLabel('Undo', { exact: true }).click()
  expect(
    await page.evaluate(() =>
      (window as any).__TMP_VIEWPORT__.transform.object.quaternion.toArray()
    )
  ).toEqual(before.object)
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.transform.space)).toBe('world')
})

test('number scrubbing and shift sliders update simulation before release and undo once', async ({
  page
}) => {
  await ready(page)
  const multiplier = page.getByLabel('Multiplier', { exact: true }),
    box = (await multiplier.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 8 })
  await expect(multiplier).toHaveValue('2')
  expect(
    await page.evaluate(
      () => (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpOutput.value[0].x
    )
  ).toBe(12000)
  await page.mouse.up()
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(multiplier).toHaveValue('1')
  await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()

  for (const [label, component] of [
    ['Horizontal shift', 'z'],
    ['Vertical shift', 'w']
  ] as const) {
    const slider = page.getByLabel(`${label} slider`, { exact: true }),
      b = (await slider.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2, { steps: 8 })
    await expect
      .poll(() =>
        page.evaluate(
          (component) =>
            (window as any).__TMP_VIEWPORT__.projection.uniforms.tmpOptics.value[0][component],
          component
        )
      )
      .not.toBe(0)
    await page.mouse.up()
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('0')
    await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  }
})

test('shared opacity applies to every projector and viewport resizes both cameras', async ({
  page
}) => {
  await ready(page)
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await page.getByLabel('Volume opacity', { exact: true }).fill('0.18')
  await page.getByLabel('Volume opacity', { exact: true }).press('Tab')
  await page.getByLabel('Outline opacity', { exact: true }).fill('0.7')
  await page.getByLabel('Outline opacity', { exact: true }).press('Tab')
  expect(
    await page.evaluate(() => {
      const e = (window as any).__TMP_VIEWPORT__
      return [...e.projectors.values()].map((g: any) => ({
        volume: g.children.find((o: any) => o.isMesh && o.material.transparent).material.opacity,
        outline: g.children.find((o: any) => o.isLineSegments).material.opacity
      }))
    })
  ).toEqual([
    { volume: 0.18, outline: 0.7 },
    { volume: 0.18, outline: 0.7 }
  ])
  for (const ortho of [false, true]) {
    if (ortho) await page.keyboard.press('o')
    for (const [width, height] of [
      [1250, 800],
      [1700, 1000]
    ]) {
      await page.setViewportSize({ width, height })
      const resizer = page.getByLabel('Resize inspector', { exact: true })
      await resizer.focus()
      await resizer.press('ArrowLeft')
      await expect
        .poll(() =>
          page.evaluate(() => {
            const e = (window as any).__TMP_VIEWPORT__,
              c = e.camera,
              rect = e.renderer.domElement.getBoundingClientRect(),
              aspect = c.isPerspectiveCamera ? c.aspect : (c.right - c.left) / (c.top - c.bottom)
            return Math.abs(aspect - rect.width / rect.height)
          })
        )
        .toBeLessThan(0.0001)
    }
  }
})

for (const label of ['Volume opacity', 'Outline opacity', 'Horizontal shift', 'Vertical shift']) {
  test(`${label} number keeps scrubbing through rendered value changes`, async ({ page }) => {
    await ready(page)
    const input = page.getByLabel(label, { exact: true })
    await input.click()
    const box = (await input.boundingBox())!
    const start = Number(await input.inputValue())
    const step = Number(await input.getAttribute('step'))
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (const delta of [5, 15, 25, 15, -5]) {
      await page.mouse.move(x + delta, y, { steps: 4 })
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      await expect(input).toHaveValue(String(Number((start + delta * step).toFixed(6))))
      expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.interacting)).toBe(
        true
      )
    }
    await page.mouse.up()
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(input).toHaveValue(String(start))
    await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  })

  test(`${label} slider keeps dragging through rendered value changes`, async ({ page }) => {
    await ready(page)
    const slider = page.getByLabel(`${label} slider`, { exact: true })
    await slider.scrollIntoViewIfNeeded()
    const box = (await slider.boundingBox())!
    const { min, max, step, value } = await slider.evaluate((input: HTMLInputElement) => ({
      min: Number(input.min),
      max: Number(input.max),
      step: Number(input.step),
      value: input.valueAsNumber
    }))
    const x = (fraction: number) => box.x + 7 + (box.width - 14) * fraction
    const y = box.y + box.height / 2
    await page.mouse.move(x((value - min) / (max - min)), y)
    await page.mouse.down()
    for (const fraction of [0.6, 0.8, 0.4, 0.2, 0.65]) {
      // Captured dragging must continue even when the pointer leaves the thin track.
      await page.mouse.move(x(fraction), y - 24, { steps: 4 })
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      )
      const expected = min + Math.round(((max - min) * fraction) / step) * step
      expect(Number(await slider.inputValue())).toBeCloseTo(expected, 4)
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(expected))
      expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.interacting)).toBe(
        true
      )
    }
    await page.mouse.up()
    expect(await page.evaluate(() => (window as any).__TMP_VIEWPORT__.state.interacting)).toBe(
      false
    )
    await page.getByLabel('Undo', { exact: true }).click()
    await expect(slider).toHaveValue(String(value))
    await expect(page.getByLabel('Undo', { exact: true })).toBeDisabled()
  })
}

for (const orthographic of [false, true]) {
  test(`${orthographic ? 'orthographic' : 'perspective'} camera pans with middle drag and zooms with right drag`, async ({
    page
  }) => {
    await ready(page)
    await page.keyboard.press('Escape')
    if (orthographic) await page.keyboard.press('o')
    const viewport = (await page.locator('.viewport').boundingBox())!
    const x = viewport.x + viewport.width * 0.45
    const y = viewport.y + viewport.height * 0.45
    const snapshot = () =>
      page.evaluate(() => {
        const e = (window as any).__TMP_VIEWPORT__
        return {
          position: e.camera.position.toArray() as number[],
          target: e.controls.target.toArray() as number[],
          offset: e.camera.position.clone().sub(e.controls.target).toArray() as number[],
          distance: e.camera.position.distanceTo(e.controls.target) as number,
          zoom: e.camera.zoom as number
        }
      })
    const drag = async (button: 'left' | 'middle' | 'right', dx: number, dy: number) => {
      await page.mouse.move(x, y)
      await page.mouse.down({ button })
      await page.mouse.move(x + dx, y + dy, { steps: 8 })
      await page.mouse.up({ button })
      // Let damping settle before comparing the effects of separate gestures.
      await page.evaluate(async () => {
        const e = (window as any).__TMP_VIEWPORT__
        for (let frame = 0; frame < 120; frame++) {
          const previous = e.camera.position.clone()
          e.controls.update()
          if (previous.distanceToSquared(e.camera.position) < 1e-18) break
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
      })
      return snapshot()
    }
    const before = await snapshot()
    const panned = await drag('middle', 65, 35)
    expect(panned.position).not.toEqual(before.position)
    expect(panned.target).not.toEqual(before.target)
    panned.offset.forEach((v, i) => expect(v).toBeCloseTo(before.offset[i], 5))
    expect(panned.zoom).toBe(before.zoom)

    const zoomedOut = await drag('right', 0, 45)
    zoomedOut.target.forEach((v, i) => expect(v).toBeCloseTo(panned.target[i], 7))
    if (orthographic) expect(zoomedOut.zoom).toBeLessThan(panned.zoom)
    else expect(zoomedOut.distance).toBeGreaterThan(panned.distance)
    const zoomedIn = await drag('right', 0, -45)
    zoomedIn.target.forEach((v, i) => expect(v).toBeCloseTo(panned.target[i], 7))
    if (orthographic) expect(zoomedIn.zoom).toBeGreaterThan(zoomedOut.zoom)
    else expect(zoomedIn.distance).toBeLessThan(zoomedOut.distance)

    const orbited = await drag('left', 65, 35)
    expect(orbited.position).not.toEqual(zoomedIn.position)
    orbited.target.forEach((v, i) => expect(v).toBeCloseTo(zoomedIn.target[i], 7))
    expect(orbited.distance).toBeCloseTo(zoomedIn.distance, 5)
  })
}

test('an immediate reload restores edits and original imported resources automatically', async ({
  page
}) => {
  await ready(page)
  await page
    .getByLabel('Import asset files')
    .setInputFiles(path.resolve('public/samples/triangle.glb'))
  await page.getByRole('button', { name: 'Import 1 file', exact: true }).click()
  await expect(page.locator('.busy-toast')).toHaveCount(0)
  await page.getByLabel('Project name', { exact: true }).fill('')
  await page.getByLabel('Project name', { exact: true }).pressSequentially('Automatic session')
  await page.getByLabel('X', { exact: true }).fill('3.75')
  // Deliberately reload without blur or an autosave delay.
  await page.reload()
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Automatic session')
  await expect(page.getByRole('button', { name: 'triangle', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'triangle', exact: true }).click()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('3.75')
  await expect(page.locator('.recovery-toast')).toHaveCount(0)
  await expect(page.locator('.error-toast')).toHaveCount(0)
  expect(
    await page.evaluate(async () => {
      const { originalFiles } = await import('/src/lib/assets.ts' as string)
      return [...originalFiles.values()].every((file: any) => file.size > 0)
    })
  ).toBe(true)
})
