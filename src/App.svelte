<script lang="ts">
  import { onMount } from 'svelte'
  import { Canvas } from '@threlte/core'
  import { WebGLRenderer, Vector3 } from 'three'
  import {
    ArrowUpFromLine,
    Box,
    ChevronDown,
    ChevronRight,
    CircleHelp,
    Copy,
    Crosshair,
    Eye,
    EyeOff,
    FilePlus2,
    FolderOpen,
    Folders,
    Gauge,
    Grid2X2,
    GripVertical,
    Home,
    Highlighter,
    Layers,
    Lock,
    LockOpen,
    Maximize,
    Monitor,
    MousePointer2,
    Move3D,
    Plus,
    Redo2,
    Rotate3D,
    Ruler,
    Save,
    ScanLine,
    ShieldCheck,
    Sun,
    Trash2,
    Undo2,
    Upload,
    X
  } from 'lucide-svelte'
  import Scene from './components/Scene.svelte'
  import Inspector from './components/Inspector.svelte'
  import NumberField from './components/NumberField.svelte'
  import ProjectorVersions from './components/ProjectorVersions.svelte'
  import ProjectExplorer from './components/ProjectExplorer.svelte'
  import HeightMeasurements from './components/HeightMeasurements.svelte'
  import {
    editor,
    addNode,
    addProjector,
    moveProjector,
    commit,
    beginEdit,
    endEdit,
    select,
    selectAll,
    toggleProjector,
    toggleObjectLock,
    editObject,
    undo,
    redo,
    removeAsset,
    removeSelected,
    duplicateSelected,
    updateUI
  } from './lib/store'
  import { importFiles, cancelImport, addAssetToScene } from './lib/assets'
  import {
    autosave,
    createProject,
    hydrate,
    openProject,
    readRecovery,
    saveProject
  } from './lib/persistence'
  import { scaleAroundAnchor } from './lib/optics'
  import { analysisProjectors } from './lib/analysis'
  import {
    luxBandColors,
    luxTargetColors,
    overlapColors,
    type AssetRecord,
    type AnalysisMode,
    type LuxDisplay,
    type SceneDocument
  } from './lib/types'
  import type { ViewportEngine } from './lib/engine'
  let engine = $state.raw<ViewportEngine>(),
    assetInput: HTMLInputElement,
    projectInput: HTMLInputElement,
    projectExplorer: ProjectExplorer
  let showImport = $state(false),
    showHelp = $state(false),
    showAdd = $state(false),
    pendingFiles = $state<File[]>([]),
    units = $state<AssetRecord['units']>('auto'),
    up = $state<AssetRecord['upAxis']>('y'),
    flipAxes = $state<[boolean, boolean, boolean]>([false, false, false]),
    dragging = $state(false)
  const assetDragType = 'application/x-twomanyprojectors-asset'
  const projectorDragType = 'application/x-twomanyprojectors-projector'
  let draggedProjector = $state<string | null>(null)
  let projectorDrop = $state<{ id: string; after: boolean } | null>(null)
  let realDistance = $state(1),
    calibrationUnit = $state('m')
  let treeWidth = $state(244),
    inspectorWidth = $state(302),
    renderError = $state('')
  const selected = $derived(
    [...$editor.doc.nodes, ...$editor.doc.projectors].find((n) => n.id === $editor.selected)
  )
  const activeCount = $derived($editor.doc.projectors.filter((p) => p.enabled).length)
  const analysisScope = $derived(analysisProjectors($editor.doc, $editor.selectedIds))
  const luxTargetView = $derived(
    $editor.doc.settings.analysis === 'lux' && $editor.doc.settings.luxDisplay === 'target'
  )
  const analysisRange = $derived(
    luxTargetView ? $editor.doc.settings.luxTarget : $editor.doc.settings.range
  )
  const measured = $derived(
    $editor.calibration.length === 2
      ? new Vector3()
          .fromArray($editor.calibration[0])
          .distanceTo(new Vector3().fromArray($editor.calibration[1]))
      : null
  )
  const tools = [
    { id: 'select', icon: MousePointer2, name: 'Select', key: 'V' },
    { id: 'translate', icon: Move3D, name: 'Move', key: 'W' },
    { id: 'rotate', icon: Rotate3D, name: 'Rotate', key: 'R' },
    { id: 'scale', icon: Maximize, name: 'Scale', key: 'S' },
    { id: 'probe', icon: Crosshair, name: 'Probe', key: 'P' }
  ] as const
  const modes: { id: AnalysisMode; label: string }[] = [
    { id: 'preview', label: 'Projection' },
    { id: 'lux', label: 'Illuminance' },
    { id: 'density', label: 'Pixel density' },
    { id: 'distortion', label: 'Distortion' },
    { id: 'overlap', label: 'Overlap' }
  ]
  function setting(patch: Partial<SceneDocument['settings']>) {
    commit('View settings updated', (d) => Object.assign(d.settings, patch))
  }
  function analysisLimit(index: 0 | 1, value: number) {
    const range: [number, number] = [...analysisRange]
    range[index] = value
    if (range[0] >= range[1] || (luxTargetView && range[0] < 0)) return
    setting(luxTargetView ? { luxTarget: range } : { range })
  }
  function mode(value: AnalysisMode) {
    setting({
      analysis: value,
      range: value === 'overlap' ? [0, 8] : value === 'distortion' ? [1, 5] : [0, 500]
    })
  }
  function chooseFiles(event: Event) {
    pendingFiles = Array.from((event.target as HTMLInputElement).files ?? [])
    showImport = !!pendingFiles.length
    ;(event.target as HTMLInputElement).value = ''
  }
  async function doImport() {
    showImport = false
    await importFiles(pendingFiles, units, up, flipAxes)
    pendingFiles = []
  }
  function drop(event: DragEvent) {
    event.preventDefault()
    dragging = false
    const assetId = event.dataTransfer?.getData(assetDragType)
    if (assetId) {
      if (engine && (event.target as Element).closest('.viewport')) {
        const point = engine.placementPoint(event.clientX, event.clientY)
        if (point) addAssetToScene(assetId, point)
        else updateUI({ notice: 'Drop onto a surface or the ground grid to place the asset' })
      }
      return
    }
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 1 && files[0].name.endsWith('.tmp3d')) void openProject(files[0])
    else if (files.length) {
      pendingFiles = files
      showImport = true
    }
  }
  function dragAsset(event: DragEvent, id: string) {
    if (!event.dataTransfer) return
    event.dataTransfer.setData(assetDragType, id)
    event.dataTransfer.effectAllowed = 'copy'
  }
  function dragProjector(event: DragEvent, id: string) {
    if (!event.dataTransfer) return
    endEdit()
    event.dataTransfer.setData(projectorDragType, id)
    event.dataTransfer.effectAllowed = 'move'
    draggedProjector = id
  }
  function projectorDragOver(event: DragEvent, id: string) {
    if (!event.dataTransfer?.types.includes(projectorDragType)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    projectorDrop = { id, after: event.clientY >= rect.top + rect.height / 2 }
  }
  function dropProjector(event: DragEvent, id: string) {
    if (!event.dataTransfer?.types.includes(projectorDragType)) return
    event.preventDefault()
    event.stopPropagation()
    const projectors = $editor.doc.projectors
    const from = projectors.findIndex(
      (p) => p.id === event.dataTransfer!.getData(projectorDragType)
    )
    const target = projectors.findIndex((p) => p.id === id)
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const insertion = target + (event.clientY >= rect.top + rect.height / 2 ? 1 : 0)
    if (from >= 0 && target >= 0)
      moveProjector(projectors[from].id, insertion - (from < insertion ? 1 : 0))
    draggedProjector = null
    projectorDrop = null
  }
  function focusAsset(id: string) {
    const node = $editor.doc.nodes.find((n) => n.assetId === id)
    if (node) {
      if (node.locked)
        return updateUI({ notice: `${node.name} is locked. Unlock it in the scene list.` })
      if (!node.visible) editObject(node.id, { visible: true })
      select(node.id)
      engine?.frame()
    } else addAssetToScene(id)
  }
  function resize(event: PointerEvent, side: 'left' | 'right') {
    const start = event.clientX,
      initial = side === 'left' ? treeWidth : inspectorWidth
    const move = (event: PointerEvent) => {
      if (side === 'left') treeWidth = Math.max(190, Math.min(400, initial + event.clientX - start))
      else inspectorWidth = Math.max(270, Math.min(460, initial - event.clientX + start))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }
  function previewCalibration() {
    if (!selected || $editor.calibration.length !== 2) return
    try {
      updateUI({
        calibrationPreview: scaleAroundAnchor(
          selected.transform,
          ...($editor.calibration as [[number, number, number], [number, number, number]]),
          realDistance * ({ m: 1, cm: 0.01, mm: 0.001, ft: 0.3048 }[calibrationUnit] ?? 1)
        ),
        error: ''
      })
    } catch (e) {
      updateUI({ error: (e as Error).message })
    }
  }
  function cancelCalibration() {
    updateUI({ tool: 'translate', calibration: [], calibrationPreview: null })
  }
  function applyCalibration() {
    if (!selected) return
    previewCalibration()
    if ($editor.calibrationPreview) {
      editObject(selected.id, { transform: $editor.calibrationPreview }, 'Applied two-point scale')
      cancelCalibration()
    }
  }
  function keyboard(event: KeyboardEvent) {
    if (event.defaultPrevented || document.querySelector('dialog[open]')) return
    if (event.key === 'Escape') {
      if ($editor.tool === 'height-reference') {
        updateUI({ tool: 'select', error: '', notice: 'Height reference picking cancelled' })
        return
      }
      if (engine?.transform.dragging) {
        engine.transform.reset()
        engine.transform.pointerUp(null)
      }
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      endEdit()
      select(null)
      showImport = showHelp = showAdd = false
      updateUI({ error: '', probe: null, calibration: [], calibrationPreview: null })
      return
    }
    if ((event.target as HTMLElement).matches('input,textarea,select') || event.altKey) return
    const mod = event.ctrlKey || event.metaKey
    if (mod) {
      if (event.key === 'z') {
        event.preventDefault()
        event.shiftKey ? redo() : undo()
      } else if (event.key === 'y') {
        event.preventDefault()
        redo()
      } else if (event.key === 's') {
        event.preventDefault()
        void saveProject()
      } else if (event.key === 'o') {
        event.preventDefault()
        projectInput.click()
      } else if (event.key === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAll()
      }
      return
    }
    const tool = tools.find((t) => t.key.toLowerCase() === event.key.toLowerCase())
    if (tool) {
      updateUI({ tool: tool.id, calibrationPreview: null })
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelected()
    }
    if (event.key.toLowerCase() === 'f') engine?.frame()
    if (event.key === 'Home') {
      event.preventDefault()
      engine?.frame(true)
    }
    if (event.key.toLowerCase() === 'o') updateUI({ orthographic: !$editor.orthographic })
    if (event.key === '?') showHelp = true
  }
  onMount(() => {
    let ready = false,
      disposed = false,
      revision = $editor.revision,
      interacting = false
    updateUI({ recovering: true })
    void (async () => {
      try {
        const recovery = await readRecovery()
        if (disposed) return
        if (recovery) {
          updateUI({ busy: 0.1, busyText: 'Restoring project…' })
          await hydrate(recovery.doc, new Map(recovery.files))
          updateUI({ notice: 'Last session restored' })
        }
      } catch (e) {
        updateUI({ error: (e as Error).message })
      } finally {
        if (!disposed) {
          revision = $editor.revision
          ready = true
          updateUI({ recovering: false, busy: null })
          void autosave()
        }
      }
    })()
    const unsubscribe = editor.subscribe((s) => {
      if (ready && (s.revision !== revision || (interacting && !s.interacting))) {
        revision = s.revision
        void autosave()
      }
      interacting = s.interacting
    })
    const flush = () => {
      endEdit()
      if (ready) void autosave()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      disposed = true
      unsubscribe()
      window.removeEventListener('pagehide', flush)
    }
  })
</script>

<svelte:window onkeydown={keyboard} />
<div
  class="app-shell"
  style={`--tree-width:${treeWidth}px;--inspector-width:${inspectorWidth}px`}
  ondragover={(e) => {
    e.preventDefault()
    if (e.dataTransfer?.types.includes('Files')) dragging = true
    else if (e.dataTransfer?.types.includes(assetDragType)) e.dataTransfer.dropEffect = 'copy'
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false
  }}
  ondrop={drop}
  role="application"
  aria-label="Projection studio"
>
  <header class="topbar">
    <div class="brand" aria-label="TwoManyProjectors">
      <div class="brand-mark"><span></span><span></span><span></span></div>
      <div>two<span>many</span>projectors<small>PROJECTION STUDIO <b>BETA</b></small></div>
    </div>
    <div class="project-name">
      <span class="project-dot"></span><input
        aria-label="Project name"
        value={$editor.doc.name}
        onfocus={beginEdit}
        onblur={() => {
          if (!$editor.doc.name) commit('Renamed project', (d) => (d.name = 'Untitled studio'))
          endEdit()
        }}
        oninput={(e) => commit('Renamed project', (d) => (d.name = e.currentTarget.value))}
      /><span class="local-badge">LOCAL</span>
    </div>
    <div class="history-tools">
      <button
        class="icon-button"
        aria-label="Undo"
        title="Undo · Ctrl+Z"
        disabled={!$editor.canUndo}
        onclick={undo}><Undo2 size={16} /></button
      ><button
        class="icon-button"
        aria-label="Redo"
        title="Redo · Ctrl+Shift+Z"
        disabled={!$editor.canRedo}
        onclick={redo}><Redo2 size={16} /></button
      >
    </div>
    <div class="top-actions">
      <button
        class="quiet-button"
        aria-label="New project"
        disabled={$editor.recovering || $editor.busy !== null}
        onclick={() => projectExplorer.show('new')}><FilePlus2 size={15} /> New</button
      ><button
        class="quiet-button"
        aria-label="Local projects"
        disabled={$editor.recovering || $editor.busy !== null}
        onclick={() => projectExplorer.show()}><Folders size={15} /> Projects</button
      >
      <button
        class="quiet-button"
        onclick={() => projectInput.click()}
        title="Open project · Ctrl+O"><FolderOpen size={15} /> Open</button
      ><button class="quiet-button" onclick={() => assetInput.click()}
        ><Upload size={15} /> Import</button
      ><button class="save-button" onclick={() => saveProject()}
        ><Save size={14} /> Save project</button
      ><button class="icon-button" aria-label="Help and shortcuts" onclick={() => (showHelp = true)}
        ><CircleHelp size={17} /></button
      >
    </div>
  </header>
  <main class="workspace">
    <aside class="scene-panel">
      <div class="panel-heading">
        <span>SCENE</span>
        <div>
          <button
            class="icon-button small"
            aria-label="Duplicate selected"
            onclick={duplicateSelected}
            disabled={!selected}><Copy size={13} /></button
          ><button
            class="icon-button small"
            aria-label="Delete selected"
            onclick={removeSelected}
            disabled={!selected}><Trash2 size={13} /></button
          >
        </div>
      </div>
      <ProjectorVersions />
      <div class="scene-actions">
        <button class="add-projector" onclick={() => addProjector()}
          ><Plus size={14} /> Add projector</button
        >
        <div class="add-receiver-wrap">
          <button
            class="add-receiver"
            aria-label="Add receiver"
            title="Add receiver"
            onclick={() => (showAdd = !showAdd)}><Box size={15} /><ChevronDown size={10} /></button
          >{#if showAdd}<div class="add-menu">
              {#each ['plane', 'box', 'cylinder'] as kind}<button
                  onclick={() => {
                    addNode(kind as 'plane' | 'box' | 'cylinder')
                    showAdd = false
                  }}><Box size={14} />{kind[0].toUpperCase() + kind.slice(1)}</button
                >{/each}
            </div>{/if}
        </div>
      </div>
      <div class="scene-list">
        <div class="tree-section">
          <ChevronDown size={13} /><span>PROJECTORS</span><small>{activeCount}/8</small>
        </div>
        {#each $editor.doc.projectors as p, index (p.id)}<div
            class="tree-row"
            class:projector-dragging={draggedProjector === p.id}
            class:drop-before={projectorDrop?.id === p.id && !projectorDrop.after}
            class:drop-after={projectorDrop?.id === p.id && projectorDrop.after}
            class:selected={$editor.selectedIds.includes(p.id)}
            class:muted={!p.enabled}
            class:locked={p.locked}
            role="listitem"
            ondragover={(e) => projectorDragOver(e, p.id)}
            ondragleave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) projectorDrop = null
            }}
            ondrop={(e) => dropProjector(e, p.id)}
          >
            <button
              class="projector-reorder"
              aria-label={`Reorder ${p.name}`}
              title="Drag to reorder · Arrow Up / Down to move"
              draggable="true"
              ondragstart={(e) => dragProjector(e, p.id)}
              ondragend={() => {
                draggedProjector = null
                projectorDrop = null
              }}
              onkeydown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                e.stopPropagation()
                moveProjector(p.id, index + (e.key === 'ArrowUp' ? -1 : 1))
              }}><GripVertical size={12} /></button
            >
            <button
              class="tree-select"
              aria-pressed={$editor.selectedIds.includes(p.id)}
              disabled={p.locked}
              onclick={(e) => select(p.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
              ondblclick={() => engine?.frame()}
              ><Sun size={15} style={`color:${p.color}`} /><span>{p.name}</span></button
            ><button
              class="icon-button small object-lock"
              aria-label={`${p.locked ? 'Unlock' : 'Lock'} ${p.name}`}
              aria-pressed={p.locked}
              title={p.locked ? 'Unlock to select and edit' : 'Lock selection and editing'}
              onclick={() => toggleObjectLock(p.id)}
              >{#if p.locked}<Lock size={13} />{:else}<LockOpen size={13} />{/if}</button
            ><button
              class="icon-button small visibility"
              aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`}
              onclick={() => toggleProjector(p)}
              >{#if p.enabled}<Eye size={13} />{:else}<EyeOff size={13} />{/if}</button
            >
          </div>{/each}
        <div class="tree-section receivers">
          <ChevronDown size={13} /><span>RECEIVERS</span><small>{$editor.doc.nodes.length}</small>
        </div>
        {#each $editor.doc.nodes as n}<div
            class="tree-row"
            class:selected={$editor.selectedIds.includes(n.id)}
            class:muted={!n.visible}
            class:locked={n.locked}
          >
            <button
              class="tree-select"
              aria-pressed={$editor.selectedIds.includes(n.id)}
              disabled={n.locked}
              onclick={(e) => select(n.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
              ondblclick={() => engine?.frame()}
              >{#if n.assetId}<ScanLine size={15} />{:else}<Box size={15} />{/if}<span
                >{n.name}</span
              ></button
            ><button
              class="icon-button small object-lock"
              aria-label={`${n.locked ? 'Unlock' : 'Lock'} ${n.name}`}
              aria-pressed={n.locked}
              title={n.locked ? 'Unlock to select and edit' : 'Lock selection and editing'}
              onclick={() => toggleObjectLock(n.id)}
              >{#if n.locked}<Lock size={13} />{:else}<LockOpen size={13} />{/if}</button
            ><button
              class="icon-button small visibility"
              aria-label={`${n.visible ? 'Hide' : 'Show'} ${n.name}`}
              onclick={() => editObject(n.id, { visible: !n.visible })}
              >{#if n.visible}<Eye size={13} />{:else}<EyeOff size={13} />{/if}</button
            >
          </div>{/each}
      </div>
      <div class="asset-panel">
        <div class="panel-heading">
          <span>ASSET LIBRARY</span><button
            class="icon-button small"
            aria-label="Import assets"
            onclick={() => assetInput.click()}><Plus size={14} /></button
          >
        </div>
        {#if $editor.doc.assets.length}<div class="asset-list">
            {#each $editor.doc.assets as a}<div class="asset-row">
                <button
                  class="asset-select"
                  aria-label={`Find ${a.name} in scene`}
                  title={a.kind === 'image'
                    ? a.name
                    : 'Click to frame · Drag into the viewport to place a copy'}
                  draggable={a.kind !== 'image'}
                  disabled={a.kind === 'image'}
                  ondragstart={(e) => dragAsset(e, a.id)}
                  onclick={() => focusAsset(a.id)}
                  ><ScanLine size={14} /><span
                    >{a.name}<small
                      >{a.kind.toUpperCase()} · {(a.originalBytes / 1048576).toFixed(1)} MB</small
                    ></span
                  ></button
                >
                {#if a.kind !== 'image'}<button
                    class="icon-button small"
                    aria-label={`Add ${a.name} to scene`}
                    title="Add to scene"
                    onclick={() => addAssetToScene(a.id)}><Plus size={13} /></button
                  >{/if}
                <button
                  class="icon-button small"
                  aria-label={`Remove ${a.name} from library`}
                  title={a.kind === 'image'
                    ? 'Remove from library, projectors and surface textures · Undo to restore'
                    : 'Remove from library and scene · Undo to restore'}
                  onclick={() => removeAsset(a.id)}><Trash2 size={13} /></button
                >
              </div>{/each}
          </div>
          <p class="asset-hint">
            Click to frame · Drag into the scene to place a copy
          </p>{:else}<button class="asset-drop" onclick={() => assetInput.click()}
            ><ArrowUpFromLine size={20} /><strong>Bring your space in</strong><span
              >Drop a model, cloud or splat</span
            ><small>GLB · FBX · OBJ · PLY · SPZ + more</small></button
          >{/if}
      </div>
    </aside>
    <button
      class="panel-resizer"
      aria-label="Resize scene panel"
      tabindex="0"
      onpointerdown={(e) => resize(e, 'left')}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') treeWidth = Math.max(190, treeWidth - 10)
        if (e.key === 'ArrowRight') treeWidth = Math.min(400, treeWidth + 10)
      }}
    ></button>
    <section class="viewport" aria-label="3D viewport">
      <svelte:boundary onerror={(e) => (renderError = String(e))}>
        <Canvas
          renderMode="on-demand"
          dpr={Math.min(1.75, window.devicePixelRatio)}
          createRenderer={(canvas) =>
            new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })}
          ><Scene onready={(value) => (engine = value)} /></Canvas
        >{#snippet failed(error, reset)}<div class="graphics-error">
            <Monitor size={32} />
            <h2>Viewport unavailable</h2>
            <p>{String(error)}</p>
            <button onclick={reset}>Retry renderer</button><button onclick={() => saveProject()}
              >Save project</button
            >
          </div>{/snippet}
      </svelte:boundary>
      {#if engine}<HeightMeasurements {engine} />{/if}
      <div class="viewport-tools">
        <div class="tool-options">
          {#each tools as tool}<button
              class="tool-button"
              aria-label={tool.name}
              class:active={$editor.tool === tool.id}
              title={`${tool.name} · ${tool.key}`}
              onclick={() => updateUI({ tool: tool.id, calibration: [], calibrationPreview: null })}
              ><tool.icon size={16} /><span>{tool.name}</span><kbd>{tool.key}</kbd></button
            >{/each}<span class="divider"></span><button
            class="tool-button"
            class:active={$editor.doc.settings.snap}
            title="Snap to 0.1 m / 15°"
            aria-label="Snap"
            onclick={() => setting({ snap: !$editor.doc.settings.snap })}
            ><Grid2X2 size={15} /><span>Snap</span></button
          >
        </div>
      </div>
      <div class="viewport-camera-tools">
        <div class="view-selector" role="group" aria-label="Camera projection">
          <button
            class:active={!$editor.orthographic}
            aria-label="Perspective"
            aria-pressed={!$editor.orthographic}
            title="Perspective view · O to toggle"
            onclick={() => updateUI({ orthographic: false })}>Persp</button
          ><button
            class:active={$editor.orthographic}
            aria-label="Orthographic"
            aria-pressed={$editor.orthographic}
            title="Orthographic view · O to toggle"
            onclick={() => updateUI({ orthographic: true })}>Ortho</button
          >
        </div>
        <div class="viewport-view-tools">
          <button
            class="icon-button"
            aria-label="Home view"
            title="Home view · Home"
            onclick={() => engine?.frame(true)}><Home size={16} /></button
          ><button
            class="icon-button"
            aria-label="Frame selection"
            title="Frame selected · F"
            onclick={() => engine?.frame()}><Maximize size={16} /></button
          >
        </div>
      </div>
      <details class="viewport-shading floating-card">
        <summary>
          <Sun size={14} /> Mesh shading
          <span>{$editor.doc.settings.viewShading === 'directional'
              ? 'Directional'
              : $editor.doc.settings.viewShading === 'none'
                ? 'None'
                : 'Projectors only'}</span>
          <ChevronDown size={12} />
        </summary>
        <div class="shading-controls">
          <label class="stack-label"
            >View shading<select
              aria-label="View shading"
              value={$editor.doc.settings.viewShading}
              onchange={(e) => setting({
                viewShading: e.currentTarget.value as SceneDocument['settings']['viewShading']
              })}
            >
              <option value="none">None · original colors</option>
              <option value="directional">Directional light</option>
              <option value="projectors">Projectors only · dark room</option>
            </select></label
          >
          {#if $editor.doc.settings.viewShading === 'directional'}
            <NumberField
              label="Light azimuth"
              value={$editor.doc.settings.lightAzimuth}
              min={-180}
              max={180}
              step={1}
              suffix="°"
              slider
              oncommit={(v) => setting({ lightAzimuth: v })}
            />
            <NumberField
              label="Light elevation"
              value={$editor.doc.settings.lightElevation}
              min={-90}
              max={90}
              step={1}
              suffix="°"
              slider
              oncommit={(v) => setting({ lightElevation: v })}
            />
            <p class="help">World direction: 0° azimuth is +Z, 90° is +X. Elevation points upward.</p>
          {/if}
          <p class="help">Mesh preview lighting. Projector measurements and analysis stay the same.</p>
        </div>
      </details>
      {#if $editor.tool === 'aim'}<div class="instruction-chip">
          <Crosshair size={15} /> Click a surface to aim the selected projector
          <button aria-label="Cancel aiming" onclick={() => updateUI({ tool: 'select' })}
            ><X size={13} /></button
          >
        </div>{/if}
      {#if $editor.tool === 'probe'}<div class="instruction-chip">
          <Crosshair size={15} /> Click a receiver to sample light and pixels
        </div>{/if}
      {#if $editor.tool === 'height-reference'}<div class="instruction-chip">
          <Ruler size={15} /> Pick a surface point as the height reference · Esc to cancel
          <button aria-label="Cancel height reference picking" onclick={() => updateUI({ tool: 'select', error: '' })}
            ><X size={13} /></button>
        </div>{/if}
      {#if $editor.tool === 'calibrate'}<div class="calibration-card floating-card">
          <div class="floating-title">
            <Ruler size={15} /> Two-point scale
            <button aria-label="Cancel calibration" onclick={cancelCalibration}
              ><X size={14} /></button
            >
          </div>
          <p>
            {$editor.calibration.length < 2
              ? `Pick point ${$editor.calibration.length + 1} of 2 on the selected asset.`
              : `Current distance: ${measured?.toFixed(4)} m`}
          </p>
          {#if measured !== null}<div class="calibration-input">
              <NumberField
                label="Real distance"
                value={realDistance}
                min={0.000001}
                step={0.01}
                oncommit={(v) => {
                  realDistance = v
                  previewCalibration()
                }}
              /><select
                aria-label="Calibration unit"
                bind:value={calibrationUnit}
                onchange={previewCalibration}
                ><option>m</option><option>cm</option><option>mm</option><option>ft</option></select
              >
            </div>
            <p class="help">Uniform scale around the first point. Rotation is preserved.</p>
            <div class="button-row">
              <button class="wide-button" onclick={previewCalibration}>Preview</button><button
                class="save-button"
                onclick={applyCalibration}>Apply scale</button
              >
            </div>{/if}
        </div>{/if}
      {#if $editor.probe}<div class="probe-card floating-card">
          <div class="floating-title">
            <Crosshair size={14} /> Surface sample
            <span class="badge">{$editor.probe.confidence}</span><button
              aria-label="Close sample"
              onclick={() => updateUI({ probe: null })}><X size={14} /></button
            >
          </div>
          <div class="sample-main">
            {$editor.probe.lux === null ? 'Unavailable' : $editor.probe.lux.toFixed(1)}<small
              >{$editor.probe.lux === null ? 'Unreliable scan normal' : 'lux · incident'}</small
            >
          </div>
          <dl>
            <div>
              <dt>Projector count</dt>
              <dd>{$editor.probe.overlap ?? '—'}</dd>
            </div>
            <div>
              <dt>Density X / Y</dt>
              <dd>{$editor.probe.density?.map((v) => v.toFixed(1)).join(' / ') ?? '—'} px/m</dd>
            </div>
            <div>
              <dt>Pixel size X / Y</dt>
              <dd>
                {$editor.probe.millimetresPerPixel?.map((v) => v.toFixed(2)).join(' / ') ?? '—'} mm
              </dd>
            </div>
            <div>
              <dt>Distortion</dt>
              <dd>{$editor.probe.distortion?.toFixed(3) ?? '—'} ×</dd>
            </div>
            <div>
              <dt>Diffuse luminance</dt>
              <dd>{$editor.probe.luminance?.toFixed(1) ?? '—'} cd/m²</dd>
            </div>
          </dl>
          {#if analysisScope.length > 1}
            <details class="probe-projectors">
              <summary>Per-projector density</summary>
              <dl>
                {#each analysisScope as p}
                  {@const sample = $editor.probe.projectors.find((sample) => sample.id === p.id)}
                  <div>
                    <dt>{p.name}</dt>
                    <dd>
                      {sample?.occluded
                        ? 'Occluded'
                        : sample?.density
                          ? `${sample.density.map((v) => v.toFixed(1)).join(' / ')} px/m`
                          : 'Outside coverage'}
                    </dd>
                  </div>
                {/each}
              </dl>
            </details>
          {/if}
          <small class="help"
            >Position {$editor.probe.point.map((v) => v.toFixed(2)).join(', ')} m</small
          >
          <p class="help">
            Density/distortion: {analysisScope.length > 1
              ? `best density / worst distortion across ${analysisScope.length} projectors`
              : (analysisScope[0]?.name ?? 'No enabled projector')}. Scan depth is approximate.
          </p>
        </div>{/if}
      {#if $editor.doc.settings.analysis !== 'preview'}<div class="legend-card floating-card">
          <div class="floating-title">
            {modes.find((m) => m.id === $editor.doc.settings.analysis)?.label}<span
              >{$editor.doc.settings.analysis === 'lux'
                ? 'lux'
                : $editor.doc.settings.analysis === 'density'
                  ? 'px/m'
                  : $editor.doc.settings.analysis === 'overlap'
                    ? 'projectors'
                    : 'ratio'}</span
            >
          </div>
          {#if $editor.doc.settings.analysis === 'overlap'}
            <div class="overlap-legend" role="list" aria-label="Projector overlap legend">
              {#each overlapColors as color, count}
                <div role="listitem" title={`${count} ${count === 1 ? 'projector' : 'projectors'}`}>
                  <i style:background={color}></i><span>{count}</span>
                </div>
              {/each}
            </div>
            <p class="help">
              All enabled projectors. Counts unblocked footprints, independent of brightness and
              media. Gray indicates unreliable scan normals.
            </p>
          {:else}
            <label class="stack-label"
              >{$editor.doc.settings.analysis === 'lux'
                ? 'Light contributions'
                : 'Projector'}<select
                aria-label="Analysis projector"
                value={$editor.doc.settings.analysisProjector}
                onchange={(e) => setting({ analysisProjector: e.currentTarget.value })}
                >{#if $editor.doc.settings.analysis === 'lux'}<option value="all"
                    >All enabled projectors · sum</option
                  >{:else}<option value="all">Selected projectors (or all enabled)</option
                  >{/if}{#each $editor.doc.projectors.filter((p) => p.enabled) as p}<option
                    value={p.id}>{p.name}</option
                  >{/each}</select
              ></label
            >
            {#if $editor.doc.settings.analysis === 'lux'}
              <label class="stack-label lux-display-control">Lux display<select
                  aria-label="Lux display"
                  value={$editor.doc.settings.luxDisplay}
                  onchange={(e) => setting({ luxDisplay: e.currentTarget.value as LuxDisplay })}
                >
                  <option value="smooth">Smooth gradient</option>
                  <option value="bands">Stepped bands</option>
                  <option value="target">Target range</option>
                </select></label
              >
            {/if}
            {#if luxTargetView}
              <div class="lux-target-legend" role="list" aria-label="Target lux legend">
                {#each ['Below minimum', 'In range', 'Above maximum'] as label, index}
                  <div role="listitem">
                    <i style:background={luxTargetColors[index]}></i><span>{label}</span>
                  </div>
                {/each}
              </div>
            {:else if $editor.doc.settings.analysis === 'lux' && $editor.doc.settings.luxDisplay === 'bands'}
              <div class="lux-band-legend" role="list" aria-label="Lux bands">
                {#each luxBandColors as color, index}
                  {@const low =
                    analysisRange[0] +
                    ((analysisRange[1] - analysisRange[0]) * index) / luxBandColors.length}
                  {@const high =
                    analysisRange[0] +
                    ((analysisRange[1] - analysisRange[0]) * (index + 1)) / luxBandColors.length}
                  <div
                    role="listitem"
                    style:background={color}
                    title={`${low.toFixed(1)}–${high.toFixed(1)} lux`}
                    aria-label={`${low.toFixed(1)} to ${high.toFixed(1)} lux`}
                  ></div>
                {/each}
              </div>
            {:else}
              <div class="heat-gradient"></div>
            {/if}
            <div class="field-grid">
              <NumberField
                label={luxTargetView ? 'Minimum lux' : 'Range min'}
                value={analysisRange[0]}
                min={luxTargetView ? 0 : -Infinity}
                step={1}
                oncommit={(v) => analysisLimit(0, v)}
              /><NumberField
                label={luxTargetView ? 'Maximum lux' : 'Range max'}
                value={analysisRange[1]}
                min={luxTargetView ? 0 : -Infinity}
                step={1}
                oncommit={(v) => analysisLimit(1, v)}
              />
            </div>
            <p class="help">
              {$editor.doc.settings.analysis === 'density'
                ? 'Lower directional density (X/Y). Highest density wins in overlaps. Native resolution.'
                : $editor.doc.settings.analysis === 'distortion'
                  ? 'Largest / smallest pixel footprint. Worst distortion wins in overlaps. Square pixels = 1.'
                  : luxTargetView
                    ? 'Your limits define the acceptable lux range. Unlit areas are below minimum. Gray indicates unreliable scan normals.'
                    : $editor.doc.settings.luxDisplay === 'bands'
                      ? 'Eight equal lux intervals with clear boundaries. Dark gray means no projection. White-field planning estimate.'
                      : 'Uniform flux per native pixel. Dark gray means no projection. Planning estimate.'}
            </p>
            {#if $editor.doc.settings.analysis !== 'lux'}
              <p class="help" aria-label="Analysis scope">
                {analysisScope.length
                  ? analysisScope.map((p) => p.name).join(', ')
                  : 'No enabled projector in this scope.'}
              </p>
            {/if}
          {/if}
          {#if $editor.doc.settings.shadowHighlight}
            <p class="help">Yellow marks projected shadows.</p>
          {:else if $editor.doc.settings.shadowBoost > 1}
            <p class="help">Shadow contrast boosted to {$editor.doc.settings.shadowBoost}×.</p>
          {/if}
        </div>{/if}
      <div class="viewport-bottom">
        <div class="navigation-hint">
          <MousePointer2 size={12} /><span>Drag orbit</span><span>·</span><span>Middle pan</span
          ><span>·</span><span>Right drag / scroll zoom</span><kbd>F</kbd><span>frame</span>
        </div>
        <div class="viewport-parameters" role="group" aria-label="Viewport display settings">
          {#if selected && 'spec' in selected && selected.enabled}
            <div class="frustum-legend">
              <span title="Current projection" aria-label="Current projection"
                ><i style:--frustum-color={selected.color}></i></span
              >
              <span title="Lens-shift reach" aria-label="Lens-shift reach"
                ><i class="shift-envelope"></i></span
              >
            </div>
          {/if}
          <div class="viewport-parameter">
            <NumberField
              label="Volume opacity"
              displayLabel="Volume"
              value={$editor.doc.settings.volumeOpacity}
              min={0}
              max={1}
              step={0.005}
              slider
              oncommit={(v) => setting({ volumeOpacity: v })}
            />
          </div>
          <div class="viewport-parameter">
            <NumberField
              label="Outline opacity"
              displayLabel="Outline"
              value={$editor.doc.settings.outlineOpacity}
              min={0}
              max={1}
              step={0.01}
              slider
              oncommit={(v) => setting({ outlineOpacity: v })}
            />
          </div>
          <div
            class="viewport-parameter"
            title="Darken projected shadows in every view. 1× is the original display; measurements are unchanged."
          >
            <NumberField
              label="Shadow boost"
              displayLabel="Shadows"
              value={$editor.doc.settings.shadowBoost}
              min={1}
              max={10}
              step={0.1}
              suffix="×"
              slider
              oncommit={(v) => setting({ shadowBoost: v })}
            />
          </div>
          <div class="viewport-toggles">
            <button
              class:active={$editor.doc.settings.dynamicRenderingQuality}
              aria-pressed={$editor.doc.settings.dynamicRenderingQuality}
              title="Reduce rendering quality while moving the camera or objects for smoother interaction with complex models and Gaussian scans"
              aria-label="Dynamic rendering quality"
              onclick={() =>
                setting({ dynamicRenderingQuality: !$editor.doc.settings.dynamicRenderingQuality })}
              ><Gauge size={14} /><span>Dynamic quality</span></button
            >
            <button
              class:shadow-highlight={$editor.doc.settings.shadowHighlight}
              aria-pressed={$editor.doc.settings.shadowHighlight}
              title="Show projected shadows in solid yellow in every view"
              aria-label="Highlight projected shadows"
              onclick={() => setting({ shadowHighlight: !$editor.doc.settings.shadowHighlight })}
              ><Highlighter size={14} /></button
            >
            <button
              class:active={$editor.doc.settings.grid}
              title="Toggle grid"
              aria-label="Toggle grid"
              onclick={() => setting({ grid: !$editor.doc.settings.grid })}
              ><Grid2X2 size={14} /></button
            ><button
              class:active={$editor.doc.settings.materialResponse}
              title="Toggle material response"
              aria-label="Toggle material response"
              onclick={() => setting({ materialResponse: !$editor.doc.settings.materialResponse })}
              ><Layers size={14} /><span>Materials</span></button
            >
          </div>
        </div>
        <div class="mode-tabs" role="group" aria-label="Analysis mode">
          {#each modes as m}<button
              class:active={$editor.doc.settings.analysis === m.id}
              aria-pressed={$editor.doc.settings.analysis === m.id}
              onclick={() => mode(m.id)}>{m.label}</button
            >{/each}
        </div>
      </div>
    </section>
    <button
      class="panel-resizer"
      aria-label="Resize inspector"
      tabindex="0"
      onpointerdown={(e) => resize(e, 'right')}
      onkeydown={(e) => {
        if (e.key === 'ArrowLeft') inspectorWidth = Math.min(460, inspectorWidth + 10)
        if (e.key === 'ArrowRight') inspectorWidth = Math.max(270, inspectorWidth - 10)
      }}
    ></button>
    <aside class="inspector"><Inspector {engine} /></aside>
  </main>
  <footer class="statusbar">
    <div><span class="status-dot"></span><span>{$editor.notice}</span></div>
    <div>
      <span>{$editor.stats.primitives.toLocaleString()} primitives</span><span class="divider"
      ></span><span title={$editor.stats.gpu}
        >{$editor.stats.fps ? `${$editor.stats.fps} render FPS` : 'On demand'}</span
      ><span class="divider"></span><span>1 unit = 1 metre</span><button
        onclick={() => (showHelp = true)}>Shortcuts <kbd>?</kbd></button
      >
    </div>
  </footer>
  {#if $editor.error}<div class="error-toast" role="alert">
      {@render InfoIcon()}<span>{$editor.error}</span><button
        aria-label="Dismiss error"
        onclick={() => updateUI({ error: '' })}><X size={16} /></button
      >
    </div>{/if}
  {#if $editor.busy !== null}<div class="busy-toast" role="status">
      <div>
        <span class="spinner"></span><strong>{$editor.busyText}</strong><button
          onclick={cancelImport}>Cancel import</button
        >
      </div>
      <progress value={$editor.busy} max="1"></progress>
    </div>{/if}
  {#if dragging}<div class="drop-overlay">
      <Upload size={48} />
      <h2>Bring your space in</h2>
      <p>Drop assets and companion files, or a .tmp3d project</p>
    </div>{/if}
</div>
<input
  bind:this={assetInput}
  type="file"
  multiple
  class="hidden"
  aria-label="Import asset files"
  onchange={chooseFiles}
/><input
  bind:this={projectInput}
  type="file"
  accept=".tmp3d"
  class="hidden"
  aria-label="Open project file"
  onchange={(e) => {
    const f = e.currentTarget.files?.[0]
    if (f) void openProject(f)
    e.currentTarget.value = ''
  }}
/>
{#snippet InfoIcon()}<CircleHelp size={18} />{/snippet}
<ProjectExplorer bind:this={projectExplorer} />
{#if showImport}<div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div class="modal-heading">
        <div class="modal-icon"><Upload size={25} /></div>
        <button class="icon-button" aria-label="Close import" onclick={() => (showImport = false)}
          ><X size={18} /></button
        >
      </div>
      <h2 id="import-title">Import your space</h2>
      <p>
        Original dimensions are preserved. Select companion textures, MTL and buffer files together
        with the model.
      </p>
      <div class="file-summary">
        {#each pendingFiles.slice(0, 6) as file}<div>
            <ScanLine size={14} /><span>{file.name}</span><small
              >{(file.size / 1048576).toFixed(1)} MB</small
            >
          </div>{/each}{#if pendingFiles.length > 6}<small
            >+ {pendingFiles.length - 6} more files</small
          >{/if}
      </div>
      <div class="field-grid">
        <label class="stack-label"
          >File units<select aria-label="File units" bind:value={units}
            ><option value="auto">Automatic · file units</option><option value="m">Metres</option
            ><option value="cm">Centimetres</option><option value="mm">Millimetres</option
            ><option value="ft">Feet</option></select
          ></label
        ><label class="stack-label"
          >Up axis<select aria-label="Up axis" bind:value={up}
            ><option value="y">Y up</option><option value="z">Z up</option></select
          ></label
        >
      </div>
      <div class="field-grid" style:grid-template-columns="repeat(3, 1fr)">
        {#each ['X', 'Y', 'Z'] as axis, i}
          <label class="check-row"
            ><input type="checkbox" bind:checked={flipAxes[i]} /> Flip {axis} axis</label
          >
        {/each}
      </div>
      <p class="help">Flips use the source axes, before the up-axis conversion.</p>
      <div class="modal-actions">
        <button class="quiet-button" onclick={() => (showImport = false)}>Cancel</button><button
          class="save-button"
          onclick={doImport}
          >Import {pendingFiles.length}
          {pendingFiles.length === 1 ? 'file' : 'files'}
          <ChevronRight size={15} /></button
        >
      </div>
    </div>
  </div>{/if}
{#if showHelp}<div class="modal-backdrop">
    <div class="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="modal-heading">
        <div class="modal-icon"><CircleHelp size={25} /></div>
        <button class="icon-button" aria-label="Close help" onclick={() => (showHelp = false)}
          ><X size={18} /></button
        >
      </div>
      <h2 id="help-title">A little room to experiment.</h2>
      <p>
        Plan coverage, explore light, and align your next projection. This beta provides planning
        estimates in metres.
      </p>
      <div class="shortcuts">
        {#each [['Orbit', 'Left drag'], ['Pan', 'Middle drag'], ['Dolly', 'Scroll'], ['Frame / home', 'F / Home'], ['Perspective / ortho', 'O'], ['Select / move / rotate / scale', 'V / W / R / S'], ['Toggle selection', 'Ctrl/Cmd + click'], ['Select range in scene list', 'Shift + click'], ['Select all', 'Ctrl/Cmd A'], ['Sample surface', 'P + click'], ['Duplicate', 'Ctrl D'], ['Undo / redo', 'Ctrl Z / Ctrl Shift Z'], ['Save / open', 'Ctrl S / Ctrl O'], ['Deselect / cancel', 'Escape']] as [label, key]}<div
          >
            <span>{label}</span><kbd>{key}</kbd>
          </div>{/each}
      </div>
      <p class="help">
        Scans use approximate depth and estimated normals. Gray analysis samples have no reliable
        measurement. Glass and metal preview is approximate; there is no secondary transmission or
        refraction.
      </p>
      <button
        class="wide-button"
        onclick={() => {
          showHelp = false
          void createProject('Sample studio', 'sample')
        }}>Load the sample studio</button
      >
    </div>
  </div>{/if}
