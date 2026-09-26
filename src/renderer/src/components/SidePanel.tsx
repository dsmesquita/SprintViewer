import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { formatDayHeader } from '@shared/dates'
import { effectiveCapacity, placedHours, type MemberLayout } from '@shared/scheduling'
import { emptyGroupsFor, groupBlocks, searchTextFor } from '@shared/grouping'
import { displayName, memberMatches } from '@shared/assignment'
import { isTagVisible, tagCounts, tagOf } from '@shared/tags'
import {
  hasCustomHours,
  isReportedOnly,
  plannedHours,
  plannedHoursIn,
  reportedHours
} from '@shared/sizing'
import { matches } from '@shared/text'
import type { Block, Note, WorkItem } from '@shared/types'
import { cx, hours, toneFor } from '../format'
import { BACKLOG_DROP_ID, DRAG_ID_PREFIX, type DragData } from '../grid'
import { ChevronIcon, ExternalIcon, FoldIcon } from '../icons'
import { useApp, useSprint } from '../store'

type BlockContextMenu = (blockId: string, event: React.MouseEvent, label: string) => void
/** Right-click on a backlog group's heading: the Bug or User Story it stands for. */
type GroupContextMenu = (parentId: number, event: React.MouseEvent) => void

interface Props {
  layouts: Record<string, MemberLayout>
  onBlockContextMenu: BlockContextMenu
  onGroupContextMenu: GroupContextMenu
}

export default function SidePanel({
  layouts,
  onBlockContextMenu,
  onGroupContextMenu
}: Props): JSX.Element {
  const collapsed = useApp((s) => s.panelCollapsed)
  const togglePanel = useApp((s) => s.togglePanel)
  const tab = useApp((s) => s.panelTab)
  const setPanelTab = useApp((s) => s.setPanelTab)
  const sprint = useSprint()
  const selectedMemberId = useApp((s) => s.selectedMemberId)
  const selectedWorkItemId = useApp((s) => s.selectedWorkItemId)
  const member = sprint.members.find((m) => m.id === selectedMemberId)
  const task = selectedWorkItemId === null ? undefined : sprint.workItems[selectedWorkItemId]

  if (collapsed) {
    return (
      <aside className="panel is-collapsed">
        <div className="panel-head" style={{ justifyContent: 'center', padding: 8 }}>
          <button type="button" className="ghost" onClick={togglePanel} title="Expand panel">
            <ChevronIcon direction="left" />
          </button>
        </div>
        <div className="panel-collapsed-label">
          Backlog · {hours(sprint.backlog.reduce((sum, b) => sum + b.hours, 0))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-tabs">
          <button
            type="button"
            className={cx('tab', tab === 'backlog' && 'is-active')}
            onClick={() => setPanelTab('backlog')}
          >
            Backlog
          </button>
          <button
            type="button"
            className={cx('tab', tab === 'person' && 'is-active')}
            onClick={() => setPanelTab('person')}
            disabled={!member}
            title={member ? `${member.name}'s notes and capacity` : 'Select a person in the grid'}
          >
            {member ? member.name : 'Person'}
          </button>
          <button
            type="button"
            className={cx('tab', tab === 'task' && 'is-active')}
            onClick={() => setPanelTab('task')}
            disabled={!task}
            title={task ? `#${task.id} ${task.title}` : 'Click a task on the calendar'}
          >
            Task
          </button>
        </div>
        <button type="button" className="ghost" onClick={togglePanel} title="Collapse panel">
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div className="panel-body">
        {tab === 'task' && task ? (
          <TaskPanel workItemId={task.id} />
        ) : tab === 'person' && member ? (
          <PersonPanel memberId={member.id} layout={layouts[member.id]} />
        ) : (
          <Backlog
            onBlockContextMenu={onBlockContextMenu}
            onGroupContextMenu={onGroupContextMenu}
          />
        )}
      </div>
    </aside>
  )
}

function Backlog({
  onBlockContextMenu,
  onGroupContextMenu
}: {
  onBlockContextMenu: BlockContextMenu
  onGroupContextMenu: GroupContextMenu
}): JSX.Element {
  const sprint = useSprint()
  const highlight = useApp((s) => s.highlightWorkItem)
  const highlighted = useApp((s) => s.highlightedWorkItemId)
  const search = useApp((s) => s.backlogSearch)
  const setSearch = useApp((s) => s.setBacklogSearch)
  const collapsed = useApp((s) => s.collapsedGroups)
  const toggleGroup = useApp((s) => s.toggleGroup)
  const setCollapsedGroups = useApp((s) => s.setCollapsedGroups)
  const toggleTag = useApp((s) => s.toggleTag)
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG_DROP_ID })

  // Counted over the whole backlog rather than what is currently shown, so a chip never
  // vanishes while it is switched off — you would have no way to switch it back on.
  const tags = tagCounts(sprint, sprint.backlog)
  const hidden = sprint.hiddenTags ?? []

  // Filtering only hides cards. The backlog order is untouched, so clearing the filters puts
  // the list back exactly as it was. Both filters apply at once.
  const visible = sprint.backlog.filter(
    (block) => isTagVisible(sprint, block) && matches(searchTextFor(sprint, block), search)
  )
  // Containers with no cards under them keep a heading, so neither a bug nobody has broken
  // down nor a story whose tasks are all placed disappears from the list. Same two filters.
  const empties = emptyGroupsFor(sprint).filter(
    ({ item }) =>
      !hidden.includes(tagOf(item.title)) &&
      matches(`${item.id} ${item.title} ${item.type}`, search)
  )
  const groups = groupBlocks(sprint, visible, empties)
  const total = visible.reduce((sum, block) => sum + block.hours, 0)
  const searching = search.trim().length > 0
  const anyExpanded = groups.some((group) => !collapsed.includes(group.key))

  // A task that is already on someone's calendar is not in the backlog, so searching for it
  // finds nothing here. Saying how many matched elsewhere beats a bare "no results".
  const scheduledMatches = searching
    ? Object.values(sprint.queues)
        .flat()
        .filter((block) => matches(searchTextFor(sprint, block), search)).length
    : 0

  return (
    <div ref={setNodeRef} className={cx('backlog-drop', isOver && 'is-over')}>
      <div className="search-row">
        <input
          type="text"
          value={search}
          placeholder="Filter by number or title"
          aria-label="Filter the backlog"
          onChange={(event) => setSearch(event.target.value)}
        />
        {searching && (
          <button type="button" className="ghost" onClick={() => setSearch('')} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      {tags.length > 1 && (
        <div className="tag-row">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              className={cx('tag-chip', hidden.includes(entry.tag) && 'is-off')}
              onClick={() => toggleTag(entry.tag)}
              aria-pressed={!hidden.includes(entry.tag)}
              title={`${hidden.includes(entry.tag) ? 'Show' : 'Hide'} ${entry.tag} · ${hours(
                entry.hours
              )}`}
            >
              {entry.tag} <span className="tag-count">{entry.count}</span>
            </button>
          ))}
        </div>
      )}

      {groups.length > 0 ? (
        <>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <p className="section-title" style={{ flex: 1, margin: '4px 0 8px' }}>
              {searching || hidden.length > 0
                ? `${visible.length} of ${sprint.backlog.length} · ${hours(total)}`
                : `Unassigned · ${hours(total)} across ${sprint.backlog.length} items`}
            </p>
            {!searching && groups.length > 1 && (
              <button
                type="button"
                className="ghost fold-all"
                onClick={() =>
                  setCollapsedGroups(anyExpanded ? groups.map((group) => group.key) : [])
                }
                title={anyExpanded ? 'Collapse every group' : 'Expand every group'}
                aria-label={anyExpanded ? 'Collapse all' : 'Expand all'}
              >
                <FoldIcon folded={!anyExpanded} size={14} />
              </button>
            )}
          </div>
          {groups.map((group) => {
            // A search is a request to see what matched, so it overrides a collapsed group.
            const isCollapsed = !searching && collapsed.includes(group.key)
            return (
              <div className="group" key={group.key}>
                <button
                  type="button"
                  className="group-head"
                  onClick={() => toggleGroup(group.key)}
                  onContextMenu={(event) => {
                    // The leftover group has no work item to put tasks under.
                    if (!group.parent) return
                    onGroupContextMenu(group.parent.id, event)
                  }}
                  aria-expanded={!isCollapsed}
                  title={group.parent ? `#${group.parent.id} ${group.parent.title}` : undefined}
                >
                  <span className={cx('group-caret', isCollapsed && 'is-collapsed')} aria-hidden="true">
                    ▾
                  </span>
                  <span className="group-title">
                    {group.parent ? group.parent.title : 'No parent work item'}
                  </span>
                  <span className="group-meta">
                    {group.blocks.length > 0
                      ? `${group.blocks.length} · ${hours(group.hours)}`
                      : group.empty?.reason === 'all-scheduled'
                        ? 'all placed'
                        : 'no tasks'}
                  </span>
                </button>
                {group.parent && (
                  <div className="group-sub">
                    #{group.parent.id} · {group.parent.type}
                  </div>
                )}
                {!isCollapsed && group.blocks.length === 0 && (
                  <p className="group-empty">
                    {group.empty?.reason !== 'all-scheduled'
                      ? 'No tasks under this item.'
                      : group.empty.taskCount === 1
                        ? 'Its only task is on the calendar.'
                        : `All ${group.empty.taskCount} tasks are on the calendar.`}
                  </p>
                )}
                {!isCollapsed &&
                  group.blocks.map((block) => (
                    <TaskCard
                      key={block.id}
                      block={block}
                      isHighlighted={highlighted === block.workItemId}
                      onHover={highlight}
                      onBlockContextMenu={onBlockContextMenu}
                    />
                  ))}
              </div>
            )
          })}
        </>
      ) : sprint.backlog.length === 0 ? (
        <p className="empty">
          Everything is scheduled.
          <br />
          Drop a task here to unschedule it.
        </p>
      ) : (
        <p className="empty">
          Nothing in the backlog matches.
          {hidden.length > 0 && (
            <>
              <br />
              {hidden.length === 1 ? 'Tag' : 'Tags'} {hidden.join(', ')}{' '}
              {hidden.length === 1 ? 'is' : 'are'} hidden.
            </>
          )}
          {scheduledMatches > 0 && (
            <>
              <br />
              {scheduledMatches} scheduled {scheduledMatches === 1 ? 'task is' : 'tasks are'}{' '}
              already on the calendar.
            </>
          )}
        </p>
      )}
    </div>
  )
}

interface TaskCardProps {
  block: Block
  isHighlighted: boolean
  onHover: (workItemId: number | null) => void
  onBlockContextMenu: BlockContextMenu
}

function TaskCard({
  block,
  isHighlighted,
  onHover,
  onBlockContextMenu
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
  const outsider =
    item !== undefined &&
    !sprint.members.some((member) => memberMatches(member, item.assignedTo ?? ''))
  const done = item ? reportedHours(item) : 0
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
        block.hours > 0 && 'is-draggable'
      )}
      title={
        outsider
          ? assignee.length > 0
            ? `Assigned to ${assignee}, who is not on this squad`
            : 'Nobody is assigned to it in TFS'
          : undefined
      }
      onMouseEnter={() => { onHover(block.workItemId); setShowTimeInfo(true) }}
      onMouseLeave={() => { onHover(null); setShowTimeInfo(false) }}
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
        <span className="task-type">
          {item?.missingFromQuery ? 'not in query' : item?.state}
        </span>
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

type TimeField = 'estimated' | 'completed' | 'remaining' | 'custom'

/**
 * Which TFS field the size on the board comes from.
 *
 * Shown wherever the numbers are, because "8h" means something different depending on where it
 * came from, and the answer is not obvious from the fields side by side. Never the estimate:
 * that is a guess about the task, not a statement of how big it is.
 */
function sourceField(custom: number | undefined, item: WorkItem | undefined): TimeField {
  if (custom !== undefined) return 'custom'
  if (item && isReportedOnly(item)) return 'completed'
  return 'remaining'
}

function TimeFields({
  item,
  custom,
  active
}: {
  item: WorkItem
  custom: number | undefined
  active: TimeField
}): JSX.Element {
  const fmt = (value: number | undefined): string =>
    value === undefined || value <= 0 ? '—' : hours(value)

  return (
    <div className="task-time-info">
      <span className={cx('time-row', active === 'estimated' && 'is-active')}>
        <span className="time-label">Estimated</span>
        <span className="time-value">{fmt(item.originalEstimate)}</span>
      </span>
      <span className={cx('time-row', active === 'completed' && 'is-active')}>
        <span className="time-label">Completed</span>
        <span className="time-value">{fmt(item.completedWork)}</span>
      </span>
      <span className={cx('time-row', active === 'remaining' && 'is-active')}>
        <span className="time-label">Remaining</span>
        <span className="time-value">{fmt(item.remainingWork)}</span>
      </span>
      <span className={cx('time-row', active === 'custom' && 'is-active')}>
        <span className="time-label">Custom</span>
        <span className="time-value">{custom !== undefined ? hours(custom) : '—'}</span>
      </span>
    </div>
  )
}

interface PersonProps {
  memberId: string
  layout: MemberLayout
}

function PersonPanel({ memberId, layout }: PersonProps): JSX.Element {
  const sprint = useSprint()
  const openNote = useApp((s) => s.openNote)
  const member = sprint.members.find((m) => m.id === memberId)
  const notes = sprint.notes.filter((note) => note.memberId === memberId)
  const free = layout.availableHours - layout.queuedHours

  const reducedDays = sprint.days
    .filter((day) => effectiveCapacity(sprint, memberId, day.date) < sprint.hoursPerDay)
    .map((day) => {
      const capacity = effectiveCapacity(sprint, memberId, day.date)
      const teamWide = day.capacity <= capacity
      return {
        date: day.date,
        capacity,
        text: `${formatDayHeader(day.date)} · ${capacity <= 0 ? 'off' : hours(capacity)}${
          teamWide ? ` (${day.label ?? 'team'})` : ''
        }`
      }
    })

  return (
    <>
      <p className="section-title">Capacity</p>
      <div className="stat-row">
        <span className="k">Scheduled from today</span>
        <span className="v">{hours(layout.queuedHours)}</span>
      </div>
      <div className="stat-row">
        <span className="k">Available in sprint</span>
        <span className="v">{hours(layout.availableHours)}</span>
      </div>
      <div className="stat-row">
        <span className="k">{layout.spillover > 0 ? 'Spillover' : 'Free'}</span>
        <span className={cx('v', layout.spillover > 0 && 'is-danger')}>
          {hours(layout.spillover > 0 ? layout.spillover : free)}
        </span>
      </div>

      {reducedDays.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: 16 }}>
            Days off and part days
          </p>
          <div>
            {reducedDays.map((day) => (
              <span key={day.date} className="day-off-pill">
                {day.text}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <p className="section-title" style={{ margin: 0, flex: 1 }}>
          Notes {notes.length > 0 && `· ${notes.length}`}
        </p>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: 12, padding: '2px 8px' }}
          onClick={() => openNote({ memberId })}
        >
          Add note
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="empty">No notes for {member?.name} yet.</p>
      ) : (
        notes.map((note) => <NoteCard key={note.id} note={note} />)
      )}
    </>
  )
}

/**
 * Everything known about one task, opened by clicking it on the calendar.
 *
 * The calendar can only show a work item's number and, when the block is wide enough, its
 * title. Everything else about it — where its hours come from, how it was split, who holds
 * which part, what has been reported against it — had no home until now.
 */
function TaskPanel({ workItemId }: { workItemId: number }): JSX.Element {
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

function NoteCard({ note }: { note: Note }): JSX.Element {
  const sprint = useSprint()
  const highlight = useApp((s) => s.highlightWorkItem)
  const openNote = useApp((s) => s.openNote)

  return (
    <div className="note">
      {note.category && <div className="note-category">{note.category}</div>}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="note-text" style={{ flex: 1 }}>
          {note.text}
        </div>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: 11, padding: '1px 6px' }}
          onClick={() => openNote({ noteId: note.id })}
          aria-label="Edit note"
        >
          Edit
        </button>
      </div>
      {note.taskIds.length > 0 && (
        <div className="note-tasks">
          {note.taskIds.map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              onMouseEnter={() => highlight(id)}
              onMouseLeave={() => highlight(null)}
              onClick={() => void window.api?.openExternal(sprint.workItems[id]?.url ?? '')}
              title={sprint.workItems[id]?.title}
            >
              #{id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
