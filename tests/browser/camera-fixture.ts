import type { Page } from '@playwright/test'

/** Real browser video frames and tracks, without camera hardware or permission prompts. */
export async function installCameras(page: Page) {
  await page.addInitScript(() => {
    const fixture = {
      requests: [] as MediaStreamConstraints[],
      streams: [] as MediaStream[],
      denied: false,
      delayed: false,
      resolve: undefined as (() => void) | undefined,
      color: '#f0140a',
      devices: [
        { deviceId: 'ndi-camera', label: 'NDI Video', kind: 'videoinput' },
        { deviceId: 'usb-camera', label: 'USB Capture', kind: 'videoinput' }
      ],
      canvases: [] as { canvas: HTMLCanvasElement; deviceId: string }[]
    }
    Object.assign(window, { __TMP_CAMERAS__: fixture })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => fixture.devices
    })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        fixture.requests.push(constraints)
        if (fixture.denied) throw new DOMException('Denied', 'NotAllowedError')
        const video = constraints.video as MediaTrackConstraints
        const deviceId = ((video.deviceId as ConstrainDOMStringParameters)?.exact as string) || ''
        if (deviceId && !fixture.devices.some((device) => device.deviceId === deviceId))
          throw new DOMException('Unavailable', 'OverconstrainedError')
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 90
        fixture.canvases.push({ canvas, deviceId })
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = deviceId === 'usb-camera' ? '#14f00a' : fixture.color
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        const stream = canvas.captureStream(30)
        Object.defineProperty(stream.getVideoTracks()[0], 'label', {
          value: deviceId === 'usb-camera' ? 'USB Capture' : 'NDI Video'
        })
        fixture.streams.push(stream)
        if (fixture.delayed)
          await new Promise<void>((resolve) => {
            fixture.resolve = resolve
          })
        return stream
      }
    })
    setInterval(() => {
      for (const { canvas, deviceId } of fixture.canvases) {
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = deviceId === 'usb-camera' ? '#14f00a' : fixture.color
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }, 50)
  })
}

export async function sampleCamera(page: Page, projector = 0) {
  return page.evaluate(async (index) => {
    const engine = (window as any).__TMP_VIEWPORT__
    const { patternSamples } = await import('/tests/browser/pattern-fixture.ts' as string)
    // Sample independently so derivatives between distant test points do not
    // select a coarse mip level and blend across the entire atlas tile.
    return [
      [0.5, 0.5],
      [0.5, 0.99]
    ].map((point) => patternSamples(engine, [point], index)[0])
  }, projector)
}
