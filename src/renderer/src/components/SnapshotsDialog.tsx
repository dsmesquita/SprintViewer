import { useEffect, useState } from 'react'
import type { SnapshotMeta } from '@shared/snapshots'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * The board as it stood, kept so it can be looked at later.
 *
 * The question worth asking mid-sprint is what has moved since planning day, and that needs
 * the plan as it was — which is otherwise gone the moment anybody drags anything.
 */
export default function SnapshotsDialog(): JSX.Element {
  const sprint = useSprint()
  const close = useApp((s) => s.closeDialog)
  const applySprint = useApp((s) => s.applySprint)
  // `npm run dev:web` serves the UI with no main process behind it, so there is no disk.
  const available = typeof window.api !== 'undefined'

  const [list, setList] = useState<SnapshotMeta[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    if (!window.api) return
    setList(await window.api.listSnapshots(sprint.id))
  }
  useEffect(() => {
    void reload()
  }, [sprint.id])

  const take = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.takeSnapshot(sprint, name)
    setBusy(false)
    setNote(result.ok ? `Saved “${result.value.name}”.` : result.message)
    if (result.ok) setName('')
    await reload()
  }

  const restore = async (meta: SnapshotMeta): Promise<void> => {
    const snapshot = await window.api.loadSnapshot(sprint.id, meta.id)
    if (!snapshot) {
      setNote('That snapshot is no longer on disk.')
      return
    }
    // Its own id, so restoring writes over the sprint rather than forking a second copy of it.
    applySprint({ ...snapshot.sprint, id: sprint.id }, `restore of “${meta.name}”`)
    close()
  }

  return (
    <Dialog
      title="Snapshots"
      onClose={close}
      footer={
        <button type="button" onClick={close}>
          Close
        </button>
      }
    >
      {!available ? (
        <p className="hint" style={{ margin: 0 }}>
          Snapshots are stored on disk, so they need the desktop app rather than the browser
          preview.
        </p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              type="text"
              style={{ flex: 1 }}
              value={name}
              placeholder="Name it — “Planning done”"
              aria-label="Snapshot name"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void take()}
            />
            <button type="button" className="primary" disabled={busy} onClick={() => void take()}>
              Take snapshot
            </button>
          </div>

          {list.length === 0 ? (
            <p className="empty">
              No snapshots yet.
              <br />
              Take one when the plan is agreed, and you can see what drifted later.
            </p>
          ) : (
            list.map((meta) => (
              <div key={meta.id} className="snapshot">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="snapshot-name">
                    {meta.name}
                    {meta.kind === 'baseline' && (
                      <span
                        className="snapshot-badge"
                        title="Taken by the app: replaced by each change on the first working day, then kept as the sprint's plan"
                      >
                        automatic
                      </span>
                    )}
                  </div>
                  <div className="hint" style={{ margin: 0 }}>
                    {new Date(meta.takenAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void window.api.openSnapshot(sprint.id, meta.id)}
                  title="Open it in its own window, beside this one"
                >
                  Open
                </button>
                <button type="button" onClick={() => void restore(meta)}>
                  Restore
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void window.api.exportSnapshot(sprint.id, meta.id)}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Delete ${meta.name}`}
                  onClick={async () => {
                    await window.api.deleteSnapshot(sprint.id, meta.id)
                    await reload()
                  }}
                >
                  ✕
                </button>
              </div>
            ))
          )}
          {note && (
            <p className="hint" style={{ marginBottom: 0 }}>
              {note}
            </p>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            Restoring replaces the board, and the back button undoes it like any other change.
            The automatic Sprint start snapshot is the plan the sprint summary compares against;
            deleted, it is taken again from the board as it is then.
          </p>
        </>
      )}
    </Dialog>
  )
}
