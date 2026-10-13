<script lang="ts">
  import { Ruler, Crosshair } from 'lucide-svelte'
  import { editor, editObject, updateUI } from '../lib/store'
  import { projectorHeight, heightText, heightRelation } from '../lib/height-measurement'
  import type { ProjectorConfig } from '../lib/types'

  let { projector }: { projector: ProjectorConfig } = $props()
  const measurement = $derived(projector.heightMeasurement)
  const height = $derived(projectorHeight(projector, $editor.doc.nodes))
</script>

<section class="inspector-section projector-height">
  <h3><Ruler size={14} /> Height measurement</h3>
  <label class="height-toggle">
    <input
      type="checkbox"
      aria-label="Show height measurement"
      checked={measurement?.visible ?? false}
      disabled={projector.locked}
      onchange={(event) =>
        editObject(
          projector.id,
          {
            heightMeasurement: {
              visible: event.currentTarget.checked,
              reference: measurement?.reference ?? null
            }
          },
          'Height measurement visibility updated'
        )}
    />
    Show in viewport
  </label>
  {#if height}
    <div class="height-readout" aria-label="Projector height">
      <strong>{heightText(height.height)}</strong>
      <span>{heightRelation(height.height)} {height.referenceName}</span>
    </div>
  {:else}
    <p class="help">Reference surface removed. Pick a new point or use ground.</p>
  {/if}
  <div class="height-reference-buttons">
    <button
      class="wide-button"
      class:active={!measurement?.reference}
      disabled={projector.locked}
      onclick={() => {
        editObject(
          projector.id,
          { heightMeasurement: { visible: true, reference: null } },
          'Height measured from ground'
        )
        updateUI({ tool: 'select' })
      }}>Ground (Y = 0)</button
    >
    <button
      class="wide-button"
      class:active={$editor.tool === 'height-reference'}
      disabled={projector.locked}
      onclick={() =>
        updateUI({
          tool: 'height-reference',
          error: '',
          notice: 'Pick a surface point for the height reference'
        })}
      ><Crosshair size={14} />
      {measurement?.reference ? 'Repick surface point' : 'Pick surface point'}</button
    >
  </div>
  <p class="help">
    Vertical height at the lens origin.
    {#if measurement?.reference && height}
      Picked level: {height.base.y.toFixed(2)} m. The point follows its surface.
    {:else}
      Pick a surface point to measure from a raised floor or platform.
    {/if}
    Measurements stay visible when deselected.
  </p>
</section>
