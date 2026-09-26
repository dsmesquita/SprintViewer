import Dialog from './Dialog'

/** Confirms sending every task back to the backlog, saying what that discards. */
export default function ClearSprintDialog({
  cost,
  onConfirm,
  onClose
}: {
  cost: { blocks: number; recordedDays: number }
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title="Clear the sprint?"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            Clear sprint
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        <strong>
          {cost.blocks} {cost.blocks === 1 ? 'task returns' : 'tasks return'}
        </strong>{' '}
        to the backlog
        {cost.recordedDays > 0 && (
          <>
            , and the recorded work on{' '}
            <strong>
              {cost.recordedDays} past {cost.recordedDays === 1 ? 'day' : 'days'}
            </strong>{' '}
            is discarded
          </>
        )}
        . This cannot be undone.
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        Parts of a task that were split rejoin as one. Nothing is written to TFS.
      </p>
    </Dialog>
  )
}
