<script lang="ts">
  import { tick } from 'svelte'
  import { ArrowLeft, FilePlus2, FolderOpen, Search, Trash2, X } from 'lucide-svelte'
  import { editor } from '../lib/store'
  import {
    autosave,
    createProject,
    deleteLocalProject,
    listLocalProjects,
    openLocalProject,
    type LocalProject
  } from '../lib/persistence'

  let dialog: HTMLDialogElement
  let nameInput = $state<HTMLInputElement>()
  let searchInput = $state<HTMLInputElement>()
  let creating = $state(false)
  let name = $state('Untitled studio')
  let search = $state('')
  let projects = $state<LocalProject[]>([])
  let loading = $state(false)
  let working = $state(false)
  let error = $state('')
  let deleting = $state<string | null>(null)
  const filtered = $derived(
    projects.filter((project) => project.name.toLowerCase().includes(search.trim().toLowerCase()))
  )
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  function modified(value: string) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? 'Unknown date' : dateFormat.format(date)
  }
  async function refresh() {
    loading = true
    error = ''
    try {
      if (!(await autosave())) throw new Error($editor.error)
      projects = await listLocalProjects()
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }
  export async function show(mode: 'browse' | 'new' = 'browse') {
    creating = mode === 'new'
    name = 'Untitled studio'
    search = ''
    deleting = null
    error = ''
    await tick()
    dialog.showModal()
    if (creating) {
      nameInput?.focus()
      nameInput?.select()
    } else {
      searchInput?.focus()
      await refresh()
    }
  }
  async function startNew() {
    creating = true
    error = ''
    await tick()
    nameInput?.focus()
    nameInput?.select()
  }
  async function create(event: SubmitEvent) {
    event.preventDefault()
    if (working || !name.trim()) return
    working = true
    error = ''
    try {
      if (await createProject(name)) dialog.close()
      else error = $editor.error || 'The project could not be created.'
    } finally {
      working = false
    }
  }
  async function open(project: LocalProject) {
    if (project.id === $editor.doc.id) {
      dialog.close()
      return
    }
    working = true
    error = ''
    try {
      if (await openLocalProject(project.id)) dialog.close()
      else error = $editor.error || 'The project could not be opened.'
    } finally {
      working = false
    }
  }
  async function remove(id: string) {
    working = true
    error = ''
    try {
      await deleteLocalProject(id)
      projects = projects.filter((project) => project.id !== id)
      deleting = null
    } catch (e) {
      error = (e as Error).message
    } finally {
      working = false
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="modal project-explorer"
  aria-labelledby="projects-title"
  oncancel={(event) => {
    if (working) event.preventDefault()
  }}
>
  <div class="modal-heading">
    <div class="modal-icon"><FolderOpen size={25} /></div>
    <button
      class="icon-button"
      aria-label="Close local projects"
      disabled={working}
      onclick={() => dialog.close()}><X size={18} /></button
    >
  </div>
  <h2 id="projects-title">{creating ? 'New project' : 'Local projects'}</h2>
  <p>
    {creating
      ? 'Start with an empty scene. Your current project stays in your local library.'
      : 'Projects and imported assets save automatically in this browser. Open a project to pick up where you left off.'}
  </p>
  {#if creating}
    <form onsubmit={create}>
      <label class="stack-label new-project-name">
        Project name
        <input
          bind:this={nameInput}
          aria-label="New project name"
          bind:value={name}
          required
          disabled={working}
        />
      </label>
      <div class="modal-actions">
        <button
          type="button"
          class="quiet-button"
          disabled={working}
          onclick={async () => {
            creating = false
            await tick()
            searchInput?.focus()
            await refresh()
          }}><ArrowLeft size={14} /> Projects</button
        >
        <button type="submit" class="save-button" disabled={working || !name.trim()}>
          <FilePlus2 size={15} />{working ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  {:else}
    <div class="project-explorer-tools">
      <label class="project-search">
        <Search size={15} />
        <input
          bind:this={searchInput}
          aria-label="Search local projects"
          placeholder="Search projects…"
          bind:value={search}
        />
      </label>
      <button class="save-button" disabled={working || loading} onclick={startNew}>
        <FilePlus2 size={15} /> New project
      </button>
    </div>
    {#if loading}
      <p class="project-list-empty" role="status">Loading local projects…</p>
    {:else if filtered.length}
      <ul class="local-project-list" aria-label="Saved local projects" aria-busy={working}>
        {#each filtered as project (project.id)}
          <li class:current={project.id === $editor.doc.id}>
            <div class="local-project-row">
              <button
                class="local-project-open"
                aria-label={`Open ${project.name}`}
                disabled={working}
                onclick={() => open(project)}
              >
                <FolderOpen size={20} />
                <span class="local-project-details">
                  <strong>{project.name || 'Untitled studio'}</strong>
                  <span
                    >{project.projectors}
                    {project.projectors === 1 ? 'projector' : 'projectors'} · {project.receivers}
                    {project.receivers === 1 ? 'receiver' : 'receivers'} · {project.assets}
                    {project.assets === 1 ? 'asset' : 'assets'}</span
                  >
                  <time datetime={project.modified}>Edited {modified(project.modified)}</time>
                </span>
                {#if project.id === $editor.doc.id}<span class="current-project-badge">CURRENT</span
                  >{/if}
              </button>
              <button
                class="icon-button"
                aria-label={`Delete ${project.name}`}
                title={project.id === $editor.doc.id
                  ? 'Open another project before deleting this one'
                  : 'Delete local project'}
                disabled={working || project.id === $editor.doc.id}
                onclick={() => (deleting = deleting === project.id ? null : project.id)}
                ><Trash2 size={15} /></button
              >
            </div>
            {#if deleting === project.id}
              <div class="project-delete-confirm">
                <p>Delete “{project.name}” and its assets from this browser?</p>
                <div>
                  <button class="quiet-button" disabled={working} onclick={() => (deleting = null)}
                    >Keep project</button
                  >
                  <button
                    class="quiet-button delete-project-button"
                    disabled={working}
                    onclick={() => remove(project.id)}>Delete project</button
                  >
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if !error}
      <p class="project-list-empty">
        {search.trim() ? 'No projects match your search.' : 'Your local projects will appear here.'}
      </p>
    {/if}
    <p class="local-project-note">
      Use Save project to download a .tmp3d backup. Clearing this browser’s site data removes the
      local library.
    </p>
  {/if}
  {#if error}<p class="project-explorer-error" role="alert">{error}</p>{/if}
</dialog>
