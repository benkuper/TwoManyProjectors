import { writable } from 'svelte/store'
import type { ProjectorConfig } from './types'

export interface CameraConnection {
  phase: 'connecting' | 'live' | 'muted' | 'error'
  label: string
  error: string
  width: number
  height: number
}

interface CameraState {
  devices: { deviceId: string; label: string }[]
  scanning: boolean
  discoveryError: string
  connections: Record<string, CameraConnection>
}

interface CameraSession extends CameraConnection {
  deviceId: string
  users: Set<string>
  video: HTMLVideoElement
  stream?: MediaStream
  opening?: Promise<void>
  frameCallback?: number
  animationFrame?: number
  cleanup: (() => void)[]
  closed: boolean
}

function cameraError(error: unknown) {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was denied. Allow camera access in your browser settings and try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'The selected camera is unavailable. Connect it or choose another input, then try again.'
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The camera could not be opened. Check whether another application is using it.'
  return error instanceof Error ? error.message : 'Could not start the camera input.'
}

/** Explicitly started, shared camera captures. No document edit can open a device. */
export class CameraInputs {
  readonly supported = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  readonly state = writable<CameraState>({
    devices: [],
    scanning: false,
    discoveryError: '',
    connections: {}
  })
  private sessions = new Map<string, CameraSession>()
  private bindings = new Map<string, CameraSession>()
  private eligible = new Map<string, string>()
  private disposed = false

  constructor(private onFrame: (projectors: ReadonlySet<string>) => void) {
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChange)
  }

  private deviceChange = () => void this.refreshDevices()

  async refreshDevices() {
    if (this.disposed) return
    if (!this.supported) {
      this.state.update((s) => ({
        ...s,
        discoveryError:
          'Camera inputs require HTTPS or localhost and a browser with camera support.'
      }))
      return
    }
    this.state.update((s) => ({ ...s, scanning: true, discoveryError: '' }))
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
      if (!this.disposed) this.state.update((s) => ({ ...s, devices, scanning: false }))
    } catch (error) {
      if (!this.disposed)
        this.state.update((s) => ({ ...s, scanning: false, discoveryError: cameraError(error) }))
    }
  }

  sync(projectors: ProjectorConfig[]) {
    this.eligible = new Map(
      projectors.filter((p) => p.pattern === 'camera').map((p) => [p.id, p.camera?.deviceId ?? ''])
    )
    for (const [id, session] of this.bindings)
      if (!this.eligible.has(id) || this.eligible.get(id) !== session.deviceId) this.stop(id)
  }

  async start(projectorId: string, deviceId: string) {
    if (this.disposed || !this.supported || this.eligible.get(projectorId) !== deviceId) return
    this.stop(projectorId)
    let session = this.sessions.get(deviceId)
    if (!session) {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      session = {
        deviceId,
        users: new Set(),
        video,
        phase: 'connecting',
        label: '',
        error: '',
        width: 0,
        height: 0,
        cleanup: [],
        closed: false
      }
      this.sessions.set(deviceId, session)
    }
    session.users.add(projectorId)
    this.bindings.set(projectorId, session)
    this.publish()
    if (!session.opening) session.opening = this.open(session)
    await session.opening
    if (this.bindings.get(projectorId) === session) this.onFrame(new Set([projectorId]))
  }

  stop(projectorId: string) {
    const session = this.bindings.get(projectorId)
    if (!session) return
    this.bindings.delete(projectorId)
    session.users.delete(projectorId)
    if (!session.users.size) this.close(session)
    this.publish()
    this.onFrame(new Set([projectorId]))
  }

  stopAll() {
    const ids = new Set(this.bindings.keys())
    const sessions = new Set(this.bindings.values())
    this.bindings.clear()
    for (const session of sessions) {
      session.users.clear()
      this.close(session)
    }
    this.publish()
    if (ids.size) this.onFrame(ids)
  }

  videoFor(projectorId: string) {
    const session = this.bindings.get(projectorId)
    return session?.phase === 'live' && session.video.readyState >= 2 ? session.video : undefined
  }

  private current(session: CameraSession) {
    return !session.closed && !this.disposed && this.sessions.get(session.deviceId) === session
  }

  private async open(session: CameraSession) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(session.deviceId ? { deviceId: { exact: session.deviceId } } : {}),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        }
      })
      // Stop/disable/delete may happen while the browser's permission prompt is open.
      if (!this.current(session)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      session.stream = stream
      const track = stream.getVideoTracks()[0]
      if (!track || track.readyState === 'ended') throw new Error('The camera input has ended.')
      session.label = track.label || 'Camera input'
      const ended = () =>
        this.fail(session, 'The camera disconnected. Reconnect it and press Start camera.')
      const signal = () => {
        if (!this.current(session) || session.phase === 'connecting') return
        session.phase = track.muted ? 'muted' : 'live'
        this.publish()
        this.onFrame(session.users)
      }
      track.addEventListener('ended', ended)
      track.addEventListener('mute', signal)
      track.addEventListener('unmute', signal)
      session.cleanup.push(() => {
        track.removeEventListener('ended', ended)
        track.removeEventListener('mute', signal)
        track.removeEventListener('unmute', signal)
      })
      session.video.srcObject = stream
      await session.video.play()
      if (!this.current(session)) return
      session.phase = track.muted ? 'muted' : 'live'
      this.frame(session)
      void this.refreshDevices()
    } catch (error) {
      if (this.current(session)) this.fail(session, cameraError(error))
    }
  }

  private frame(session: CameraSession) {
    if (!this.current(session)) return
    const { video } = session
    if (session.width !== video.videoWidth || session.height !== video.videoHeight) {
      session.width = video.videoWidth
      session.height = video.videoHeight
      this.publish()
    } else if (!session.frameCallback && !session.animationFrame) this.publish()
    this.onFrame(session.users)
    if (typeof video.requestVideoFrameCallback === 'function')
      session.frameCallback = video.requestVideoFrameCallback(() => this.frame(session))
    else {
      const previousTime = video.currentTime
      const poll = () => {
        if (!this.current(session)) return
        if (video.currentTime !== previousTime) this.frame(session)
        else session.animationFrame = requestAnimationFrame(poll)
      }
      session.animationFrame = requestAnimationFrame(poll)
    }
  }

  private fail(session: CameraSession, error: string) {
    this.close(session)
    session.phase = 'error'
    session.error = error
    this.publish()
    this.onFrame(session.users)
  }

  private close(session: CameraSession) {
    session.closed = true
    if (this.sessions.get(session.deviceId) === session) this.sessions.delete(session.deviceId)
    if (session.frameCallback !== undefined)
      session.video.cancelVideoFrameCallback(session.frameCallback)
    if (session.animationFrame !== undefined) cancelAnimationFrame(session.animationFrame)
    session.cleanup.forEach((cleanup) => cleanup())
    session.cleanup.length = 0
    session.video.pause()
    session.video.srcObject = null
    session.stream?.getTracks().forEach((track) => track.stop())
  }

  private publish() {
    const connections: Record<string, CameraConnection> = {}
    for (const [id, { phase, label, error, width, height }] of this.bindings)
      connections[id] = { phase, label, error, width, height }
    this.state.update((s) => ({ ...s, connections }))
  }

  dispose() {
    this.disposed = true
    navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChange)
    this.stopAll()
  }
}
