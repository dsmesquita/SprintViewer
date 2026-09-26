import type { AssignmentMismatch } from '@shared/assignment'
import type { DropChoice } from '@shared/drop'
import type { Sprint } from '@shared/types'
import type { SplitQuestion } from '../dnd/useSprintDnd'
import { cx, hours } from '../format'
import Dialog from './Dialog'

/** A task dropped inside another one: split that one around it, or keep it whole on one side. */
export function SplitQuestionDialog({
  sprint,
  question,
  onAnswer,
  onClose
}: {
  sprint: Sprint
  question: SplitQuestion
  onAnswer: (choice: Exclude<DropChoice, 'auto'>) => void
  onClose: () => void
}): JSX.Element {
  const { occupant } = question
  return (
    <Dialog
      title={`#${occupant.workItemId} is already here`}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        You dropped it {hours(occupant.offset)} into{' '}
        <strong>
          #{occupant.workItemId} {sprint.workItems[occupant.workItemId]?.title ?? ''}
        </strong>
        . Where should it go?
      </p>
      <div className="choice-list">
        {(
          [
            [
              'split',
              'Split it here',
              `${hours(occupant.offset)} before, ${hours(occupant.hours - occupant.offset)} after`
            ],
            ['after', 'Keep it before', 'It stays whole, the dropped task follows it'],
            ['before', 'Keep it after', 'It stays whole, the dropped task goes first']
          ] as Array<[Exclude<DropChoice, 'auto'>, string, string]>
        ).map(([choice, label, detail]) => (
          <button
            key={choice}
            type="button"
            className={cx('choice', choice === 'split' && 'is-primary')}
            onClick={() => onAnswer(choice)}
          >
            <span className="choice-label">{label}</span>
            <span className="choice-detail">{detail}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

/** A drop on a row other than the one TFS assigns the task to. */
export function MismatchDialog({
  mismatch,
  onConfirm,
  onClose
}: {
  mismatch: AssignmentMismatch
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Dialog
      title="Assigned to someone else"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            Put it there anyway
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        #{mismatch.workItemId} is assigned to <strong>{mismatch.assignee}</strong> in TFS. Put it on{' '}
        <strong>{mismatch.memberName}</strong>&rsquo;s calendar anyway?
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        The work item in TFS is not changed either way — this app only reads.
      </p>
    </Dialog>
  )
}
