import { useMemo, useState } from 'react'
import { holderOf, NOTE_CATEGORIES } from '@shared/notes'
import type { NoteCategory } from '@shared/types'
import { cx } from '../format'
import { matches } from '@shared/text'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * Writes a note. Every note belongs to a person, since that is where they are read, and may
 * point at any number of work items — including none, for a remark about the person's week
 * rather than about any particular task.
 */
export default function NoteDialog(): JSX.Element | null {
  const sprint = useSprint()
  const target = useApp((s) => s.noteTarget)
  const closeDialog = useApp((s) => s.closeDialog)
  const saveNote = useApp((s) => s.saveNote)
  const removeNote = useApp((s) => s.removeNote)

  const existing = target?.noteId
    ? sprint.notes.find((note) => note.id === target.noteId)
    : undefined

  const [memberId, setMemberId] = useState(
    existing?.memberId ??
      target?.memberId ??
      (target?.taskId !== undefined ? holderOf(sprint, target.taskId) : undefined) ??
      sprint.members[0]?.id ??
      ''
  )
  const [text, setText] = useState(existing?.text ?? '')
  const [category, setCategory] = useState<NoteCategory | undefined>(existing?.category)
  const [taskIds, setTaskIds] = useState<number[]>(
    existing?.taskIds ?? (target?.taskId !== undefined ? [target.taskId] : [])
  )
  const [search, setSearch] = useState('')

  const candidates = useMemo(() => {
    if (search.trim().length === 0) return []
    return Object.values(sprint.workItems)
      .filter((item) => !taskIds.includes(item.id))
      .filter((item) => matches(`${item.id} ${item.title}`, search))
      .slice(0, 6)
  }, [search, sprint.workItems, taskIds])

  if (!target) return null

  const save = (): void => {
    if (text.trim().length === 0 || !memberId) return
    saveNote({ memberId, text, taskIds, category }, existing?.id)
    closeDialog()
  }

  return (
    <Dialog
      title={existing ? 'Edit note' : 'Add note'}
      onClose={closeDialog}
      footer={
        <>
          {existing && (
            <button
              type="button"
              onClick={() => {
                removeNote(existing.id)
                closeDialog()
              }}
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={text.trim().length === 0 || !memberId}
            onClick={save}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="note-member">Person</label>
        <select
          id="note-member"
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
        >
          {[...sprint.members]
            .sort((a, b) => a.order - b.order)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
        </select>
        <div className="hint">
          The note is filed under this person. It stays with them even if a task it mentions is
          later given to somebody else.
        </div>
      </div>

      <div className="field">
        <label>Category</label>
        <div className="row note-categories">
          {[undefined, ...NOTE_CATEGORIES].map((value) => (
            <button
              key={value ?? 'none'}
              type="button"
              className={cx('choice-pill', category === value && 'is-on')}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {value ?? 'None'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="note-text">Note</label>
        <textarea
          id="note-text"
          rows={4}
          value={text}
          placeholder="Blocked on the API contract from the platform team."
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="note-search">Tasks this note is about</label>
        {taskIds.length > 0 && (
          // A class of its own rather than the panel's `.note-tasks`: the two live on screen
          // at the same time and sharing a name makes them impossible to tell apart.
          <div className="note-link-row" style={{ marginBottom: 6 }}>
            {taskIds.map((id) => (
              <button
                key={id}
                type="button"
                className="chip"
                title={`${sprint.workItems[id]?.title ?? 'Unknown work item'} — click to unlink`}
                onClick={() => setTaskIds((current) => current.filter((other) => other !== id))}
              >
                #{id} ✕
              </button>
            ))}
          </div>
        )}
        <input
          id="note-search"
          type="text"
          value={search}
          placeholder="Search by number or title to link a task"
          onChange={(event) => setSearch(event.target.value)}
        />
        {candidates.map((item) => (
          <button
            key={item.id}
            type="button"
            className="picker-row"
            onClick={() => {
              setTaskIds((current) => [...current, item.id])
              setSearch('')
            }}
          >
            <span className="task-link">#{item.id}</span> {item.title}
          </button>
        ))}
        {search.trim().length > 0 && candidates.length === 0 && (
          <div className="hint">Nothing matches that.</div>
        )}
      </div>
    </Dialog>
  )
}
