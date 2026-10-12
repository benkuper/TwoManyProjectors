<script lang="ts">
  import { Copy, Layers, Move3D, Trash2 } from 'lucide-svelte'
  import NumberField from './NumberField.svelte'
  import { editor, commit, duplicateSelected, removeSelected } from '../lib/store'
  import { selectionPivot } from '../lib/selection-transform'

  const objects = $derived(
    [...$editor.doc.projectors, ...$editor.doc.nodes].filter(
      (o) => !o.locked && $editor.selectedIds.includes(o.id)
    )
  )
  const pivot = $derived(selectionPivot(objects.map((o) => o.transform)))
  function move(index: number, value: number) {
    const delta = value - pivot.position[index]
    commit('Moved selection', (doc) => {
      for (const object of [...doc.projectors, ...doc.nodes])
        if (!object.locked && $editor.selectedIds.includes(object.id))
          object.transform.position[index] += delta
    })
  }
</script>

<div class="inspector-scroll">
  <div class="object-title">
    <div class="object-symbol"><Layers size={20} /></div>
    <div><strong>{objects.length} objects selected</strong><small>GROUP SELECTION</small></div>
  </div>
  <section class="inspector-section">
    <h3><Move3D size={14} /> Transform <small>WORLD</small></h3>
    <span class="section-label">Selection center</span>
    <div class="vector-fields">
      {#each ['X', 'Y', 'Z'] as label, i}
        <NumberField
          {label}
          value={Number(pivot.position[i].toFixed(4))}
          suffix="m"
          oncommit={(v) => move(i, v)}
        />
      {/each}
    </div>
    <p class="help">
      Move, rotate or scale all selected objects with the viewport handles. Rotation and uniform
      scale use the selection center; projector optics stay fixed.
    </p>
    <div class="button-row">
      <button class="wide-button" onclick={duplicateSelected}><Copy size={13} /> Duplicate</button>
      <button class="wide-button" onclick={removeSelected}><Trash2 size={13} /> Delete</button>
    </div>
  </section>
  <section class="inspector-section">
    <h3>Selected objects</h3>
    {#each objects as object}<p class="help">{object.name}</p>{/each}
    <p class="help">
      Ctrl/Cmd-click to toggle objects. Shift-click selects a range in the scene list.
    </p>
  </section>
</div>
