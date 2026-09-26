import type { PastConflict } from '@shared/pastFit'
import type { Sprint } from '@shared/types'
import { hours } from '../format'
import Dialog from './Dialog'

/**
 * Reported hours with nowhere to go before today, because blocks pinned back there hold space
 * nothing was reported against. Names them, and offers to move the unreported part forward.
 */
export default function PastFitDialog({
  sprint,
  conflicts,
  onMoveForward,
  onClose
}: {
  sprint: Sprint
  conflicts: PastConflict[]
  onMoveForward: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title="Reported hours do not fit"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Dismiss
          </button>
          {conflicts.some((c) => c.freeable > 0) && (
            <button type="button" className="primary" onClick={onMoveForward}>
              Move them forward
            </button>
          )}
        </>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        Work that has hours reported against it in TFS happened on days that have passed, so that is
        where it belongs. These people have tasks holding space back there that nothing was reported
        against.
      </p>
      {conflicts.map((conflict) => (
        <div key={conflict.memberId} className="conflict">
          <div className="conflict-head">
            <strong>{conflict.memberName}</strong> — {hours(conflict.missing)} of reported work has
            nowhere to go
          </div>
          {conflict.offenders.length > 0 && (
            <ul className="left-behind">
              {conflict.offenders.map((offender) => (
                <li key={offender.blockId}>
                  <strong>#{offender.workItemId}</strong>{' '}
                  {sprint.workItems[offender.workItemId]?.title ?? ''} — {hours(offender.excess)}{' '}
                  {offender.justified > 0
                    ? `moves forward, ${hours(offender.justified)} reported stays`
                    : 'moves forward, nothing was reported against it'}
                </li>
              ))}
            </ul>
          )}
          {conflict.impossible && (
            <p className="conflict-bad">
              {conflict.freeable > 0
                ? `That frees ${hours(conflict.freeable)} of the ${hours(conflict.missing)} needed. `
                : 'Nothing back there can be moved — every hour before today is already accounted for by work that was reported. '}
              More hours are reported against {conflict.memberName} than the days that have passed
              can hold, so the rest cannot be drawn wherever things are put. Check the Completed
              Work on {conflict.memberName}&rsquo;s tasks in TFS.
            </p>
          )}
        </div>
      ))}
    </Dialog>
  )
}
