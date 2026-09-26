import { useState } from 'react'
import { startOfWeek, todayISO } from '@shared/dates'
import { useApp } from '../store'
import Dialog from './Dialog'

/**
 * Imports a sprint from TFS. Reached from the toolbar, the empty state, or by right-clicking
 * a day in the calendar — in which case that day is the proposed start date.
 */
export default function StartSprintDialog(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const seed = useApp((s) => s.startDateSeed)
  const closeDialog = useApp((s) => s.closeDialog)
  const startSprint = useApp((s) => s.startSprint)

  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(seed ?? startOfWeek(todayISO()))
  const [weeks, setWeeks] = useState(2)
  const [includeWeekends, setIncludeWeekends] = useState(false)
  const [queryUrl, setQueryUrl] = useState(settings?.lastQueryUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const noMembers = (settings?.members.length ?? 0) === 0

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const message = await startSprint({ name, startDate, weeks, includeWeekends, queryUrl })
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <Dialog
      title="Start sprint"
      onClose={closeDialog}
      footer={
        <>
          <span className="spacer" />
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || noMembers || !queryUrl.trim()}
            onClick={() => void start()}
          >
            {busy ? 'Importing…' : 'Start sprint'}
          </button>
        </>
      }
    >
      {error && <div className="message is-error">{error}</div>}
      {noMembers && (
        <div className="message is-error">
          Add the team members in Settings first — they are the rows of the calendar.
        </div>
      )}

      <div className="field">
        <label htmlFor="sprint-name">Name</label>
        <input
          id="sprint-name"
          type="text"
          value={name}
          placeholder="Sprint 24.09"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="start-date">First day</label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label htmlFor="weeks">Length</label>
          <select
            id="weeks"
            value={weeks}
            onChange={(event) => setWeeks(Number(event.target.value))}
          >
            <option value={1}>1 week</option>
            <option value={2}>2 weeks</option>
            <option value={3}>3 weeks</option>
            <option value={4}>4 weeks</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={includeWeekends}
            onChange={(event) => setIncludeWeekends(event.target.checked)}
          />
          Include weekends
        </label>
      </div>

      <div className="field">
        <label htmlFor="query-url">Query or sprint URL</label>
        <input
          id="query-url"
          type="url"
          value={queryUrl}
          placeholder="https://tfs-product.cmf.criticalmanufacturing.com/tfs/Collection/Project/_queries/query/…"
          onChange={(event) => setQueryUrl(event.target.value)}
        />
        <div className="hint">
          Open the query in TFS and copy the address bar. A sprint taskboard URL works too. Work
          items arrive unassigned in the backlog panel — nothing is written back to TFS.
        </div>
      </div>
    </Dialog>
  )
}
