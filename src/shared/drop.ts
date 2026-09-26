import { clamp } from './math'
import { moveBlock, pinBlockAt, pinReportedAt, splitInPlace, type Location } from './mutations'
import {
  insertionIndex,
  landsInside,
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
  /** The real date: a drop on it or before is a record of what happened, so it pins. */
  today: ISODate
  newId: () => string
}

/**
 * Applies a drop, returning the sprint it would produce (or the same sprint when the drop
 * means nothing).
 *
 * Dropping on a day that has already happened is a statement about what was worked, so the
 * block holds that exact slot. Dropping ahead of today is a plan, so it joins the queue and
 * flows with everything else.
 */
export function applyDrop(
  sprint: Sprint,
  subject: DropSubject,
  target: DropTarget,
  context: DropContext,
  choice: DropChoice = 'auto'
): Sprint {
  if ((sprint.lockedDays ?? []).includes(target.date)) return sprint

  // Reported hours are drawn only on the days that have passed, so a drop on the anchor or
  // later has nothing to mean. Nothing changes rather than the hours quietly staying put
  // somewhere else, which would look like the drag had been misread.
  if (subject.kind === 'reported') {
    if (target.date >= context.anchor) return sprint
    return pinReportedAt(sprint, subject.workItemId, target.memberId, target.date, target.hour)
  }

  const blockId = subject.blockId
  if (target.date <= context.today) {
    // A pin claims its exact hour and whatever is unpinned flows around it, which already
    // parts a task in two where the pin lands. There is nothing to ask.
    return pinBlockAt(sprint, blockId, target.memberId, target.date, target.hour)
  }
  const layout = context.layouts[target.memberId]
  if (!layout) return sprint
  const to: Location = { kind: 'member', memberId: target.memberId }
  const occupant = occupantAt(sprint, layout, target.memberId, target.date, target.hour)

  if (occupant && occupant.blockId !== blockId && choice !== 'auto') {
    if (choice === 'split') {
      const parted = splitInPlace(sprint, occupant.blockId, occupant.offset, context.newId)
      return moveBlock(parted, blockId, to, occupant.index + 1)
    }
    return moveBlock(sprint, blockId, to, occupant.index + (choice === 'after' ? 1 : 0))
  }

  const index = insertionIndex(sprint, layout, target.memberId, target.date, target.hour)
  return moveBlock(sprint, blockId, to, index)
}

/**
 * The task a drop lands in the middle of, when there is a real question to ask about it:
 * split it around the new one, or keep it whole on one side.
 */
export function questionFor(
  sprint: Sprint,
  subject: DropSubject,
  target: DropTarget,
  context: Pick<DropContext, 'layouts' | 'today'>
): Occupant | null {
  // Reported hours never join a queue, and a drop on a past day pins: nothing to ask.
  if (subject.kind === 'reported' || target.date <= context.today) return null
  const layout = context.layouts[target.memberId]
  if (!layout) return null
  const occupant = occupantAt(sprint, layout, target.memberId, target.date, target.hour)
  if (!occupant || occupant.blockId === subject.blockId || !landsInside(occupant)) return null
  return occupant
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
