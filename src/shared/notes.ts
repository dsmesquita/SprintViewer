import type { Note, NoteCategory, Sprint } from './types'

/**
 * Notes always belong to a person — that is where they are displayed — and may reference any
 * number of work items.
 *
 * A note stays with the person it was written for. If a task it mentions is later given to
 * somebody else, the note does not follow: it was a remark about that person's week, and
 * moving it would quietly rewrite what they were told.
 */

export interface NoteDraft {
  memberId: string
  text: string
  taskIds: number[]
  category?: NoteCategory
}

/** The competencies a note can be filed under, in the order they are offered. */
export const NOTE_CATEGORIES: readonly NoteCategory[] = [
  'Agility',
  'Commitment',
  'Communication',
  'Customer Orientation',
  'Execution & Delivery',
  'Innovation'
]

/** A category the app knows, or nothing — a note is never filed under a made-up one. */
export function validCategory(value: unknown): NoteCategory | undefined {
  return NOTE_CATEGORIES.find((category) => category === value)
}

export function addNote(sprint: Sprint, draft: NoteDraft, newId: () => string): Sprint {
  const now = new Date().toISOString()
  const note: Note = {
    id: newId(),
    memberId: draft.memberId,
    text: draft.text.trim(),
    taskIds: [...new Set(draft.taskIds)],
    ...categoryOf(draft),
    createdAt: now,
    updatedAt: now
  }
  return { ...sprint, notes: [...sprint.notes, note] }
}

export function updateNote(sprint: Sprint, noteId: string, draft: NoteDraft): Sprint {
  return {
    ...sprint,
    notes: sprint.notes.map((note) => {
      if (note.id !== noteId) return note
      // Rebuilt without the old category, so clearing it in the dialog really clears it.
      const { category: _previous, ...rest } = note
      return {
        ...rest,
        memberId: draft.memberId,
        text: draft.text.trim(),
        taskIds: [...new Set(draft.taskIds)],
        ...categoryOf(draft),
        updatedAt: new Date().toISOString()
      }
    })
  }
}

/** The draft's category as a field to spread in, or nothing at all when it has none. */
function categoryOf(draft: NoteDraft): { category?: NoteCategory } {
  const category = validCategory(draft.category)
  return category ? { category } : {}
}

export function deleteNote(sprint: Sprint, noteId: string): Sprint {
  return { ...sprint, notes: sprint.notes.filter((note) => note.id !== noteId) }
}

/** The person currently holding a work item, if anyone — the default owner for a task note. */
export function holderOf(sprint: Sprint, workItemId: number): string | undefined {
  for (const member of sprint.members) {
    if ((sprint.queues[member.id] ?? []).some((block) => block.workItemId === workItemId)) {
      return member.id
    }
  }
  return undefined
}

/** Every note in the sprint as Markdown, grouped by person, with links to the tasks they mention. */
export function notesMarkdown(sprint: Sprint): string {
  const lines: string[] = [`# ${sprint.name} — Notes\n`]
  for (const member of sprint.members) {
    const memberNotes = sprint.notes.filter((note: Note) => note.memberId === member.id)
    if (memberNotes.length === 0) continue
    lines.push(`## ${member.name}\n`)
    for (const note of memberNotes) {
      const taskRefs = note.taskIds.map((id) => {
        const item = sprint.workItems[id]
        return item ? `[#${id} ${item.title}](${item.url})` : `#${id}`
      })
      if (note.category) lines.push(`**Category:** ${note.category}  `)
      if (taskRefs.length > 0) lines.push(`**Tasks:** ${taskRefs.join(', ')}  `)
      lines.push(note.text)
      lines.push('')
    }
  }
  return lines.join('\n')
}
