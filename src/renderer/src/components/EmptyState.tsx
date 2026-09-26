import { useApp } from '../store'

/** What the window shows with no sprint open: how to get one, or a sample to look around. */
export default function EmptyState({ loading }: { loading: boolean }): JSX.Element {
  const openDialog = useApp((s) => s.openDialog)
  const loadSample = useApp((s) => s.loadSample)
  const settings = useApp((s) => s.settings)

  if (loading) return <div className="empty-state">Loading…</div>

  const needsSetup = !settings?.hasPat || settings.members.length === 0

  return (
    <div className="empty-state">
      <h1>No sprint yet</h1>
      <p style={{ maxWidth: 460, margin: 0 }}>
        {needsSetup
          ? 'Add your team and a personal access token in Settings, then import a sprint from a TFS query.'
          : 'Import a sprint from a TFS query to fill the calendar.'}
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => openDialog('start-sprint')}>
          Start sprint…
        </button>
        <button type="button" onClick={() => openDialog('settings')}>
          Settings
        </button>
        <button type="button" onClick={loadSample}>
          Load sample data
        </button>
        <button type="button" onClick={() => openDialog('help')}>
          Read me
        </button>
      </div>
    </div>
  )
}
