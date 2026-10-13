import { get } from 'svelte/store'
import { editor, commit, undo } from '../../src/lib/store'
import { originalFiles } from '../../src/lib/assets'
import { autosave, createProject, openLocalProject } from '../../src/lib/persistence'

export async function exerciseFileIsolation() {
  const path = 'assets/shared/image.png'
  const bytes = await (await fetch('/samples/white.png')).arrayBuffer()
  async function addImage(name: string) {
    const file = new File([bytes], name, { type: 'image/png' })
    originalFiles.set(path, file)
    commit('Added image', (doc) =>
      doc.assets.push({
        id: crypto.randomUUID(),
        name,
        kind: 'image',
        files: [path],
        primary: path,
        units: 'm',
        upAxis: 'y',
        normals: 'unavailable',
        originalBytes: file.size
      })
    )
    if (!(await autosave())) throw new Error(get(editor).error)
  }
  if (!(await createProject('First images'))) throw new Error(get(editor).error)
  const first = get(editor).doc.id
  await addImage('first.png')
  if (!(await createProject('Second images'))) throw new Error(get(editor).error)
  const second = get(editor).doc.id
  await addImage('second.png')
  commit('Removed image', (doc) => (doc.assets = []))
  undo()
  if (!(await autosave())) throw new Error(get(editor).error)
  if (!(await openLocalProject(first))) throw new Error(get(editor).error)
  const firstFile = originalFiles.get(path)?.name
  if (!(await openLocalProject(second))) throw new Error(get(editor).error)
  return {
    firstFile,
    secondFile: originalFiles.get(path)?.name,
    assets: get(editor).doc.assets.length
  }
}
