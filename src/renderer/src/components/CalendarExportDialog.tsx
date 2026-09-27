import { useMemo, useState } from 'react'
import {
  calendarExport,
  calendarMarkdown,
  exportFileName,
  type ExportFile
} from '@shared/calendarExport'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import { boardPng } from '../export/png'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * One or more people's calendars as plain boards — a row per sprint day, the tasks on it — to
 * save as Markdown or as a PNG image. Several people export as if each had been exported on
 * their own: a board, and a file, per person.
 */
export default function CalendarExportDialog(): JSX.Element {
  const sprint = useSprint()
  const today = useApp((s) => s.today)
  const memberIds = useApp((s) => s.exportMembers) ?? []
  const close = useApp((s) => s.closeDialog)
  const [showMeetings, setShowMeetings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const layouts = useMemo(() => layoutSprint(sprint, anchorFor(sprint, today)), [sprint, today])
  const boards = memberIds.map((id) => calendarExport(sprint, layouts, id, { showMeetings }))
  const available = Boolean(window.api)

  const save = async (kind: ExportFile['kind']): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const files: ExportFile[] = boards.map((board) => ({
      name: exportFileName(sprint, board),
      kind,
      content: kind === 'md' ? calendarMarkdown(board) : boardPng(board)
    }))
    const result = await window.api.exportCalendar(files)
    setBusy(false)
    if (!result.ok) setMessage({ ok: false, text: result.message })
    else if (result.value) {
      setMessage({
        ok: true,
        text:
          result.value.length === 1
            ? `Saved ${result.value[0]}`
            : `Saved ${result.value.length} files in ${folderOf(result.value[0])}`
      })
    }
  }

  return (
    <Dialog
      title={
        boards.length === 1
          ? `Export ${boards[0].memberName}'s calendar`
          : `Export ${boards.length} calendars`
      }
      wide
      onClose={close}
      footer={
        <>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={showMeetings}
              onChange={(event) => setShowMeetings(event.target.checked)}
            />
            Show meetings
          </label>
          <span className="spacer" />
          <button type="button" onClick={close}>
            {message?.ok ? 'Done' : 'Cancel'}
          </button>
          <button type="button" disabled={!available || busy} onClick={() => void save('md')}>
            Export as Markdown
          </button>
          <button
            type="button"
            className="primary"
            disabled={!available || busy}
            onClick={() => void save('png')}
          >
            Export as PNG
          </button>
        </>
      }
    >
      {message && (
        <div className={`message ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>
      )}
      {!available && (
        <p className="hint" style={{ marginTop: 0 }}>
          Exports are saved as files, so they need the desktop app rather than the browser preview.
        </p>
      )}
      {boards.map((board) => (
        <section key={board.memberId} className="export-board">
          <h3>{board.memberName}</h3>
          <p className="hint">{board.subtitle}</p>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.date}>
                  <td className="export-day">{row.day}</td>
                  <td>{row.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </Dialog>
  )
}

/** The folder a saved file is in, for saying where several files went. */
function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)))
  return cut > 0 ? path.slice(0, cut) : path
}
