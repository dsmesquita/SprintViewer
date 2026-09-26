import type { Note } from '@shared/types'
import { useApp, useSprint } from '../../store'

export default function NoteCard({ note }: { note: Note }): JSX.Element {
  const sprint = useSprint()
  const highlight = useApp((s) => s.highlightWorkItem)
  const openNote = useApp((s) => s.openNote)

  return (
    <div className="note">
      {note.category && <div className="note-category">{note.category}</div>}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="note-text" style={{ flex: 1 }}>
          {note.text}
        </div>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: 11, padding: '1px 6px' }}
          onClick={() => openNote({ noteId: note.id })}
          aria-label="Edit note"
        >
          Edit
        </button>
      </div>
      {note.taskIds.length > 0 && (
        <div className="note-tasks">
          {note.taskIds.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              onMouseEnter={() => highlight(id)}
              onMouseLeave={() => highlight(null)}
              onClick={() => void window.api?.openExternal(sprint.workItems[id]?.url ?? '')}
              title={sprint.workItems[id]?.title}
            >
              #{id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
