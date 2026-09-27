import { useDraggable } from '@dnd-kit/core'
import { displayName } from '@shared/assignment'
import type { WorkItem } from '@shared/types'
import { cx, hours, toneFor } from '../../format'
import { DRAG_ID_PREFIX, type DragData } from '../../grid'
import { ExternalIcon } from '../../icons'

interface DoneCardProps {
  item: WorkItem
  /** The hours TFS reports done against it. */
  done: number
  isHighlighted: boolean
  onHover: (workItemId: number | null) => void
}

/**
 * A task's done hours, waiting in the backlog to be put on the day they were worked. It looks
 * like any card — the red dot is what says "done" — and drags like the done hours on the
 * calendar: onto a day that has passed, or onto today.
 */
export default function DoneCard({
  item,
  done,
  isHighlighted,
  onHover
}: DoneCardProps): JSX.Element {
  const assignee = displayName(item.assignedTo)
  const data: DragData = { kind: 'reported', workItemId: item.id, hours: done }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${DRAG_ID_PREFIX}done:${item.id}`,
    data
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cx(
        'task-card',
        'is-done-card',
        isHighlighted && 'is-highlighted',
        isDragging && 'is-dragging',
        'is-draggable'
      )}
      title="Hours already done — drag them onto the day they were worked, or onto today"
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="done-dot" aria-label="Done hours" />
      <div className="task-top">
        <button
          type="button"
          className="task-link"
          onClick={() => void window.api?.openExternal(item.url)}
          title="Open in TFS"
        >
          #{item.id} <ExternalIcon />
        </button>
        <span className={cx('day-off-pill', toneFor(item.id))} style={{ margin: 0 }}>
          {item.type}
        </span>
        <span className="task-type">{item.state}</span>
      </div>
      <div className="task-title">{item.title}</div>
      <div className="task-meta">
        {hours(done)} done
        {assignee.length > 0 && (
          <>
            {' · '}
            <span className="task-assignee" title={`Assigned to ${assignee} in TFS`}>
              {assignee}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
