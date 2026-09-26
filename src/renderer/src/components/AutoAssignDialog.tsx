import { isMeeting, type AssignPlan, type AssignSummary, type BaseChange } from '@shared/autoAssign'
import type { Sprint } from '@shared/types'
import Dialog from './Dialog'

interface Props {
  sprint: Sprint
  /** The plan with every rule applied. */
  allow: AssignPlan
  /** The same run with the calendar held fixed. Only made when `allow` would move something. */
  keep: AssignPlan | null
  onApply: (plan: AssignPlan) => void
  onClose: () => void
}

/**
 * Confirms an auto-assign before anything moves.
 *
 * Usually that is a count and a button. When following the rules would move or cut work
 * already on a calendar, it says what and why, and offers the run that leaves it all alone —
 * so assigning the rest of the backlog never quietly rearranges what the user planned.
 */
export default function AutoAssignDialog({
  sprint,
  allow,
  keep,
  onApply,
  onClose
}: Props): JSX.Element {
  const changes = allow.baseChanges
  const conflicted = changes.length > 0 && keep !== null
  const title = (id: number): string => `#${id} ${sprint.workItems[id]?.title ?? ''}`
  const nameOf = (memberId: string): string =>
    sprint.members.find((member) => member.id === memberId)?.name ?? memberId

  if (allow.summary.placed === 0 && (!keep || keep.summary.placed === 0)) {
    return (
      <Dialog
        title="Nothing to assign"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose}>
            Close
          </button>
        }
      >
        <Summary summary={allow.summary} />
      </Dialog>
    )
  }

  if (!conflicted) {
    return (
      <Dialog
        title={`Assign ${count(allow.summary.placed, 'task')}?`}
        onClose={onClose}
        footer={
          <>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => onApply(allow)}>
              Assign
            </button>
          </>
        }
      >
        <Summary summary={allow.summary} />
        <p className="hint" style={{ marginBottom: 0 }}>
          Nobody is put over their capacity, and nothing already on a calendar is moved.
        </p>
      </Dialog>
    )
  }

  const lostChains = allow.summary.valsChained - keep.summary.valsChained
  const lostSpread = allow.summary.meetingsSplit - keep.summary.meetingsSplit
  // Meetings kept spread can still be spread differently — only over days the existing work
  // does not reach — and the counts alone would hide that.
  const movedSpread = meetingDates(allow.sprint).filter(([id, dates]) => {
    const other = meetingDates(keep.sprint).find(([otherId]) => otherId === id)?.[1]
    return other !== undefined && other !== dates
  }).length

  return (
    <Dialog
      title="Auto-assign would change your calendar"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="button" onClick={() => onApply(keep)} disabled={keep.summary.placed === 0}>
            Keep my calendar fixed
          </button>
          <button type="button" className="primary" onClick={() => onApply(allow)}>
            Allow changes
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 8px' }}>
        To follow the rules, {count(changes.length, 'task')} already on the calendar would{' '}
        {changes.length === 1 ? 'move' : 'move or be split'}:
      </p>
      <ul className="left-behind base-changes">
        {changes.map((change) => (
          <li key={change.blockId}>
            <strong>{title(change.workItemId)}</strong> on {nameOf(change.memberId)}&rsquo;s
            calendar {change.kind === 'split' ? 'is split' : 'moves later'} —{' '}
            {because(change, title)}
          </li>
        ))}
      </ul>

      <div className="assign-options">
        <div>
          <p className="section-title">Allow changes</p>
          <Summary summary={allow.summary} />
        </div>
        <div>
          <p className="section-title">Keep my calendar fixed</p>
          <Summary summary={keep.summary} />
          {(lostChains > 0 || lostSpread > 0 || movedSpread > 0) && (
            <p className="hint" style={{ marginTop: 6 }}>
              {lostChains > 0 &&
                `${count(lostChains, 'VAL task')} ${lostChains === 1 ? 'goes' : 'go'} after the owner's other work instead of straight after ${lostChains === 1 ? 'its' : 'their'} DEV. `}
              {lostSpread > 0 &&
                `${count(lostSpread, 'meeting allowance')} ${lostSpread === 1 ? 'is' : 'are'} not spread over the sprint. `}
              {movedSpread > 0 &&
                `${count(movedSpread, 'meeting allowance')} ${movedSpread === 1 ? 'is' : 'are'} spread only over the days after the work already planned. `}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function because(change: BaseChange, title: (id: number) => string): string {
  const vals = change.causes
    .filter((cause) => cause.rule === 'val')
    .map((cause) => title(cause.workItemId))
  const meetings = change.causes
    .filter((cause) => cause.rule === 'meeting')
    .map((cause) => title(cause.workItemId))
  const late = change.causes
    .filter((cause) => cause.rule === 'late-val')
    .map((cause) => title(cause.workItemId))
  const reasons = [
    vals.length > 0 &&
      `to start ${vals.join(', ')} right after ${vals.length === 1 ? 'its' : 'their'} DEV`,
    late.length > 0 && `to fit ${late.join(', ')} in before the sprint ends`,
    meetings.length > 0 && `to spread ${meetings.join(', ')} over the sprint`
  ].filter(Boolean)
  return reasons.length > 0 ? `${reasons.join(', and ')}.` : 'to make room for new work.'
}

function Summary({ summary }: { summary: AssignSummary }): JSX.Element {
  const lines: Array<[number, string]> = [
    [
      summary.meetingsSplit,
      `${one(summary.meetingsSplit, 'meeting allowance is', 'meeting allowances are')} spread over several days`
    ],
    [
      summary.valsChained,
      `${one(summary.valsChained, 'VAL task starts', 'VAL tasks start')} straight after ${one(summary.valsChained, 'its', 'their')} DEV`
    ],
    [
      summary.valsLate,
      `${one(summary.valsLate, 'VAL task goes', 'VAL tasks go')} as late as the sprint allows — ${one(summary.valsLate, 'its', 'their')} DEV ends too close to the end to follow it`
    ],
    [
      summary.waitingForDev,
      `${one(summary.waitingForDev, 'VAL task stays', 'VAL tasks stay')} in the backlog until ${one(summary.waitingForDev, 'its', 'their')} DEV is planned`
    ],
    [
      summary.unattributed,
      `${one(summary.unattributed, 'stays', 'stay')} in the backlog — TFS names nobody on this team against ${one(summary.unattributed, 'it', 'them')}`
    ],
    [
      summary.tooBig,
      `${one(summary.tooBig, 'does', 'do')} not fit in the hours ${one(summary.tooBig, 'its', 'their')} person has left`
    ],
    [
      summary.unsized,
      `${one(summary.unsized, 'has', 'have')} no hours against ${one(summary.unsized, 'it', 'them')} in TFS at all`
    ]
  ]
  return (
    <>
      {summary.placed > 0 && (
        <p style={{ margin: '0 0 6px' }}>
          <strong>
            {summary.placed} {summary.placed === 1 ? 'task goes' : 'tasks go'}
          </strong>{' '}
          onto {count(summary.people, 'calendar')}.
        </p>
      )}
      <ul className="left-behind">
        {lines
          .filter(([n]) => n > 0)
          .map(([n, text]) => (
            <li key={text}>
              <strong>{n}</strong> {text}.
            </li>
          ))}
      </ul>
    </>
  )
}

/** Each meeting work item on the calendar, with the days its pieces are pinned to. */
function meetingDates(sprint: Sprint): Array<[number, string]> {
  const days = new Map<number, string[]>()
  for (const queue of Object.values(sprint.queues)) {
    for (const block of queue) {
      if (!block.pin || !isMeeting(sprint.workItems[block.workItemId])) continue
      days.set(block.workItemId, [...(days.get(block.workItemId) ?? []), block.pin.date])
    }
  }
  return [...days].map(([id, dates]) => [id, [...dates].sort().join(',')])
}

function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`
}

/** Singular or plural, so the counts in a summary read as English rather than as a log line. */
function one(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}
