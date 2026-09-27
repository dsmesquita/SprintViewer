import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { displayName, memberFor } from '@shared/assignment'
import {
  hasCustomHours,
  isReportedOnly,
  plannedHours,
  plannedHoursIn,
  reportedHours
} from '@shared/sizing'
import type { Block } from '@shared/types'
import { cx, hours, toneFor } from '../../format'
import { DRAG_ID_PREFIX, type DragData } from '../../grid'
import { ExternalIcon } from '../../icons'
import { useSprint } from '../../store'
import type { BlockContextMenu } from './types'
import { sourceField, TimeFields } from './TimeFields'

interface TaskCardProps {
  block: Block
  isHighlighted: boolean
  onHover: (workItemId: number | null) => void
  onBlockContextMenu: BlockContextMenu
  /** Set when the task is hidden from the backlog and shown anyway: brings it back. */
  onUnhide?: (workItemId: number) => void
}

export default function TaskCard({
  block,
  isHighlighted,
  onHover,
  onBlockContextMenu,
  onUnhide
}: TaskCardProps): JSX.Element {
  const sprint = useSprint()
  const item = sprint.workItems[block.workItemId]
  // Compared against the item's planned size, not its remaining work — otherwise every task
  // sized by its estimate would be labelled a split.
  const planned = item ? plannedHoursIn(sprint, item.id) : 0
  const manual = item !== undefined && hasCustomHours(sprint, item.id)
  const isSplit = item !== undefined && block.hours < planned
  const assignee = displayName(item?.assignedTo)
  // Nobody on the squad owns it in TFS — unassigned, or someone from outside the team.
  const outsider = item !== undefined && memberFor(sprint.members, item.assignedTo) === undefined
  // Done hours waiting in the backlog have a card of their own, which says them already.
  const done = item && !(sprint.doneInBacklog ?? []).includes(item.id) ? reportedHours(item) : 0
  const data: DragData = {
    kind: 'block',
    blockId: block.id,
    workItemId: block.workItemId,
    hours: block.hours
  }
  // A block with no hours has no width on the calendar, so there is nothing to drop.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${DRAG_ID_PREFIX}${block.id}`,
    data,
    disabled: block.hours <= 0
  })

  const [showTimeInfo, setShowTimeInfo] = useState(false)

  const customHoursValue = sprint.customHours?.[block.workItemId]
  const activeTimeField = sourceField(customHoursValue, item)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cx(
        'task-card',
        outsider && 'is-outsider',
        isHighlighted && 'is-highlighted',
        isDragging && 'is-dragging',
        block.hours > 0 && 'is-draggable',
        onUnhide && 'is-hidden-card'
      )}
      title={
        outsider
          ? assignee.length > 0
            ? `Assigned to ${assignee}, who is not on this squad`
            : 'Nobody is assigned to it in TFS'
          : undefined
      }
      onMouseEnter={() => {
        onHover(block.workItemId)
        setShowTimeInfo(true)
      }}
      onMouseLeave={() => {
        onHover(null)
        setShowTimeInfo(false)
      }}
      onContextMenu={(event) =>
        onBlockContextMenu(block.id, event, `#${block.workItemId} ${item?.title ?? ''}`)
      }
    >
      <div className="task-top">
        <button
          type="button"
          className="task-link"
          onClick={() => item && void window.api?.openExternal(item.url)}
          title="Open in TFS"
        >
          #{block.workItemId} <ExternalIcon />
        </button>
        <span className={cx('day-off-pill', toneFor(block.workItemId))} style={{ margin: 0 }}>
          {item?.type ?? 'Task'}
        </span>
        <span className="task-type">{item?.missingFromQuery ? 'not in query' : item?.state}</span>
        {onUnhide && (
          <button
            type="button"
            className="ghost unhide-button"
            onClick={() => onUnhide(block.workItemId)}
            title="Show it in the backlog again"
          >
            Unhide
          </button>
        )}
      </div>
      <div className="task-title">{item?.title ?? 'Unknown work item'}</div>
      <div className="task-meta">
        {block.hours <= 0
          ? 'No hours — set remaining or completed work in TFS'
          : isSplit
            ? `${hours(block.hours)} of ${hours(planned)} · split`
            : item && isReportedOnly(item)
              ? `${hours(block.hours)} reported · nothing left`
              : `${hours(block.hours)} remaining`}
        {/*
          Reported hours are drawn on the calendar, not here, so without naming them the card
          would understate a task that is half done — it would read "4h" for ten hours of work.
        */}
        {done > 0 && !isSplit && ` · ${hours(done)} done`}
        {manual && item && (
          <span
            className="manual-mark"
            title={`Manual time — TFS says ${hours(plannedHours(item))}`}
          >
            {' '}
            ✎
          </span>
        )}
        {assignee.length > 0 && (
          <>
            {' · '}
            <span className="task-assignee" title={`Assigned to ${assignee} in TFS`}>
              {assignee}
            </span>
          </>
        )}
      </div>
      {showTimeInfo && item && (
        <TimeFields item={item} custom={customHoursValue} active={activeTimeField} />
      )}
    </div>
  )
}
