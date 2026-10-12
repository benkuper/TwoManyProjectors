<script lang="ts">
  import { Euler, Quaternion } from 'three'
  import {
    Crosshair,
    Copy,
    ChevronDown,
    ImagePlus,
    Info,
    ScanLine,
    Sun,
    SlidersHorizontal,
    Move3D
  } from 'lucide-svelte'
  import NumberField from './NumberField.svelte'
  import { editor, editObject, commit, updateUI, setShift } from '../lib/store'
  import { projectorCatalogue, projectorForSpec, makeCustomSpec } from '../lib/catalogue'
  import {
    materials,
    type ProjectorConfig,
    type ProjectorSpec,
    type SceneNode,
    type Vec3,
    type SurfaceMaterial,
    type Pattern
  } from '../lib/types'
  import { constrainShift, footprint } from '../lib/optics'
  import { importImage } from '../lib/assets'
  import type { ViewportEngine } from '../lib/engine'
  let { engine }: { engine: ViewportEngine | undefined } = $props()
  const object = $derived(
    [...$editor.doc.nodes, ...$editor.doc.projectors].find((n) => n.id === $editor.selected)
  )
  const p = $derived(object && 'spec' in object ? object : undefined)
  const equipment = $derived(p ? projectorForSpec(p.spec) : undefined)
  const node = $derived(object && 'kind' in object ? object : undefined)
  const rotation = $derived(
    object
      ? new Euler()
          .setFromQuaternion(new Quaternion().fromArray(object.transform.rotation), 'XYZ')
          .toArray()
          .slice(0, 3)
          .map((v) => (Number(v) * 180) / Math.PI)
      : [0, 0, 0]
  )
  const coverage = $derived(p ? footprint(p, 6) : null)
  const asset = $derived(
    node?.assetId ? $editor.doc.assets.find((a) => a.id === node.assetId) : null
  )
  let imageInput = $state<HTMLInputElement>(),
    lumens = $state<number | null>(null),
    calculating = $state(false)
  $effect(() => {
    const id = object?.id
    lumens = null
  })
  function transform(field: 'position' | 'scale', index: number, value: number) {
    if (!object) return
    const next = structuredClone(object.transform)
    if (field === 'scale' && node?.kind === 'splat') next.scale = [value, value, value]
    else next[field][index] = value
    editObject(object.id, { transform: next })
  }
  function rotate(index: number, value: number) {
    if (!object) return
    const angles = [...rotation]
    angles[index] = value
    const next = structuredClone(object.transform)
    next.rotation = new Quaternion()
      .setFromEuler(new Euler(...(angles.map((v) => (v * Math.PI) / 180) as Vec3), 'XYZ'))
      .toArray()
    editObject(object.id, { transform: next })
  }
  function makeCustom() {
    if (!p) return
    const spec = makeCustomSpec(p.spec)
    editObject(
      p.id,
      { spec, shift: constrainShift({ ...p, spec }, p.shift) },
      'Created editable custom copy'
    )
  }
  function applyEquipment(spec: ProjectorSpec, reset = false) {
    if (!p) return
    editObject(
      p.id,
      {
        spec: structuredClone(spec),
        throwRatio: reset
          ? spec.throwRange[0]
          : Math.max(spec.throwRange[0], Math.min(p.throwRatio, spec.throwRange[1])),
        shift: reset ? [0, 0] : constrainShift({ ...p, spec }, p.shift)
      },
      reset ? 'Projector updated' : 'Lens updated'
    )
  }
  function editCustom(patch: Partial<ProjectorSpec>) {
    if (!p || p.spec.id !== 'custom') return
    const spec = { ...structuredClone(p.spec), ...patch }
    editObject(
      p.id,
      {
        spec,
        throwRatio: Math.max(spec.throwRange[0], Math.min(p.throwRatio, spec.throwRange[1])),
        shift: constrainShift({ ...p, spec }, p.shift)
      },
      'Custom specification updated'
    )
  }
  function customSpec(field: 'lumens' | 'resolution', value: number, index = 0) {
    if (!p) return
    const spec = structuredClone(p.spec)
    spec.id = 'custom'
    spec.verified = 'custom'
    if (field === 'lumens') spec.lumens = value
    else spec.resolution[index] = Math.round(value)
    editCustom(spec)
  }
  function customShift(field: 'horizontal' | 'vertical', value: number) {
    if (!p) return
    editCustom({ shift: { ...p.spec.shift, [field]: value / 100 } })
  }
  function material(patch: Partial<SurfaceMaterial>) {
    if (node) editObject(node.id, { material: { ...node.material, ...patch } })
  }
  async function image(event: Event) {
    const f = (event.target as HTMLInputElement).files?.[0]
    if (f && p)
      try {
        await importImage(f, p.id)
      } catch (e) {
        updateUI({ error: (e as Error).message })
      }
    ;(event.target as HTMLInputElement).value = ''
  }
  async function estimateFlux() {
    if (!engine || !node) return
    calculating = true
    try {
      lumens = await engine.interceptedLumens(node.id)
    } finally {
      calculating = false
    }
  }
</script>

<div class="panel-heading"><span>INSPECTOR</span><SlidersHorizontal size={14} /></div>
{#if object}
  <div class="inspector-scroll">
    <div class="object-title">
      <div class:projector-symbol={!!p} class="object-symbol">
        {#if p}<Sun size={20} />{:else}<ScanLine size={20} />{/if}
      </div>
      <div>
        <input
          aria-label="Object name"
          class="name-input"
          value={object.name}
          onchange={(e) => editObject(object.id, { name: e.currentTarget.value || object.name })}
        /><small
          >{p ? 'OPTICAL CENTER' : asset ? `${asset.kind.toUpperCase()} ASSET` : 'RECEIVER'}</small
        >
      </div>
    </div>
    {#if p}
      <section class="inspector-section">
        <h3>
          <Sun size={14} /> Equipment
          <span class="badge">{p.spec.verified === 'custom' ? 'CUSTOM' : 'VERIFIED'}</span>
        </h3>
        <label class="stack-label"
          >Projector<select
            aria-label="Projector preset"
            value={equipment?.id ?? (p.spec.id === 'custom' ? 'custom' : 'saved')}
            onchange={(e) => {
              const projector = projectorCatalogue.find((s) => s.id === e.currentTarget.value)
              if (projector)
                applyEquipment(
                  projector.lenses.find((s) => s.lens === p.spec.lens) ?? projector.lenses[0],
                  true
                )
              else if (e.currentTarget.value === 'custom') makeCustom()
            }}
            ><option value="custom">Custom projector</option>
            {#if !equipment && p.spec.id !== 'custom'}
              <option value="saved">{p.spec.manufacturer} {p.spec.model}</option>
            {/if}
            {#each projectorCatalogue as projector}
              <option value={projector.id}>{projector.manufacturer} {projector.model}</option>
            {/each}</select
          ></label
        >
        {#if p.spec.id === 'custom'}
          <div class="field-grid">
            <label class="stack-label"
              >Manufacturer<input
                value={p.spec.manufacturer}
                onchange={(e) => editCustom({ manufacturer: e.currentTarget.value })}
              /></label
            >
            <label class="stack-label"
              >Model<input
                value={p.spec.model}
                onchange={(e) => editCustom({ model: e.currentTarget.value })}
              /></label
            >
          </div>
          <label class="stack-label"
            >Lens<input
              aria-label="Lens"
              value={p.spec.lens}
              onchange={(e) => editCustom({ lens: e.currentTarget.value })}
            /></label
          >
        {:else}
          <label class="stack-label"
            >Lens<select
              aria-label="Lens"
              value={p.spec.lens}
              disabled={!equipment}
              onchange={(e) => {
                const spec = equipment?.lenses.find((s) => s.lens === e.currentTarget.value)
                if (spec) applyEquipment(spec)
              }}
            >
              {#if !equipment?.lenses.some((s) => s.lens === p.spec.lens)}
                <option value={p.spec.lens}>{p.spec.lens}</option>
              {/if}
              {#each equipment?.lenses ?? [] as spec}
                <option value={spec.lens}
                  >{spec.lens} · {spec.throwRange[0]}–{spec.throwRange[1]}:1</option
                >
              {/each}
            </select></label
          >
        {/if}
        {#if p.spec.id !== 'custom'}<button class="text-button" onclick={makeCustom}
            ><Copy size={12} /> Make custom copy</button
          >{/if}
        <div class="field-grid">
          <NumberField
            label="Output"
            value={p.spec.lumens}
            min={0}
            max={1000000}
            step={100}
            suffix="lm"
            disabled={p.spec.id !== 'custom'}
            oncommit={(v) => customSpec('lumens', v)}
          /><NumberField
            label="Multiplier"
            value={p.multiplier}
            min={0}
            max={10}
            step={0.05}
            suffix="×"
            oncommit={(v) => editObject(p.id, { multiplier: v })}
          /><NumberField
            label="Native width"
            value={p.spec.resolution[0]}
            min={1}
            max={16384}
            step={1}
            suffix="px"
            disabled={p.spec.id !== 'custom'}
            oncommit={(v) => customSpec('resolution', v, 0)}
          /><NumberField
            label="Native height"
            value={p.spec.resolution[1]}
            min={1}
            max={16384}
            step={1}
            suffix="px"
            disabled={p.spec.id !== 'custom'}
            oncommit={(v) => customSpec('resolution', v, 1)}
          />
        </div>
        {#if p.spec.sources.length}<details class="source-note">
            <summary><Info size={12} /> Specifications & limits <ChevronDown size={12} /></summary>
            <p>{p.spec.shift.note}</p>
            <p>Verified {p.spec.verified}</p>
            {#each p.spec.sources as url, i}<a href={url} target="_blank" rel="noreferrer"
                >Manufacturer reference {i + 1} ↗</a
              >{/each}
          </details>{/if}
      </section>
      <section class="inspector-section">
        <h3><SlidersHorizontal size={14} /> Lens & coverage</h3>
        {#if p.spec.id === 'custom'}
          <div class="field-grid">
            <NumberField
              label="Minimum throw ratio"
              value={p.spec.throwRange[0]}
              min={0.01}
              max={p.spec.throwRange[1]}
              step={0.01}
              suffix=":1"
              oncommit={(v) => editCustom({ throwRange: [v, p.spec.throwRange[1]] })}
            />
            <NumberField
              label="Maximum throw ratio"
              value={p.spec.throwRange[1]}
              min={p.spec.throwRange[0]}
              max={1000}
              step={0.01}
              suffix=":1"
              oncommit={(v) => editCustom({ throwRange: [p.spec.throwRange[0], v] })}
            />
            <NumberField
              label="Horizontal shift limit"
              value={Number((p.spec.shift.horizontal * 100).toFixed(2))}
              min={0}
              max={1000}
              step={1}
              suffix="% W"
              oncommit={(v) => customShift('horizontal', v)}
            />
            <NumberField
              label="Vertical shift limit"
              value={Number((p.spec.shift.vertical * 100).toFixed(2))}
              min={0}
              max={1000}
              step={1}
              suffix="% H"
              oncommit={(v) => customShift('vertical', v)}
            />
          </div>
          <label class="stack-label"
            >Combined shift limits<select
              aria-label="Combined shift limits"
              value={p.spec.shift.coupled}
              onchange={(e) =>
                editCustom({
                  shift: {
                    ...p.spec.shift,
                    coupled: e.currentTarget.value as ProjectorSpec['shift']['coupled'],
                    polygon: undefined
                  }
                })}
            >
              <option value="diamond">Diamond</option>
              <option value="ellipse">Ellipse</option>
              <option value="rectangle">Independent axes</option>
            </select></label
          >
        {/if}
        <NumberField
          label="Throw ratio"
          value={p.throwRatio}
          min={p.spec.throwRange[0]}
          max={p.spec.throwRange[1]}
          step={0.01}
          suffix=":1"
          oncommit={(v) => editObject(p.id, { throwRatio: v })}
          slider
        />
        <div class="range-labels">
          <span>{p.spec.throwRange[0]} wide</span><span>{p.spec.throwRange[1]} tele</span>
        </div>
        <div class="shift-fields">
          <div>
            <NumberField
              slider
              label="Horizontal shift"
              value={Number((p.shift[0] * 100).toFixed(2))}
              min={-p.spec.shift.horizontal * 100}
              max={p.spec.shift.horizontal * 100}
              step={1}
              suffix="% W"
              oncommit={(v) => setShift(p, [v / 100, p.shift[1]])}
            />
          </div>
          <div>
            <NumberField
              slider
              label="Vertical shift"
              value={Number((p.shift[1] * 100).toFixed(2))}
              min={-p.spec.shift.vertical * 100}
              max={p.spec.shift.vertical * 100}
              step={1}
              suffix="% H"
              oncommit={(v) => setShift(p, [p.shift[0], v / 100])}
            />
          </div>
        </div>
        <p class="help">Shift is constrained to this lens’s combined limits.</p>
        <p class="help">
          The blue envelope shows the area reachable with all allowed lens shifts at the current
          throw ratio and orientation.
        </p>
        <div class="coverage-note">
          <span>At 6 m throw</span><strong
            >{coverage?.width.toFixed(2)} × {coverage?.height.toFixed(2)} m</strong
          >
        </div>
      </section>
      <section class="inspector-section">
        <h3><ImagePlus size={14} /> Projection source</h3>
        <div class="pattern-grid">
          {#each [['grid', 'Grid'], ['checker', 'Checker'], ['crosshair', 'Crosshair'], ['alignment', 'Numbered'], ['bars', 'Color bars'], ['white', 'White']] as [key, name]}<button
              class:active={p.pattern === key}
              onclick={() => editObject(p.id, { pattern: key as Pattern })}
              ><span class="pattern-icon {key}"></span><span>{name}</span></button
            >{/each}
        </div>
        <label class="check-row"
          ><input
            type="checkbox"
            checked={p.nativePixelPreview}
            onchange={(e) => editObject(p.id, { nativePixelPreview: e.currentTarget.checked })}
          /> Preview native pixels</label
        >
        <p class="help">
          Preview at {p.spec.resolution[0]} × {p.spec.resolution[1]} pixels. Zoom in to inspect edge detail
          and one-pixel grid lines.
        </p>
        {#if ['grid', 'checker', 'alignment'].includes(p.pattern)}
          <NumberField
            label="Grid cell size"
            value={p.patternCellSize}
            min={8}
            max={4096}
            step={1}
            suffix="px"
            oncommit={(v) => editObject(p.id, { patternCellSize: Math.round(v) })}
          />
          <p class="help">Square cells in projector pixels; edge cells may be cropped.</p>
        {/if}
        <input
          bind:this={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          class="hidden"
          onchange={image}
        /><button class="wide-button" onclick={() => imageInput?.click()}
          ><ImagePlus size={14} /> Import image</button
        >{#if p.imageId}<button
            class="text-button"
            onclick={() => editObject(p.id, { pattern: 'image' })}
            >Use {$editor.doc.assets.find((a) => a.id === p.imageId)?.name}</button
          ><label class="stack-label"
            >Image fit<select
              aria-label="Image fit"
              value={p.imageFit}
              onchange={(e) =>
                editObject(p.id, {
                  imageFit: e.currentTarget.value as ProjectorConfig['imageFit']
                })}
              ><option value="contain">Contain · black borders</option><option value="cover"
                >Cover · crop edges</option
              ><option value="stretch">Stretch</option></select
            ></label
          >{/if}
      </section>
    {/if}
    <section class="inspector-section">
      <h3><Move3D size={14} /> Transform <small>WORLD</small></h3>
      <span class="section-label">Position</span>
      <div class="vector-fields">
        {#each ['X', 'Y', 'Z'] as label, i}<NumberField
            {label}
            value={Number(object.transform.position[i].toFixed(4))}
            suffix="m"
            oncommit={(v) => transform('position', i, v)}
          />{/each}
      </div>
      <span class="section-label">Rotation</span>
      <div class="vector-fields">
        {#each ['X', 'Y', 'Z'] as label, i}<NumberField
            label={`${label} rotation`}
            value={Number(rotation[i].toFixed(2))}
            step={1}
            suffix="°"
            oncommit={(v) => rotate(i, v)}
          />{/each}
      </div>
      {#if node}<span class="section-label">Scale</span>
        <div class="vector-fields">
          {#each ['X', 'Y', 'Z'] as label, i}<NumberField
              label={`${label} scale`}
              value={Number(object.transform.scale[i].toFixed(4))}
              min={0.000001}
              step={0.01}
              oncommit={(v) => transform('scale', i, v)}
            />{/each}
        </div>{/if}{#if p}<button
          class="wide-button"
          class:active={$editor.tool === 'aim'}
          onclick={() => updateUI({ tool: 'aim', notice: 'Click a receiver to aim the projector' })}
          ><Crosshair size={14} /> Aim at surface</button
        >{/if}
    </section>
    {#if node}
      {#if !node.assetId}<section class="inspector-section">
          <h3>Receiver size</h3>
          <div class="vector-fields">
            {#each ['Width', 'Height', 'Depth'] as label, i}<NumberField
                {label}
                value={node.dimensions[i]}
                min={0.001}
                max={10000}
                suffix="m"
                oncommit={(v) => {
                  const dimensions = [...node.dimensions] as Vec3
                  dimensions[i] = v
                  editObject(node.id, { dimensions })
                }}
              />{/each}
          </div>
        </section>{/if}
      {#if asset}<section class="inspector-section">
          <h3>Asset calibration</h3>
          <p class="help">
            Imported in {asset.units}, {asset.upAxis.toUpperCase()} up. Original size preserved.
          </p>
          <button
            class="wide-button"
            onclick={() =>
              updateUI({
                tool: 'calibrate',
                calibration: [],
                notice: 'Pick two points on the selected asset'
              })}><ScanLine size={14} /> Two-point scale</button
          >{#if asset.kind !== 'mesh'}<div class="approx-note">
              Approximate scan projection · {asset.normals} normals. Unreliable samples are unavailable.
            </div>{/if}
        </section>{/if}
      <section class="inspector-section">
        <h3>Surface response</h3>
        <label class="stack-label"
          >Material<select
            aria-label="Surface material"
            value={node.material.preset}
            onchange={(e) =>
              material(
                structuredClone(materials[e.currentTarget.value as SurfaceMaterial['preset']])
              )}
            >{#each Object.keys(materials) as key}<option value={key}
                >{key === 'white'
                  ? 'White screen'
                  : key === 'captured'
                    ? 'Captured appearance'
                    : key[0].toUpperCase() + key.slice(1)}</option
              >{/each}</select
          ></label
        ><label class="color-row"
          >Surface color<input
            aria-label="Surface color"
            type="color"
            value={node.material.color}
            oninput={(e) => material({ color: e.currentTarget.value })}
          /></label
        >
        <div class="field-grid">
          <NumberField
            label="Reflectance"
            value={node.material.reflectance}
            min={0}
            max={1}
            step={0.05}
            oncommit={(v) => material({ reflectance: v })}
          /><NumberField
            label="Roughness"
            value={node.material.roughness}
            min={0}
            max={1}
            step={0.05}
            oncommit={(v) => material({ roughness: v })}
          /><NumberField
            label="Transmission"
            value={node.material.transmission}
            min={0}
            max={1}
            step={0.05}
            oncommit={(v) => material({ transmission: v })}
          />
        </div>
        <p class="help">
          Incident lux is independent of material. Visible response is approximate; captured colors
          are appearance data.
        </p>
        <button class="wide-button" disabled={calculating} onclick={estimateFlux}
          >{calculating ? 'Sampling rays…' : 'Estimate intercepted lumens'}</button
        >{#if lumens !== null}<div class="coverage-note">
            <span>Intercepted · 4,000 rays/projector</span><strong>≈ {lumens.toFixed(0)} lm</strong>
          </div>{/if}
      </section>
    {/if}
    {#if p}<section class="inspector-section">
        <h3>Frustum visualization</h3>
        <label class="check-row"
          ><input
            type="checkbox"
            checked={p.showOutline}
            onchange={(e) => editObject(p.id, { showOutline: e.currentTarget.checked })}
          /> Outline</label
        ><label class="check-row"
          ><input
            type="checkbox"
            checked={p.showVolume}
            onchange={(e) => editObject(p.id, { showVolume: e.currentTarget.checked })}
          /> Filled volume</label
        >
        <div class="field-grid">
          <NumberField
            label="Maximum extent"
            value={p.extent}
            min={0.1}
            max={1000}
            step={1}
            suffix="m"
            oncommit={(v) => editObject(p.id, { extent: v })}
          />
        </div>
        <label class="color-row"
          >Frustum color<input
            aria-label="Frustum color"
            type="color"
            value={p.color}
            oninput={(e) => editObject(p.id, { color: e.currentTarget.value })}
          /></label
        >
      </section>{/if}
  </div>
{:else}<div class="empty-inspector">
    <Move3D size={28} />
    <h3>A place for every detail</h3>
    <p>Select a projector or receiver in the scene to adjust its properties.</p>
  </div>{/if}
