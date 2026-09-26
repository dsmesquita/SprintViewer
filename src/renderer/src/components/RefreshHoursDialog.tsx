import { useState } from 'react'
import type { CustomChoice } from '@shared/customHours'
import { hours as fmt } from '../format'
import { cx } from '../format'
import { useApp } from '../store'
import Dialog from './Dialog'

/**
 * What to do about tasks whose hours you set by hand when TFS comes back with different
 * figures.
 *
 * Every row starts on *keep mine*, because the user went out of their way to set that number
 * and a refresh should not undo a deliberate act by default. Nothing is committed until this
 * is answered — cancelling leaves the board exactly as it was.
 */
export default function RefreshHoursDialog(): JSX.Element | null {
  const pending = useApp((s) => s.pendingRefresh)
  const resolve = useApp((s) => s.resolveRefresh)
  const cancel = useApp((s) => s.cancelRefresh)

  const [choices, setChoices] = useState<Map<number, CustomChoice>>(new Map())
  const [typed, setTyped] = useState<Map<number, string>>(new Map())

  if (!pending) return null

  const choiceFor = (id: number): CustomChoice => choices.get(id) ?? { kind: 'keep' }
  const pick = (id: number, choice: CustomChoice): void =>
    setChoices((previous) => new Map(previous).set(id, choice))
  const all = (kind: 'keep' | 'theirs'): void =>
    setChoices(new Map(pending.conflicts.map((c) => [c.workItemId, { kind }])))

  return (
    <Dialog
      title="Your hours, or the ones from TFS?"
      onClose={cancel}
      footer={
        <>
          <button type="button" onClick={cancel}>
            Cancel the refresh
          </button>
          <button type="button" className="primary" onClick={() => resolve(choices)}>
            Apply
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px' }}>
        {pending.conflicts.length === 1 ? 'One task has' : `${pending.conflicts.length} tasks have`}{' '}
        hours you set by hand, and TFS now says something different. The rest of the refresh is
        ready and waiting on this.
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="hint" style={{ margin: 0 }}>
          Apply to all:
        </span>
        <button type="button" onClick={() => all('keep')}>
          Keep mine
        </button>
        <button type="button" onClick={() => all('theirs')}>
          Use TFS
        </button>
      </div>

      {pending.conflicts.map((conflict) => {
        const choice = choiceFor(conflict.workItemId)
        const draft = typed.get(conflict.workItemId) ?? String(conflict.yours)
        const parsed = Number(draft)
        return (
          <div key={conflict.workItemId} className="conflict">
            <div className="conflict-head">
              <strong>#{conflict.workItemId}</strong> {conflict.title}
            </div>
            <div className="hint" style={{ marginTop: 0 }}>
              yours {fmt(conflict.yours)} · TFS now says {fmt(conflict.theirs)}
            </div>
            <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={cx('choice-pill', choice.kind === 'keep' && 'is-on')}
                onClick={() => pick(conflict.workItemId, { kind: 'keep' })}
              >
                Keep {fmt(conflict.yours)}
              </button>
              <button
                type="button"
                className={cx('choice-pill', choice.kind === 'theirs' && 'is-on')}
                onClick={() => pick(conflict.workItemId, { kind: 'theirs' })}
              >
                Use {fmt(conflict.theirs)}
              </button>
              <span className={cx('choice-pill', choice.kind === 'set' && 'is-on')}>
                Set{' '}
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={draft}
                  aria-label={`Hours for ${conflict.workItemId}`}
                  onChange={(event) => {
                    const value = event.target.value
                    setTyped((previous) => new Map(previous).set(conflict.workItemId, value))
                    const next = Number(value)
                    if (Number.isFinite(next) && next > 0) {
                      pick(conflict.workItemId, { kind: 'set', hours: next })
                    }
                  }}
                />
                h
              </span>
            </div>
            {choice.kind === 'set' && !(Number.isFinite(parsed) && parsed > 0) && (
              <div className="conflict-bad">That is not a number of hours.</div>
            )}
          </div>
        )
      })}
    </Dialog>
  )
}
