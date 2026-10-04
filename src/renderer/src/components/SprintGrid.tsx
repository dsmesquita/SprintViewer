import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties
} from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { formatDayHeader } from '@shared/dates'
import { effectiveCapacity, type MemberLayout } from '@shared/scheduling'
import type { ISODate, Member, Segment, Sprint } from '@shared/types'
import { cx, hours, toneFor } from '../format'
import { DRAG_ID_PREFIX, MEMBER_DROP_PREFIX, zoomPercent, type DragData } from '../grid'
import { FullScreenIcon, LockIcon, NoteIcon, WarningIcon } from '../icons'
import CalendarKey from './CalendarKey'
import { useApp, useSprint } from '../store'

interface Props {
  layouts: Record<string, MemberLayout>
  /** The block being dragged, while a drop is being previewed. */
  previewBlockId?: string
  /** Work items to call out, e.g. those that changed since a snapshot. */
  highlightWorkItems?: Set<number>
  /** Blocks with something wrong about where they sit, and what. */
  warnings?: Map<string, string>
  /** No dragging, no menus: a record being looked at rather than a plan being made. */
  readOnly?: boolean
  /** The day scheduling resumes from. Everything before it is history. */
  anchor: ISODate
  onDayContextMenu: (date: ISODate, event: React.MouseEvent, memberId?: string) => void
  onBlockContextMenu: (blockId: string, event: React.MouseEvent, label: string) => void
  onReportedContextMenu?: (workItemId: number, event: React.MouseEvent, label: string) => void
  onMemberContextMenu: (memberId: string, event: React.MouseEvent) => void
  onSelectTask?: (workItemId: number, blockId: string) => void
  onLockDay?: (date: ISODate) => void
  onUnlockDay?: (date: ISODate) => void
}

export default function SprintGrid({
  layouts,
  previewBlockId,
  highlightWorkItems,
  warnings,
  readOnly,
  anchor,
  onDayContextMenu,
  onBlockContextMenu,
  onReportedContextMenu,
  onMemberContextMenu,
  onSelectTask,
  onLockDay,
  onUnlockDay
}: Props): JSX.Element {
  const sprint = useSprint()
  const today = useApp((s) => s.today)
  const fullScreen = useApp((s) => s.fullScreen)
  const setFullScreen = useApp((s) => s.setFullScreen)
  const selectedMemberId = useApp((s) => s.selectedMemberId)
  const selectedBlockId = useApp((s) => s.selectedBlockId)
  const selectMember = useApp((s) => s.selectMember)
  const pickedMembers = useApp((s) => s.pickedMembers)
  const pickMember = useApp((s) => s.pickMember)
  // Ctrl+click (or Ctrl+Alt+click) picks several people, Shift+click a run of them; a plain
  // click opens one person's panel, as it always has.
  const onName = useCallback(
    (memberId: string, event: React.MouseEvent): void => {
      if (event.ctrlKey || event.metaKey) pickMember(memberId, 'toggle')
      else if (event.shiftKey) pickMember(memberId, 'range')
      else {
        pickMember(memberId, 'only')
        selectMember(memberId)
      }
    },
    [pickMember, selectMember]
  )
  const highlighted = useApp((s) => s.highlightedWorkItemId)
  const hourWidth = useApp((s) => s.hourWidth)
  const zoomBy = useApp((s) => s.zoomBy)

  // Stable identities, so the memoised rows below are not re-rendered by a fresh Set and Map
  // on every hop of a drag — which would leave them memoised in name only.
  const lockedDays = useMemo(() => new Set(sprint.lockedDays ?? []), [sprint.lockedDays])
  const dayIndex = useMemo(
    () => new Map(sprint.days.map((day, index) => [day.date, index])),
    [sprint.days]
  )

  const dayWidth = sprint.hoursPerDay * hourWidth
  const trackWidth = sprint.days.length * dayWidth
  const anchorIndex = dayIndex.get(anchor)
  const anchorLabel = anchor === today ? 'Today' : `Scheduling resumes ${formatDayHeader(anchor)}`
  const members = [...sprint.members].sort((a, b) => a.order - b.order)
  // Below this the hour numbers no longer fit in a column, and the header row is noise.
  const showHourNumbers = hourWidth >= 20

  const scrollRef = useRef<HTMLDivElement>(null)
  const cornerRef = useRef<HTMLDivElement>(null)
  // Where the scroller should sit once the new width has been laid out, so the hour under the
  // cursor is still under the cursor afterwards. Zooming about the left edge instead throws the
  // day you were looking at off the screen at the wider stops.
  const keepScrollAt = useRef<number | null>(null)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element && keepScrollAt.current !== null) element.scrollLeft = keepScrollAt.current
    keepScrollAt.current = null
  }, [hourWidth])

  /*
   * Ctrl+wheel zooms; a plain wheel keeps scrolling the calendar. Registered by hand rather
   * than through React's `onWheel`, which attaches passively at the root and so cannot call
   * `preventDefault` — without which the browser applies its own page zoom as well.
   */
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      const nameWidth = cornerRef.current?.offsetWidth ?? 0
      const pointerInTrack =
        event.clientX - element.getBoundingClientRect().left + element.scrollLeft - nameWidth
      const before = useApp.getState().hourWidth
      zoomBy(event.deltaY < 0 ? 1 : -1)
      const after = useApp.getState().hourWidth
      if (after !== before && pointerInTrack > 0) {
        keepScrollAt.current = Math.max(
          0,
          element.scrollLeft + pointerInTrack * (after / before - 1)
        )
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  return (
    <div className="cal-scroll" ref={scrollRef}>
      <div className="cal" style={{ '--hour-w': `${hourWidth}px` } as CSSProperties}>
        <div className="cal-head">
          <div className="cal-head-row">
            <div className="corner" ref={cornerRef}>
              {!readOnly && (
                <div className="corner-zoom">
                  <span className="zoom-value">{zoomPercent(hourWidth)}%</span>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => zoomBy(-1)}
                    title="Zoom out — Ctrl+scroll over the calendar"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => zoomBy(1)}
                    title="Zoom in — Ctrl+scroll over the calendar"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <button type="button" className="zoom-reset" onClick={() => zoomBy(null)}>
                    Reset
                  </button>
                  <CalendarKey />
                  <button
                    type="button"
                    className="ghost full-screen-button"
                    onClick={() => setFullScreen(!fullScreen)}
                    title={fullScreen ? 'Leave full screen (Esc or F11)' : 'Full screen (F11)'}
                    aria-label={fullScreen ? 'Leave full screen' : 'Full screen'}
                    aria-pressed={fullScreen}
                  >
                    <FullScreenIcon on={fullScreen} size={14} />
                  </button>
                </div>
              )}
            </div>
            {sprint.days.map((day) => {
              const isLocked = lockedDays.has(day.date)
              return (
                <div
                  key={day.date}
                  className={cx(
                    'day-head',
                    day.capacity <= 0 && 'is-off',
                    day.date === anchor && 'is-today',
                    isLocked && 'is-locked'
                  )}
                  style={{ width: dayWidth }}
                  onContextMenu={(event) => onDayContextMenu(day.date, event)}
                >
                  <div className="day-name">{formatDayHeader(day.date)}</div>
                  <div className="day-label">
                    {day.label ??
                      (day.capacity < sprint.hoursPerDay
                        ? `${hours(day.capacity)} available`
                        : ' ')}
                  </div>
                  {!readOnly && (onLockDay || onUnlockDay) && (
                    <button
                      type="button"
                      className={cx('day-lock', isLocked && 'is-locked')}
                      title={isLocked ? 'Unlock day' : 'Lock day — prevent new drops'}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (isLocked) onUnlockDay?.(day.date)
                        else onLockDay?.(day.date)
                      }}
                    >
                      <LockIcon locked={isLocked} size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {showHourNumbers && (
            <div className="cal-head-row">
              <div className="corner" />
              {sprint.days.map((day) => (
                <div key={day.date} className="hour-cells" style={{ width: dayWidth }}>
                  {Array.from({ length: sprint.hoursPerDay }, (_, hour) => (
                    <div key={hour} className={cx('hour-cell', hour === 0 && 'is-day-start')}>
                      {hour + 1}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cal-body">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              sprint={sprint}
              member={member}
              layout={layouts[member.id]}
              previewBlockId={previewBlockId}
              highlightWorkItems={highlightWorkItems}
              warnings={warnings}
              readOnly={readOnly}
              hourWidth={hourWidth}
              dayWidth={dayWidth}
              trackWidth={trackWidth}
              dayIndex={dayIndex}
              anchorIndex={anchorIndex}
              anchorLabel={anchorLabel}
              isSelected={selectedMemberId === member.id || pickedMembers.includes(member.id)}
              onSelect={onName}
              highlighted={highlighted}
              selectedBlockId={selectedBlockId}
              lockedDays={lockedDays}
              onDayContextMenu={onDayContextMenu}
              onBlockContextMenu={onBlockContextMenu}
              onReportedContextMenu={onReportedContextMenu}
              onMemberContextMenu={onMemberContextMenu}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  sprint: Sprint
  member: Member
  layout: MemberLayout
  previewBlockId?: string
  highlightWorkItems?: Set<number>
  warnings?: Map<string, string>
  readOnly?: boolean
  hourWidth: number
  dayWidth: number
  trackWidth: number
  dayIndex: Map<string, number>
  anchorIndex: number | undefined
  anchorLabel: string
  isSelected: boolean
  onSelect: (memberId: string, event: React.MouseEvent) => void
  highlighted: number | null
  selectedBlockId: string | null
  lockedDays: Set<string>
  onDayContextMenu: (date: ISODate, event: React.MouseEvent, memberId?: string) => void
  onBlockContextMenu: (blockId: string, event: React.MouseEvent, label: string) => void
  onReportedContextMenu?: (workItemId: number, event: React.MouseEvent, label: string) => void
  onMemberContextMenu: (memberId: string, event: React.MouseEvent) => void
  onSelectTask?: (workItemId: number, blockId: string) => void
}

/*
 * Memoised, and taking the sprint as a prop rather than reading it from the store, because a
 * drag re-renders this tree on every hour the cursor crosses. Subscribing each row — and each
 * block inside it — to the whole store meant every one of them re-rendered on every hop, which
 * is what made the preview stutter on a full board.
 */
const MemberRow = memo(function MemberRow({
  sprint,
  member,
  layout,
  previewBlockId,
  highlightWorkItems,
  warnings,
  readOnly,
  hourWidth,
  dayWidth,
  trackWidth,
  dayIndex,
  anchorIndex,
  anchorLabel,
  isSelected,
  onSelect,
  highlighted,
  selectedBlockId,
  lockedDays,
  onDayContextMenu,
  onBlockContextMenu,
  onReportedContextMenu,
  onMemberContextMenu,
  onSelectTask
}: RowProps): JSX.Element {
  const noteCount = sprint.notes.filter((note) => note.memberId === member.id).length
  const free = layout.availableHours - layout.queuedHours
  const { setNodeRef, isOver } = useDroppable({ id: `${MEMBER_DROP_PREFIX}${member.id}` })

  /*
   * Which piece of its block each segment is, in calendar order. The draggable id is built
   * from this rather than from the segment's day and hour, which change under the cursor as
   * soon as the drop preview moves the block: dnd-kit would then unregister and re-register
   * the very draggable being dragged, on every hop.
   */
  const pieceIndex = new Map<Segment, number>()
  // And how many of the block's hours come before each piece, so a drag keeps hold of the
  // block where it was picked up rather than moving its start to the pointer.
  const hoursBefore = new Map<Segment, number>()
  const seen = new Map<string, number>()
  const counted = new Map<string, number>()
  for (const segment of [...layout.segments].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour
  )) {
    const count = seen.get(segment.blockId) ?? 0
    seen.set(segment.blockId, count + 1)
    pieceIndex.set(segment, count)
    const before = counted.get(segment.blockId) ?? 0
    hoursBefore.set(segment, before)
    counted.set(segment.blockId, before + segment.hours)
  }

  return (
    <div className="cal-row">
      <button
        type="button"
        className={cx('row-name', isSelected && 'is-selected')}
        onClick={(event) => onSelect(member.id, event)}
        onContextMenu={(event) => onMemberContextMenu(member.id, event)}
        title={`Open ${member.name}'s panel — right-click to add a note or export the calendar`}
      >
        <span className="who">{member.name}</span>
        {layout.spillover > 0 && (
          <span className="warn" title={`Spillover: ${hours(layout.spillover)}`}>
            <WarningIcon size={14} title={`Spillover: ${hours(layout.spillover)}`} />
          </span>
        )}
        {noteCount > 0 && (
          <span className="note-dot" title={`${noteCount} note${noteCount > 1 ? 's' : ''}`}>
            <NoteIcon size={13} />
          </span>
        )}
        <span className="free">{layout.spillover > 0 ? '' : `${hours(free)} free`}</span>
      </button>

      <div
        ref={setNodeRef}
        className={cx('row-track', isOver && 'is-over')}
        data-member={member.id}
        style={{ width: trackWidth }}
        onContextMenu={(event) => {
          const x = event.clientX - event.currentTarget.getBoundingClientRect().left
          const day = sprint.days[Math.floor(x / dayWidth)]
          if (day) onDayContextMenu(day.date, event, member.id)
        }}
      >
        {/*
          The hour columns are real elements here, exactly as in the header above. They used
          to be a repeating gradient, which is a second, independent rounding of the same
          34px step across 2720px — the two disagreed further and further to the right, which
          is why the borders looked wrong only after scrolling.
        */}
        {sprint.days.map((day, index) => (
          <div
            key={day.date}
            className="day-block"
            style={{ left: index * dayWidth, width: dayWidth }}
          >
            {Array.from({ length: sprint.hoursPerDay }, (_, hour) => (
              <div key={hour} className={cx('hour-slot', hour === 0 && 'is-day-start')} />
            ))}
          </div>
        ))}

        {sprint.days.map((day, index) => {
          const capacity = effectiveCapacity(sprint, member.id, day.date)
          if (capacity >= sprint.hoursPerDay) return null
          const reason =
            day.capacity <= capacity
              ? (day.label ?? 'Non-working day')
              : `${member.name}: ${capacity <= 0 ? 'day off' : `${hours(capacity)} available`}`
          return (
            <div
              key={day.date}
              className="off-hours"
              title={reason}
              style={{
                left: index * dayWidth + capacity * hourWidth,
                width: (sprint.hoursPerDay - capacity) * hourWidth
              }}
            />
          )
        })}

        {anchorIndex !== undefined && (
          <div
            className="today-marker"
            style={{ left: anchorIndex * dayWidth }}
            title={anchorLabel}
          />
        )}

        {layout.segments.map((segment) => {
          const index = dayIndex.get(segment.date)
          if (index === undefined) return null
          return (
            <SegmentBlock
              // A block can now be cut more than once within a single day, when a pin sits
              // in the middle of it, so the day alone no longer makes the key unique.
              key={`${segment.blockId}-${segment.date}-${segment.startHour}`}
              segment={segment}
              title={sprint.workItems[segment.workItemId]?.title ?? ''}
              dragId={`${DRAG_ID_PREFIX}${segment.blockId}:${pieceIndex.get(segment) ?? 0}`}
              hoursBefore={hoursBefore.get(segment) ?? 0}
              left={(index * sprint.hoursPerDay + segment.startHour) * hourWidth + 1}
              width={segment.hours * hourWidth - 2}
              isHighlighted={highlighted === segment.workItemId}
              // The block, not the work item: it is the block that Shift + ←/→ moves, and a
              // split task outlining every piece would not say which one that is.
              isSelected={selectedBlockId === segment.blockId}
              isPreview={segment.blockId === previewBlockId}
              isChanged={highlightWorkItems?.has(segment.workItemId) === true}
              isReportedPinned={sprint.reportedPins?.[segment.workItemId] !== undefined}
              // On the first piece only: one marker per task is a warning, one per day is noise.
              warning={segment.continued ? undefined : warnings?.get(segment.blockId)}
              readOnly={readOnly === true}
              isLocked={lockedDays.has(segment.date)}
              onBlockContextMenu={onBlockContextMenu}
              onReportedContextMenu={onReportedContextMenu}
              onSelectTask={onSelectTask}
            />
          )
        })}
      </div>
    </div>
  )
})

interface SegmentProps {
  segment: Segment
  title: string
  dragId: string
  /** The block's hours drawn before this piece of it. */
  hoursBefore: number
  left: number
  width: number
  isHighlighted: boolean
  isSelected: boolean
  isPreview: boolean
  isChanged: boolean
  isReportedPinned: boolean
  warning?: string
  readOnly: boolean
  isLocked: boolean
  onBlockContextMenu: (blockId: string, event: React.MouseEvent, label: string) => void
  onReportedContextMenu?: (workItemId: number, event: React.MouseEvent, label: string) => void
  onSelectTask?: (workItemId: number, blockId: string) => void
}

/** How far the pointer may travel and still count as a click rather than the start of a drag. */
const CLICK_SLOP = 4

const SegmentBlock = memo(
  function SegmentBlock({
    segment,
    title,
    dragId,
    hoursBefore,
    left,
    width,
    isHighlighted,
    isSelected,
    isPreview,
    isChanged,
    isReportedPinned,
    warning,
    readOnly: locked,
    isLocked,
    onBlockContextMenu,
    onReportedContextMenu,
    onSelectTask
  }: SegmentProps): JSX.Element {
    // Hours reported in TFS are drawn from a field rather than from a block, so there is no
    // block to move — but *when* they were worked is still the user's to say, and dragging the
    // ribbon is how they say it. History segments (auto-layout past positions) ARE real blocks
    // and can be repositioned; pinned past blocks were placed by hand and always could be.
    const isReported = segment.isDone === true
    const isPast = segment.fromHistory === true
    const data: DragData = isReported
      ? { kind: 'reported', workItemId: segment.workItemId, hours: segment.hours, hoursBefore }
      : {
          kind: 'block',
          blockId: segment.blockId,
          workItemId: segment.workItemId,
          hours: segment.hours,
          hoursBefore
        }
    // Locked-day segments can still be dragged OUT of that day (to unpin them), but drops
    // onto locked days are blocked in App.tsx's applyDrop. The visual lock indicator is enough.
    const { attributes, listeners, setNodeRef } = useDraggable({
      id: dragId,
      data,
      disabled: locked
    })

    // Where the pointer went down, so releasing it without a drag having started counts as a
    // click on the task. `isDragging` cannot answer this — it is already false by the time the
    // click event lands, so every drop would also open the panel.
    const pressedAt = useRef<{ x: number; y: number } | null>(null)

    const label = `#${segment.workItemId} ${title}`

    return (
      <div
        ref={setNodeRef}
        {...(locked ? {} : listeners)}
        {...attributes}
        className={cx(
          'seg',
          toneFor(segment.workItemId),
          isPast && 'is-past',
          segment.isDone && 'is-done',
          (segment.pinned || (isReported && isReportedPinned)) && 'is-pinned',
          segment.continued && 'is-continued',
          segment.continues && 'is-continues',
          isHighlighted && 'is-highlighted',
          isSelected && 'is-selected',
          isPreview && 'is-preview',
          isChanged && 'is-changed',
          isLocked && 'is-day-locked',
          warning !== undefined && 'has-warning',
          !locked && 'is-draggable'
        )}
        style={{ left, width }}
        title={`${warning ? `⚠ ${warning}\n` : ''}${label} — ${hours(segment.hours)}${
          segment.continues ? ' (continues next day)' : ''
        }${segment.pinned ? '\nPinned to this slot' : ''}${isLocked ? '\nDay is locked' : ''}${
          isReported
            ? `\nReported in TFS as done${
                segment.doneOverflow
                  ? `\n${hours(segment.doneOverflow)} more was reported than fits before the sprint`
                  : ''
              }\n${
                isReportedPinned
                  ? 'Placed by hand · drag to move, right-click to reset'
                  : 'Drag to say when it was worked'
              }`
            : segment.fromHistory
              ? '\nFrom an earlier refresh · drag to move'
              : '\nDrag to move, right-click to split'
        }`}
        // Declared after `{...listeners}`, so it replaces dnd-kit's own `onPointerDown` — the
        // handler that starts a drag. It has to be called from here, or no block on the calendar
        // can be dragged at all.
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY }
          if (!locked) listeners?.onPointerDown?.(event)
        }}
        onClick={(event) => {
          const start = pressedAt.current
          pressedAt.current = null
          if (!onSelectTask || !start) return
          const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
          if (moved < CLICK_SLOP) onSelectTask(segment.workItemId, segment.blockId)
        }}
        onContextMenu={(event) => {
          if (locked) return
          event.stopPropagation()
          if (isReported) onReportedContextMenu?.(segment.workItemId, event, label)
          else onBlockContextMenu(segment.blockId, event, label)
        }}
      >
        {(segment.pinned || (isReported && isReportedPinned)) && !segment.continued && (
          <span className="pin-dot" aria-hidden="true" />
        )}
        {warning && (
          <span className="seg-warn" aria-label={warning}>
            <WarningIcon size={11} />
          </span>
        )}
        <span className="seg-id">#{segment.workItemId}</span>
        {width > 92 && <span className="seg-title">{title}</span>}
      </div>
    )
  },
  /*
   * Compared by value, not by identity. Every hop of a drag re-flows the whole sprint, and the
   * layout hands back a fresh `Segment` object for every block — including the hundred that did
   * not move. The default shallow comparison sees a new object each time and re-renders them all,
   * which is precisely the work this component was memoised to avoid.
   */
  function samePlacement(before: SegmentProps, after: SegmentProps): boolean {
    const a = before.segment
    const b = after.segment
    return (
      a.blockId === b.blockId &&
      a.workItemId === b.workItemId &&
      a.date === b.date &&
      a.startHour === b.startHour &&
      a.hours === b.hours &&
      a.continued === b.continued &&
      a.continues === b.continues &&
      a.pinned === b.pinned &&
      a.fromHistory === b.fromHistory &&
      a.isDone === b.isDone &&
      a.doneOverflow === b.doneOverflow &&
      before.title === after.title &&
      before.dragId === after.dragId &&
      before.left === after.left &&
      before.width === after.width &&
      before.isHighlighted === after.isHighlighted &&
      before.isSelected === after.isSelected &&
      before.isPreview === after.isPreview &&
      before.isChanged === after.isChanged &&
      before.isReportedPinned === after.isReportedPinned &&
      before.warning === after.warning &&
      before.readOnly === after.readOnly &&
      before.isLocked === after.isLocked &&
      before.onBlockContextMenu === after.onBlockContextMenu &&
      before.onReportedContextMenu === after.onReportedContextMenu &&
      before.onSelectTask === after.onSelectTask
    )
  }
)
