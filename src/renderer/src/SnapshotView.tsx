import { useEffect, useMemo, useState } from 'react'
import { formatRange } from '@shared/dates'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import { diffSprints, type Change, type Snapshot } from '@shared/snapshots'
import { todayISO } from '@shared/dates'
import type { Sprint } from '@shared/types'
import SprintGrid from './components/SprintGrid'
import { cx } from './format'
import { DiffIcon } from './icons'
import { useApp } from './store'

/**
 * A snapshot in its own window: the board as it was, read-only, to sit beside the live one.
 *
 * The differences are computed but not shown until asked for. A plain board is what you want
 * first — the analysis is a second question, and forcing it on the first glance would bury
 * the thing you opened the window to look at.
 */
export default function SnapshotView({
  sprintId,
  snapshotId
}: {
  sprintId: string
  snapshotId: string
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [current, setCurrent] = useState<Sprint | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void (async () => {
      const loaded = await window.api.loadSnapshot(sprintId, snapshotId)
      if (!loaded) {
        setFailed(true)
        return
      }
      // The grid reads the sprint from the store, so the snapshot has to be in there *before*
      // the render that draws it — an effect would be one render too late, and the grid would
      // ask for a sprint that is not there yet. Nothing in this window ever writes it back.
      useApp.setState({ sprint: loaded.sprint, isSample: true, loading: false })
      setSnapshot(loaded)
      setCurrent(await window.api.loadSprint(sprintId))
    })()
  }, [sprintId, snapshotId])

  const today = todayISO()
  const changes = useMemo<Change[]>(() => {
    if (!snapshot || !current) return []
    return diffSprints(snapshot.sprint, current, anchorFor(current, today))
  }, [snapshot, current, today])

  if (failed) return <div className="empty-state">That snapshot is no longer on disk.</div>
  if (!snapshot) return <div className="empty-state">Loading…</div>

  const sprint = snapshot.sprint
  const anchor = anchorFor(sprint, today)
  const layouts = layoutSprint(sprint, anchor)
  const changed = new Set(changes.map((change) => change.workItemId))

  return (
    <div className="app">
      <header className="toolbar">
        <span className="title">{snapshot.name}</span>
        <span className="subtitle">
          {formatRange(sprint.days[0]?.date ?? '', sprint.days[sprint.days.length - 1]?.date ?? '')}{' '}
          · snapshot taken {new Date(snapshot.takenAt).toLocaleString()}
        </span>
        <span className="sample-banner">Read-only</span>
        <span className="spacer" />
        {current && (
          <button
            type="button"
            className={cx(showDiff && 'primary')}
            onClick={() => setShowDiff((on) => !on)}
            title="Mark what has changed on the live board since this was taken"
          >
            <DiffIcon />{' '}
            {changes.length === 0
              ? 'Nothing has changed'
              : `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}
          </button>
        )}
      </header>

      <div className="body">
        <div className={cx('snapshot-grid', showDiff && 'is-diffing')}>
          <SprintGrid
            layouts={layouts}
            anchor={anchor}
            highlightWorkItems={showDiff ? changed : undefined}
            readOnly
            onDayContextMenu={() => {}}
            onBlockContextMenu={() => {}}
            onMemberContextMenu={() => {}}
          />
        </div>
        {showDiff && (
          <aside className="panel">
            <div className="panel-head">
              <div className="panel-tabs">
                <span className="tab is-active">Since this snapshot</span>
              </div>
            </div>
            <div className="panel-body">
              {changes.length === 0 ? (
                <p className="empty">The board is exactly as it was.</p>
              ) : (
                changes.map((change) => (
                  <div key={change.workItemId} className="change">
                    <div className="change-head">
                      {change.kinds.map((kind) => (
                        <span key={kind} className={cx('change-tag', `is-${kind}`)}>
                          {kind}
                        </span>
                      ))}
                      <strong>#{change.workItemId}</strong>
                    </div>
                    <div className="change-title">{change.title}</div>
                    <div className="hint" style={{ margin: 0 }}>
                      {change.detail}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
