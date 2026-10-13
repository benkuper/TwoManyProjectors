<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, Play, Square } from 'lucide-svelte'
  import { editObject } from '../lib/store'
  import type { CameraInputs } from '../lib/camera-inputs'
  import type { ProjectorConfig } from '../lib/types'

  let { projector, inputs }: { projector: ProjectorConfig; inputs: CameraInputs } = $props()
  const cameraState = $derived(inputs.state)
  const deviceId = $derived(projector.camera?.deviceId ?? '')
  const connection = $derived($cameraState.connections[projector.id])
  const running = $derived(connection && connection.phase !== 'error')

  onMount(() => {
    void inputs.refreshDevices()
  })

  function selectDevice(event: Event) {
    const nextId = (event.currentTarget as HTMLSelectElement).value
    const label = $cameraState.devices.find((device) => device.deviceId === nextId)?.label
    editObject(
      projector.id,
      { camera: { deviceId: nextId, label: label || 'Default camera' } },
      'Camera input selected'
    )
  }
</script>

<div class="camera-source">
  <label class="stack-label">
    Camera input
    <select aria-label="Camera input" value={deviceId} onchange={selectDevice}>
      <option value="">Default camera</option>
      {#if deviceId && !$cameraState.devices.some((device) => device.deviceId === deviceId)}
        <option value={deviceId}>{projector.camera?.label || 'Saved camera'} (unavailable)</option>
      {/if}
      {#each $cameraState.devices.filter((device) => device.deviceId) as device}
        <option value={device.deviceId}>{device.label}</option>
      {/each}
    </select>
  </label>
  <div class="camera-actions">
    {#if running}
      <button class="wide-button" onclick={() => inputs.stop(projector.id)}>
        <Square size={13} />
        {connection?.phase === 'connecting' ? 'Cancel camera' : 'Stop camera'}
      </button>
    {:else}
      <button
        class="wide-button"
        disabled={!inputs.supported || !projector.enabled}
        onclick={() => void inputs.start(projector.id, deviceId)}
        ><Play size={13} /> Start camera</button
      >
    {/if}
    <button
      class="camera-refresh"
      aria-label="Refresh camera inputs"
      title="Refresh camera inputs"
      disabled={$cameraState.scanning || !inputs.supported}
      onclick={() => void inputs.refreshDevices()}><RefreshCw size={14} /></button
    >
  </div>
  <p class="help camera-status" role="status" class:camera-error={connection?.phase === 'error'}>
    {#if connection?.phase === 'connecting'}
      Waiting for camera access…
    {:else if connection?.phase === 'live'}
      Live · {connection.label} · {connection.width} × {connection.height}
    {:else if connection?.phase === 'muted'}
      No signal · {connection.label}
    {:else if connection?.phase === 'error'}
      {connection.error}
    {:else if !inputs.supported}
      Camera inputs require HTTPS or localhost and a browser with camera support.
    {:else if !projector.enabled}
      Enable this projector to start a camera input.
    {:else}
      Camera stopped. Press Start camera to allow access. Audio is off.
    {/if}
  </p>
  {#if $cameraState.discoveryError}<p class="help camera-error">
      {$cameraState.discoveryError}
    </p>{/if}
  <p class="help">
    Start once to reveal device names. Several projectors can share the same input.
  </p>
  <details class="source-note">
    <summary>Use NDI, including over the internet</summary>
    <p>
      Run <a
        href="https://docs.ndi.video/all/using-ndi/ndi-tools/ndi-tools-for-windows/webcam-input"
        target="_blank"
        rel="noreferrer">NDI Webcam Input</a
      >, choose your NDI source in its tray menu, then select its virtual camera here.
    </p>
    <p>
      For a remote NDI source, connect your networks with
      <a
        href="https://docs.ndi.video/all/using-ndi/ndi-tools/ndi-tools-for-windows/bridge"
        target="_blank"
        rel="noreferrer">NDI Bridge</a
      >
      first, then select the received source in Webcam Input. Bridge runs outside the browser.
    </p>
    <p>
      <a
        href="https://docs.ndi.video/all/using-ndi/ndi-tools/ndi-tools-for-windows/remote-discontinued"
        target="_blank"
        rel="noreferrer">NDI Remote has been discontinued.</a
      >
      Saved projects keep your device choice; press Start camera after reopening.
    </p>
  </details>
</div>

<style>
  .camera-source {
    margin-top: 10px;
  }
  .camera-actions {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .camera-actions .wide-button {
    flex: 1;
    margin: 0;
  }
  .camera-refresh {
    display: grid;
    place-items: center;
    width: 32px;
    flex-shrink: 0;
  }
  .camera-status {
    overflow-wrap: anywhere;
  }
  .camera-error {
    color: #f3a3a3;
  }
</style>
