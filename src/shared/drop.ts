import { findBlock, removeBlocks } from './blocks'
import { clamp, round } from './math'
import { pinBlockAt, pinReportedAt } from './mutations'
import {
  effectiveCapacity,
  landsInside,
  layoutSprint,
  occupantAt,
  type MemberLayout,
  type Occupant
} from './scheduling'
import type { ISODate, Sprint } from './types'

/**
 * What a drop on the calendar does.
 *
 * The drag preview and the drop itself both go through {@link applyDrop}, which is what makes
 * "it lands exactly where the preview showed it" structural rather than something to keep in
 * step by hand. Nothing here knows about the mouse or the DOM; `slotAt` turns a position into a
 * slot, and the renderer's drag hook does the rest.
 */

/** A slot on the calendar: whose row, which day, which hour. */
export interface DropTarget {
  memberId: string
  date: ISODate
  hour: number
}

/**
 * What to do about the task already in that slot. `auto` is the ordinary case — an empty
 * slot, or one whose first or last hour says plainly enough which side is meant.
 */
export type DropChoice = 'auto' | 'split' | 'after' | 'before'

/** What is being dropped: a block, or a work item's reported hours. */
export type DropSubject =
  { kind: 'block'; blockId: string; workItemId: number } | { kind: 'reported'; workItemId: number }

/** The board the drop happens on. */
export interface DropContext {
  layouts: Record<string, MemberLayout>
  /** The first day unpinned work flows from. */
  anchor: ISODate
  /** The real date: reported hours can go on it or before, never after. */
  today: ISODate
}

/**
 * Applies a drop, returning the sprint it would produce (or the same sprint when the drop is
 * refused or means nothing).
 *
 * A task with hours left lands on the hour it is dropped on and stays there: it is pinned to
 * that slot, and unpinned work flows around it. Reported hours are pinned where they were
 * really worked. {@link canDrop} says which slots each may go to.
 *
 * Only a drop inside another task needs more than the slot: see {@link DropChoice}.
 */
export function applyDrop(
  sprint: Sprint,
  subject: DropSubject,
  target: DropTarget,
  context: DropContext,
  choice: DropChoice = 'auto'
): Sprint {
  if (!canDrop(sprint, subject, target, context)) return sprint
  if (subject.kind === 'reported') {
    return pinReportedAt(sprint, subject.workItemId, target.memberId, target.date, target.hour)
  }
  const at = landingFor(sprint, subject.blockId, target, context, choice)
  return pinBlockAt(sprint, subject.blockId, target.memberId, at.date, at.hour)
}

/**
 * Whether `subject` may go on `target` at all. Never from a locked day ({@link canLift}), nor
 * onto one, a day the person is not working, or an hour past the end of their day. Otherwise,
 * work still to do goes on today or later — it cannot be planned into the past — and reported
 * hours on the days that have passed or on today, because that is when work can have been done.
 */
export function canDrop(
  sprint: Sprint,
  subject: DropSubject,
  target: DropTarget,
  context: Pick<DropContext, 'layouts' | 'anchor' | 'today'>
): boolean {
  if (!canLift(sprint, subject, context.layouts)) return false
  if (!context.layouts[target.memberId]) return false
  if (!sprint.days.some((day) => day.date === target.date)) return false
  if ((sprint.lockedDays ?? []).includes(target.date)) return false
  const capacity = effectiveCapacity(sprint, target.memberId, target.date)
  if (capacity <= 0 || target.hour < 0 || target.hour >= capacity) return false

  if (subject.kind === 'reported') {
    return target.date <= context.today && target.date <= context.anchor
  }
  return target.date >= context.anchor
}

/**
 * Whether what is being dragged may leave where it is. Nothing on a locked day moves — not
 * onto the calendar, not to the backlog — until the day is unlocked.
 */
export function canLift(
  sprint: Sprint,
  subject: DropSubject,
  layouts: Record<string, MemberLayout>
): boolean {
  const locked = new Set(sprint.lockedDays ?? [])
  if (locked.size === 0) return true
  return !Object.values(layouts).some((layout) =>
    layout.segments.some(
      (segment) =>
        locked.has(segment.date) &&
        (subject.kind === 'block'
          ? segment.blockId === subject.blockId && !segment.isDone
          : segment.isDone === true && segment.workItemId === subject.workItemId)
    )
  )
}

/**
 * Where a dropped task starts. The slot under the pointer, unless that is inside another task:
 *
 * - a pinned task holds its place, so the dropped one goes straight after it;
 * - an unpinned one's first hour means "before it" (the slot itself), its last hour "after it";
 * - anywhere else in it, `choice` says — `split` takes the slot and parts the task around it,
 *   `before`/`after` keep it whole and put the dropped one at its start or its end.
 *
 * Measured on the board without the task being dropped, so it is never in its own way: sliding
 * a task along its row, the slots it is leaving are free.
 */
function landingFor(
  sprint: Sprint,
  blockId: string,
  target: DropTarget,
  context: DropContext,
  choice: DropChoice
): { date: ISODate; hour: number } {
  const { board, layout } = boardWithout(sprint, blockId, target.memberId, context.anchor)
  const occupant = occupantAt(board, layout, target.memberId, target.date, target.hour)
  if (!occupant) return target

  const pinned = findBlock(board, occupant.blockId)?.block.pin !== undefined
  const lastHour = occupant.hours > 1 && occupant.offset >= occupant.hours - 1
  if (pinned || choice === 'after' || (choice === 'auto' && lastHour)) {
    return dayStartIfPast(sprint, target.memberId, edgeOf(layout, occupant.blockId, 'end'))
  }
  if (choice === 'before') return edgeOf(layout, occupant.blockId, 'start')
  return target
}

/**
 * The task a drop lands in the middle of, when there is a real question to ask about it:
 * split it around the new one, or keep it whole on one side. Never about a pinned task — the
 * dropped one simply goes after it — nor about reported hours or a drop that is refused.
 */
export function questionFor(
  sprint: Sprint,
  subject: DropSubject,
  target: DropTarget,
  context: Pick<DropContext, 'layouts' | 'anchor' | 'today'>
): Occupant | null {
  if (subject.kind === 'reported' || !canDrop(sprint, subject, target, context)) return null
  const { board, layout } = boardWithout(sprint, subject.blockId, target.memberId, context.anchor)
  const occupant = occupantAt(board, layout, target.memberId, target.date, target.hour)
  if (!occupant || !landsInside(occupant)) return null
  if (findBlock(board, occupant.blockId)?.block.pin !== undefined) return null
  return occupant
}

/** The board as it would be with `blockId` lifted off it, and that person's layout on it. */
function boardWithout(
  sprint: Sprint,
  blockId: string,
  memberId: string,
  anchor: ISODate
): { board: Sprint; layout: MemberLayout } {
  const board = removeBlocks(sprint, [blockId])
  return { board, layout: layoutSprint(board, anchor)[memberId] }
}

/**
 * A slot at or past the end of someone's day is the start of their next working day — so a
 * task "after" one that fills Thursday is pinned to Friday's first hour, not Thursday's ninth.
 */
function dayStartIfPast(
  sprint: Sprint,
  memberId: string,
  slot: { date: ISODate; hour: number }
): { date: ISODate; hour: number } {
  if (slot.hour < effectiveCapacity(sprint, memberId, slot.date)) return slot
  const next = sprint.days.find(
    (day) => day.date > slot.date && effectiveCapacity(sprint, memberId, day.date) > 0
  )
  return next ? { date: next.date, hour: 0 } : slot
}

/** Where a task on the calendar begins or ends, as a slot. */
function edgeOf(
  layout: MemberLayout,
  blockId: string,
  side: 'start' | 'end'
): { date: ISODate; hour: number } {
  const pieces = layout.segments
    .filter((segment) => segment.blockId === blockId && !segment.isDone && !segment.fromHistory)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
  const piece = side === 'start' ? pieces[0] : pieces[pieces.length - 1]
  return side === 'start'
    ? { date: piece.date, hour: piece.startHour }
    : { date: piece.date, hour: round(piece.startHour + piece.hours) }
}

/**
 * `hours` working hours before `slot` on that person's calendar, counting only the hours they
 * work — so picking a task up by its fourth hour and moving the pointer one cell moves the task
 * one hour, even when its start is on the day before. Stops at the sprint's first hour.
 */
export function shiftBack(sprint: Sprint, slot: DropTarget, hours: number): DropTarget {
  const capacityOn = (date: ISODate): number => effectiveCapacity(sprint, slot.memberId, date)
  let index = sprint.days.findIndex((day) => day.date === slot.date)
  if (index < 0 || hours <= 0) return slot
  let hour = Math.min(slot.hour, capacityOn(slot.date))
  let left = hours
  while (left > hour) {
    left = round(left - hour)
    let previous = index - 1
    while (previous >= 0 && capacityOn(sprint.days[previous].date) <= 0) previous--
    if (previous < 0) return { ...slot, date: sprint.days[index].date, hour: 0 }
    index = previous
    hour = capacityOn(sprint.days[index].date)
  }
  return { ...slot, date: sprint.days[index].date, hour: round(hour - left) }
}

/**
 * The day and hour under a point `x` pixels from the start of a person's row, with every hour
 * `hourWidth` pixels wide. Anything off either end lands on the first or last hour.
 */
export function slotAt(sprint: Sprint, memberId: string, x: number, hourWidth: number): DropTarget {
  const dayWidth = sprint.hoursPerDay * hourWidth
  const dayIndex = clamp(Math.floor(x / dayWidth), 0, sprint.days.length - 1)
  const hour = clamp(Math.floor((x - dayIndex * dayWidth) / hourWidth), 0, sprint.hoursPerDay - 1)
  return { memberId, date: sprint.days[dayIndex].date, hour }
}
