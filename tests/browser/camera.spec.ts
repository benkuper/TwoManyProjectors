import { test, expect } from '@playwright/test'
import { installCameras, sampleCamera } from './camera-fixture'

test.beforeEach(async ({ page }) => {
  await installCameras(page)
  await page.goto('/')
  await page.waitForFunction(() => {
    const e = (window as any).__TMP_VIEWPORT__
    return e && !e.state.recovering && e.projection.projectors.length
  })
})

test('camera video updates the GPU projection, fits correctly, and stops on source changes', async ({
  page
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'Camera / NDI', exact: true }).click()
  await page.getByLabel('Camera input', { exact: true }).selectOption('ndi-camera')
  expect(await page.evaluate(() => (window as any).__TMP_CAMERAS__.requests.length)).toBe(0)
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Live · NDI Video' })).toBeVisible()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [240, 20, 10],
      [0, 0, 0]
    ])
  const constraints = await page.evaluate(() => (window as any).__TMP_CAMERAS__.requests[0])
  expect(constraints.audio).toBe(false)
  expect(constraints.video.deviceId).toEqual({ exact: 'ndi-camera' })
  await page.evaluate(() => {
    ;(window as any).__TMP_CAMERAS__.color = '#0a14f0'
  })
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [10, 20, 240],
      [0, 0, 0]
    ])
  for (const fit of ['cover', 'stretch']) {
    await page.getByLabel('Camera fit', { exact: true }).selectOption(fit)
    await expect
      .poll(() => sampleCamera(page))
      .toEqual([
        [10, 20, 240],
        [10, 20, 240]
      ])
  }
  await page.getByRole('button', { name: 'Stop camera', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('camera-input.png') })
  await page.getByRole('button', { name: 'White', exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as any).__TMP_CAMERAS__.streams[0].getVideoTracks()[0].readyState
    )
  ).toBe('ended')
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [0, 0, 0],
      [0, 0, 0]
    ])
  expect(await page.evaluate(() => (window as any).__TMP_CAMERAS__.requests.length)).toBe(1)
  expect(errors).toEqual([])
})

test('projectors share captures, preserve other inputs, and release disabled or deleted captures', async ({
  page
}) => {
  await page.getByRole('button', { name: 'Camera / NDI', exact: true }).click()
  await page.getByLabel('Camera input', { exact: true }).selectOption('ndi-camera')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [240, 20, 10],
      [0, 0, 0]
    ])
  await page.getByRole('button', { name: 'Add projector', exact: true }).click()
  await page.getByRole('button', { name: 'Camera / NDI', exact: true }).click()
  await page.getByLabel('Camera input', { exact: true }).selectOption('ndi-camera')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page, 1))
    .toEqual([
      [240, 20, 10],
      [0, 0, 0]
    ])
  expect(await page.evaluate(() => (window as any).__TMP_CAMERAS__.requests.length)).toBe(1)
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page, 1))
    .toEqual([
      [0, 0, 0],
      [0, 0, 0]
    ])
  expect(
    await page.evaluate(
      () => (window as any).__TMP_CAMERAS__.streams[0].getVideoTracks()[0].readyState
    )
  ).toBe('live')
  await page.getByLabel('Camera input', { exact: true }).selectOption('usb-camera')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page, 1))
    .toEqual([
      [20, 240, 10],
      [0, 0, 0]
    ])
  await page.getByRole('button', { name: 'Disable Projector 01', exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as any).__TMP_CAMERAS__.streams[0].getVideoTracks()[0].readyState
    )
  ).toBe('ended')
  // The remaining projector moves to atlas tile zero and keeps receiving its own input.
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [20, 240, 10],
      [0, 0, 0]
    ])
  await page.getByLabel('Delete selected', { exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as any).__TMP_CAMERAS__.streams[1].getVideoTracks()[0].readyState
    )
  ).toBe('ended')
})

test('permission failures, disconnects, unavailable devices and canceled requests remain recoverable', async ({
  page
}) => {
  await page.getByRole('button', { name: 'Camera / NDI', exact: true }).click()
  await page.getByLabel('Camera input', { exact: true }).selectOption('ndi-camera')
  await page.evaluate(() => {
    ;(window as any).__TMP_CAMERAS__.denied = true
  })
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Camera access was denied' })
  ).toBeVisible()
  await page.evaluate(() => {
    ;(window as any).__TMP_CAMERAS__.denied = false
  })
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [240, 20, 10],
      [0, 0, 0]
    ])
  await page.evaluate(() => {
    const track = (window as any).__TMP_CAMERAS__.streams[0].getVideoTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByRole('status').filter({ hasText: 'camera disconnected' })).toBeVisible()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [0, 0, 0],
      [0, 0, 0]
    ])
  await page.evaluate(() => {
    ;(window as any).__TMP_CAMERAS__.delayed = true
  })
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel camera', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel camera', exact: true }).click()
  await page.evaluate(() => {
    ;(window as any).__TMP_CAMERAS__.resolve()
  })
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__TMP_CAMERAS__.streams[1].getVideoTracks()[0].readyState)
    )
    .toBe('ended')
  await page.evaluate(() => {
    const fixture = (window as any).__TMP_CAMERAS__
    fixture.delayed = false
    fixture.devices = fixture.devices.filter((device: any) => device.deviceId !== 'ndi-camera')
  })
  await page.getByRole('button', { name: 'Refresh camera inputs', exact: true }).click()
  await expect(
    page.getByLabel('Camera input', { exact: true }).locator('option:checked')
  ).toHaveText('NDI Video (unavailable)')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'selected camera is unavailable' })
  ).toBeVisible()
})

test('opening the same project stops capture, while preferences survive archive and reload', async ({
  page
}, info) => {
  await page.getByRole('button', { name: 'Camera / NDI', exact: true }).click()
  await page.getByLabel('Camera input', { exact: true }).selectOption('ndi-camera')
  await page.getByLabel('Camera fit', { exact: true }).selectOption('cover')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [240, 20, 10],
      [240, 20, 10]
    ])
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project', exact: true }).click()
  const file = info.outputPath('camera.tmp3d')
  await (await downloaded).saveAs(file)
  await page.getByLabel('Open project file').setInputFiles(file)
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  await expect(page.getByLabel('Camera input', { exact: true })).toHaveValue('ndi-camera')
  await expect(page.getByLabel('Camera fit', { exact: true })).toHaveValue('cover')
  expect(
    await page.evaluate(
      () => (window as any).__TMP_CAMERAS__.streams[0].getVideoTracks()[0].readyState
    )
  ).toBe('ended')
  await page.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect
    .poll(() => sampleCamera(page))
    .toEqual([
      [240, 20, 10],
      [240, 20, 10]
    ])
  await page.reload()
  await expect(page.getByLabel('Camera input', { exact: true })).toHaveValue('ndi-camera')
  await expect(page.getByLabel('Camera fit', { exact: true })).toHaveValue('cover')
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__TMP_CAMERAS__.requests.length)).toBe(0)
})
