<script lang="ts">
  import { onMount } from 'svelte'
  import { T, useTask, useThrelte } from '@threlte/core'
  import { Gizmo, Grid } from '@threlte/extras'
  import { PerspectiveCamera, type OrthographicCamera, type WebGLRenderer } from 'three'
  import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
  import type { ViewportGizmo } from 'three-viewport-gizmo'
  import { ViewportEngine } from '../lib/engine'
  import { editor } from '../lib/store'
  let { onready }: { onready: (engine: ViewportEngine) => void } = $props()
  const context = useThrelte<WebGLRenderer>()
  const { size } = context
  let engine = $state.raw<ViewportEngine>(),
    controls = $state.raw<OrbitControls>()
  let gizmo = $state.raw<ViewportGizmo>()
  $effect(() => {
    if (gizmo && import.meta.env.DEV) Object.assign(window, { __TMP_GIZMO__: gizmo })
  })
  let activeCamera = $state.raw<PerspectiveCamera | OrthographicCamera>(
    new PerspectiveCamera(45, context.size.current.width / context.size.current.height, 0.01, 10000)
  )
  onMount(() => {
    engine = new ViewportEngine(
      context.scene,
      context.renderer,
      activeCamera,
      context.invalidate,
      (c) => (activeCamera = c),
      (c) => (controls = c)
    )
    onready(engine)
    return () => engine?.dispose()
  })
  $effect(() => {
    if (engine) engine.resize($size.width, $size.height)
  })
  useTask((delta) => engine?.tick(delta), { autoInvalidate: false })
  let before = 0,
    rendered = false
  let gridScale = $state(1)
  useTask(
    () => {
      if (engine) {
        const distance = engine.camera.position.distanceTo(engine.controls.target)
        gridScale = 10 ** Math.floor(Math.log10(Math.max(1, distance) / 8))
      }
    },
    { autoInvalidate: false }
  )
  useTask(
    () => {
      rendered = context.shouldRender()
      before = performance.now()
    },
    { before: context.autoRenderTask, autoInvalidate: false }
  )
  useTask(
    () => {
      if (engine && rendered)
        engine.frameDuration = engine.frameDuration * 0.8 + (performance.now() - before) * 0.2
    },
    { after: context.autoRenderTask, autoInvalidate: false }
  )
  const outlineTask = useTask(
    () => {
      if (engine && rendered) engine.selection.render(context.renderer, engine.camera)
    },
    { after: context.autoRenderTask, autoInvalidate: false }
  )
</script>

<T is={activeCamera} makeDefault manual />
{#if $editor.doc.settings.grid}<Grid
    infiniteGrid
    followCamera
    cellSize={gridScale}
    sectionSize={gridScale * 5}
    cellColor="#323945"
    sectionColor="#434d5b"
    cellThickness={0.6}
    sectionThickness={0.8}
    fadeDistance={gridScale * 80}
    fadeStrength={1.5}
    position={[0, -0.012, 0]}
  />{/if}
{#if controls}
  <Gizmo
    bind:ref={gizmo}
    id="view-cube"
    {controls}
    type="cube"
    placement="top-right"
    size={98}
    offset={{ top: 62, right: 20 }}
    renderTask={{ after: outlineTask.task }}
    animated
    speed={1.3}
    background={{ enabled: false }}
    x={{ label: 'RIGHT', color: '#353d49', labelColor: '#dce2e9', hover: { color: '#7c9c55' } }}
    y={{ label: 'TOP', color: '#353d49', labelColor: '#dce2e9', hover: { color: '#7c9c55' } }}
    z={{ label: 'FRONT', color: '#353d49', labelColor: '#dce2e9', hover: { color: '#7c9c55' } }}
    nx={{ label: 'LEFT' }}
    ny={{ label: 'BOTTOM' }}
    nz={{ label: 'BACK' }}
    corners={{ enabled: true, color: '#424d5e', hover: { color: '#b5ed76' } }}
    edges={{ enabled: true, color: '#424d5e', hover: { color: '#b5ed76' } }}
  />
{/if}
