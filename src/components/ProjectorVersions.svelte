<script lang="ts">
  import { tick } from 'svelte'
  import { Copy, Pencil, Plus, Trash2 } from 'lucide-svelte'
  import {
    editor,
    createProjectorVersion,
    deleteProjectorVersion,
    renameProjectorVersion,
    switchProjectorVersion
  } from '../lib/store'

  const versions = $derived($editor.doc.projectorVersions!)
  const active = $derived(versions.items.find((v) => v.id === versions.activeId)!)
  let renaming = $state(false)
  let name = $state('')
  let nameInput: HTMLInputElement | undefined

  async function startRename() {
    name = active.name
    renaming = true
    await tick()
    nameInput?.focus()
    nameInput?.select()
  }
  function finishRename() {
    if (!renaming) return
    renameProjectorVersion(name)
    renaming = false
  }
</script>

<section class="projector-versions" aria-label="Projector versions">
  <div class="version-heading">
    <span>PROJECTOR VERSION</span>
    <div>
      <button
        class="icon-button small"
        aria-label="New empty version"
        title="New empty version"
        onclick={() => createProjectorVersion(true)}><Plus size={13} /></button
      ><button
        class="icon-button small"
        aria-label="Duplicate version"
        title="Duplicate this projector setup"
        onclick={() => createProjectorVersion()}><Copy size={13} /></button
      ><button
        class="icon-button small"
        aria-label="Delete version"
        title={versions.items.length > 1 ? 'Delete this version · Undo to restore' : 'Keep at least one version'}
        disabled={versions.items.length < 2}
        onclick={deleteProjectorVersion}><Trash2 size={13} /></button
      >
    </div>
  </div>
  <div class="version-picker">
    {#if renaming}
      <input
        bind:this={nameInput}
        aria-label="Version name"
        bind:value={name}
        onblur={finishRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            renaming = false
          }
        }}
      />
    {:else}
      <select
        aria-label="Projector version"
        value={versions.activeId}
        onchange={(e) => switchProjectorVersion(e.currentTarget.value)}
      >
        {#each versions.items as version (version.id)}
          <option value={version.id}>{version.name}</option>
        {/each}
      </select>
    {/if}
    <button
      class="icon-button small"
      aria-label="Rename version"
      title="Rename this version"
      onclick={startRename}><Pencil size={13} /></button
    >
  </div>
  <p>Projector edits save to this version.</p>
</section>
