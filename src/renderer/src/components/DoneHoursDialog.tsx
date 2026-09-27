import { displayName } from '@shared/assignment'
import { reportedHours } from '@shared/sizing'
import { hours } from '../format'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * Asked after a refresh or an import: tasks still in the backlog have hours already done by
 * someone on the team. Draw those hours on the calendar, where they were worked, or keep them
 * in the backlog as cards to drag onto the right day? Each task is asked about once.
 */
export default function DoneHoursDialog({ ids }: { ids: number[] }): JSX.Element {
  const sprint = useSprint()
  const answer = useApp((s) => s.answerDoneQuestion)
  const dismiss = useApp((s) => s.dismissDoneQuestion)
  const items = ids.map((id) => sprint.workItems[id]).filter((item) => item !== undefined)
  const total = items.reduce((sum, item) => sum + reportedHours(item), 0)

  return (
    <Dialog
      title="Hours already done"
      onClose={dismiss}
      footer={
        <>
          <span className="spacer" />
          <button type="button" onClick={() => answer(false)}>
            Keep in the backlog
          </button>
          <button type="button" className="primary" onClick={() => answer(true)}>
            Place on the calendar
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        {items.length === 1 ? 'A task' : `${items.length} tasks`} in the backlog{' '}
        {items.length === 1 ? 'has' : 'have'} <strong>{hours(total)}</strong> already done by people
        on the team. Put those hours on their calendars, where they were worked — or keep them in
        the backlog, to drag onto the day each was really done?
      </p>
      <ul className="done-list">
        {items.map((item) => (
          <li key={item.id}>
            #{item.id} {item.title} — {hours(reportedHours(item))} · {displayName(item.assignedTo)}
          </li>
        ))}
      </ul>
      <p className="hint" style={{ marginBottom: 0 }}>
        In the backlog they show with a red dot. Their remaining hours stay a card of their own
        either way.
      </p>
    </Dialog>
  )
}
