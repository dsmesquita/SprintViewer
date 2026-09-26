import { useEffect, useState } from 'react'
import type { SnapshotMeta } from '@shared/snapshots'
import { buildSprintSummary } from '@shared/sprintSummary'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * Writes the sprint summary: the plan, what happened, and everyone's notes, as a Markdown file
 * for an AI agent to turn into the organised write-up.
 *
 * The only choices are what counts as the plan and whether to get the final hours from TFS
 * first — everything else about the file is fixed, so one sprint's summary reads like the last.
 */
export default function SummaryDialog(): JSX.Element {
  const sprint = useSprint()
  const today = useApp((s) => s.today)
  const close = useApp((s) => s.closeDialog)
  const refresh = useApp((s) => s.refresh)
  // `npm run dev:web` has no main process, so no disk to read snapshots from or write to.
  const available = typeof window.api !== 'undefined'

  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null)
  const [planId, setPlanId] = useState('')
  const [refreshFirst, setRefreshFirst] = useState(Boolean(sprint.queryUrl))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!available) return
    void window.api.listSnapshots(sprint.id).then((list) => {
      setSnapshots(list)
      // The automatic Sprint start snapshot when there is one; otherwise the earliest, which is
      // the nearest thing to the plan. The list comes newest first.
      setPlanId(
        list.find((meta) => meta.kind === 'baseline')?.id ?? list[list.length - 1]?.id ?? ''
      )
    })
  }, [sprint.id, available])

  const save = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      if (refreshFirst && sprint.queryUrl) {
        await refresh()
        const after = useApp.getState()
        if (after.pendingRefresh) {
          setMessage({
            ok: false,
            text: 'The refresh needs your answer about hours set by hand. Answer it, then save the summary again.'
          })
          return
        }
        if (after.refreshStatus && !after.refreshStatus.ok) {
          setMessage({
            ok: false,
            text: `The refresh failed: ${after.refreshStatus.text} Untick it to save the summary with the hours as they are.`
          })
          return
        }
      }

      const plan = planId ? await window.api.loadSnapshot(sprint.id, planId) : null
      if (planId && !plan) {
        setMessage({ ok: false, text: 'That snapshot is no longer on disk. Choose another.' })
        return
      }
      // The sprint as it is now — after the refresh, not as it was when the dialog opened.
      const current = useApp.getState().sprint ?? sprint
      const markdown = buildSprintSummary({
        sprint: current,
        plan,
        today,
        generatedAt: new Date().toISOString()
      })
      const result = await window.api.saveSummary(current.name, markdown)
      if (!result.ok) setMessage({ ok: false, text: result.message })
      else if (result.value) setMessage({ ok: true, text: `Saved to ${result.value}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Sprint summary"
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button type="button" onClick={close}>
            {message?.ok ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!available || busy || snapshots === null}
            onClick={() => void save()}
          >
            {busy ? 'Working…' : 'Save summary…'}
          </button>
        </>
      }
    >
      {message && (
        <div className={`message ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>
      )}

      {!available ? (
        <p className="hint" style={{ margin: 0 }}>
          The summary compares against a snapshot on disk and is saved as a file, so it needs the
          desktop app rather than the browser preview.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px' }}>
            A Markdown file with the board at the start and at the end, planned against actual hours
            for each person, every task, and everyone&rsquo;s notes — written to be turned into a
            summary by an AI agent.
          </p>

          <div className="field">
            <label htmlFor="summary-plan">Compare against</label>
            <select
              id="summary-plan"
              value={planId}
              disabled={snapshots === null}
              onChange={(event) => setPlanId(event.target.value)}
            >
              {(snapshots ?? []).map((meta) => (
                <option key={meta.id} value={meta.id}>
                  {meta.name}
                  {meta.kind === 'baseline' ? ' (automatic)' : ''} —{' '}
                  {new Date(meta.takenAt).toLocaleString()}
                </option>
              ))}
              <option value="">No plan — just what happened</option>
            </select>
            <div className="hint">
              {snapshots !== null && snapshots.length === 0
                ? 'There are no snapshots of this sprint, so there is no plan to compare against.'
                : 'Planned hours, extra work and delays are all measured against this snapshot.'}
            </div>
          </div>

          <div className="field">
            <label className="row" style={{ gap: 6, color: 'var(--text)' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={refreshFirst}
                disabled={!sprint.queryUrl}
                onChange={(event) => setRefreshFirst(event.target.checked)}
              />
              Refresh from TFS first
            </label>
            <div className="hint">
              {sprint.queryUrl
                ? 'Gets the latest Completed and Remaining Work, so the figures are final.'
                : 'Only a sprint imported from TFS can be refreshed.'}
            </div>
          </div>
        </>
      )}
    </Dialog>
  )
}
