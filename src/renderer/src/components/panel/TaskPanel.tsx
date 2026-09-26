import { formatDayHeader } from '@shared/dates'
import { placedHours } from '@shared/scheduling'
import { displayName } from '@shared/assignment'
import { hasCustomHours, plannedHoursIn, reportedHours } from '@shared/sizing'
import { cx, hours, toneFor } from '../../format'
import { ExternalIcon } from '../../icons'
import { useApp, useSprint } from '../../store'
import { sourceField, TimeFields } from './TimeFields'
import NoteCard from './NoteCard'

/**
 * Everything known about one task, opened by clicking it on the calendar.
 *
 * The calendar can only show a work item's number and, when the block is wide enough, its
 * title. Everything else about it — where its hours come from, how it was split, who holds
 * which part, what has been reported against it — had no home until now.
 */
export default function TaskPanel({ workItemId }: { workItemId: number }): JSX.Element {
  const sprint = useSprint()
  const openNote = useApp((s) => s.openNote)
  const openHours = useApp((s) => s.openHours)
  const openSplit = useApp((s) => s.openSplit)
  const unpinBlock = useApp((s) => s.unpinBlock)
  const unpinReported = useApp((s) => s.unpinReported)
  const moveBlock = useApp((s) => s.moveBlock)
  const item = sprint.workItems[workItemId]

  // Every piece of it, wherever it lives. A task split across two people has two entries, and
  // saying so is the point: the calendar shows the pieces but never that they are one task.
  const placements = [
    ...sprint.members.flatMap((member) =>
      (sprint.queues[member.id] ?? [])
        .filter((block) => block.workItemId === workItemId)
        .map((block) => ({ block, where: member.name, onCalendar: true }))
    ),
    ...sprint.backlog
      .filter((block) => block.workItemId === workItemId)
      .map((block) => ({ block, where: 'Backlog', onCalendar: false }))
  ]
  const first = placements[0]
  const notes = sprint.notes.filter((note) => note.taskIds.includes(workItemId))
  const reportedPin = sprint.reportedPins?.[workItemId]
  const planned = plannedHoursIn(sprint, workItemId)
  const done = item ? reportedHours(item) : 0

  if (!item) return <p className="empty">That work item is no longer in this sprint.</p>

  return (
    <>
      <div className="task-top">
        <button
          type="button"
          className="task-link"
          onClick={() => void window.api?.openExternal(item.url)}
          title="Open in TFS"
        >
          #{workItemId} <ExternalIcon />
        </button>
        <span className={cx('day-off-pill', toneFor(workItemId))} style={{ margin: 0 }}>
          {item.type}
        </span>
        <span className="task-type">{item.missingFromQuery ? 'not in query' : item.state}</span>
      </div>
      <div className="task-title" style={{ fontSize: 14, margin: '4px 0 8px' }}>
        {item.title}
      </div>
      {item.parentId !== undefined && (
        <div className="task-meta">
          Under #{item.parentId} · {item.parentType ?? 'work item'} — {item.parentTitle ?? ''}
        </div>
      )}
      <div className="task-meta">
        {displayName(item.assignedTo).length > 0
          ? `Assigned to ${displayName(item.assignedTo)} in TFS`
          : 'Nobody is assigned to it in TFS'}
      </div>

      <p className="section-title" style={{ marginTop: 16 }}>
        Hours
      </p>
      <TimeFields
        item={item}
        custom={sprint.customHours?.[workItemId]}
        active={sourceField(sprint.customHours?.[workItemId], item)}
      />
      <div className="stat-row">
        <span className="k">Size on the calendar</span>
        <span className="v">
          {hours(planned)}
          {hasCustomHours(sprint, workItemId) && ' ✎'}
        </span>
      </div>
      <div className="stat-row">
        <span className="k">Placed</span>
        <span className="v">{hours(placedHours(sprint, workItemId))}</span>
      </div>
      {done > 0 && (
        <div className="stat-row">
          <span className="k">Reported before today</span>
          <span className="v">{hours(done)}</span>
        </div>
      )}

      <p className="section-title" style={{ marginTop: 16 }}>
        Where it sits
      </p>
      {placements.length === 0 ? (
        <p className="empty">Nothing of it is scheduled or in the backlog.</p>
      ) : (
        placements.map(({ block, where, onCalendar }) => (
          <div className="stat-row" key={block.id}>
            <span className="k">
              {where}
              {block.pin && ` · pinned ${formatDayHeader(block.pin.date)}`}
            </span>
            <span className={cx('v', !onCalendar && 'is-muted')}>{hours(block.hours)}</span>
          </div>
        ))
      )}
      {done > 0 && (
        <div className="stat-row">
          <span className="k">
            Reported hours{' '}
            {reportedPin
              ? `· placed on ${formatDayHeader(reportedPin.date)}`
              : '· placed automatically'}
          </span>
          <span className="v">
            {reportedPin && (
              <button
                type="button"
                className="ghost"
                style={{ fontSize: 11, padding: '1px 6px' }}
                onClick={() => unpinReported(workItemId)}
              >
                Reset
              </button>
            )}
          </span>
        </div>
      )}

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => openHours(workItemId)}>
          Set hours…
        </button>
        {first && (
          <button
            type="button"
            disabled={first.block.hours <= 1}
            title={first.block.hours <= 1 ? 'Nothing to divide' : undefined}
            onClick={() => openSplit(first.block.id)}
          >
            Split…
          </button>
        )}
        <button type="button" onClick={() => openNote({ taskId: workItemId })}>
          Add note…
        </button>
        {first?.block.pin && (
          <button type="button" onClick={() => unpinBlock(first.block.id)}>
            Unpin
          </button>
        )}
        {first?.onCalendar && (
          <button
            type="button"
            onClick={() => moveBlock(first.block.id, { kind: 'backlog' }, sprint.backlog.length)}
          >
            Return to backlog
          </button>
        )}
      </div>

      <p className="section-title" style={{ marginTop: 16 }}>
        Notes {notes.length > 0 && `· ${notes.length}`}
      </p>
      {notes.length === 0 ? (
        <p className="empty">No notes mention this task.</p>
      ) : (
        notes.map((note) => <NoteCard key={note.id} note={note} />)
      )}
    </>
  )
}
