import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { dialog } from 'electron'
import { notesMarkdown } from '@shared/notes'
import { loadSnapshot, loadSprint } from '../storage'

/**
 * Saving things out of the app to a file the user picks. Each resolves to `null` when the
 * Save dialog is cancelled, which is an answer rather than an error.
 */

/** A name safe to suggest in a Save dialog: letters, digits, spaces and dashes. */
function safe(name: string): string {
  return String(name).replace(/[^\w -]+/g, '')
}

async function saveAs(
  suggested: string,
  filter: { name: string; extensions: string[] },
  content: string
): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: suggested,
    filters: [filter]
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, content, 'utf8')
  return filePath
}

/** The sprint summary, written in the renderer — which holds the live sprint — and saved here. */
export function saveSummary(sprintName: string, markdown: string): Promise<string | null> {
  return saveAs(
    `${safe(sprintName)} summary.md`,
    { name: 'Markdown', extensions: ['md'] },
    String(markdown)
  )
}

/** Every note in a saved sprint, as Markdown. Resolves to the file's name, not its path. */
export async function exportNotes(sprintId: string): Promise<string | null> {
  const sprint = await loadSprint(sprintId)
  if (!sprint) throw new Error('Sprint not found.')
  const saved = await saveAs(
    `${safe(sprint.name)} notes.md`,
    { name: 'Markdown', extensions: ['md'] },
    notesMarkdown(sprint)
  )
  return saved === null ? null : path.basename(saved)
}

/** A stored snapshot, as the JSON it is kept in. */
export async function exportSnapshot(sprintId: string, id: string): Promise<string | null> {
  const snapshot = await loadSnapshot(sprintId, id)
  if (!snapshot) throw new Error('That snapshot is no longer on disk.')
  return saveAs(
    `${safe(snapshot.name)} snapshot.json`,
    { name: 'Snapshot', extensions: ['json'] },
    JSON.stringify(snapshot, null, 2)
  )
}
