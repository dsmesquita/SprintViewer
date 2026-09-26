import { clamp, round } from '../math'
import type { Block, ISODate, Sprint } from '../types'
import type { MemberLayout } from './layout'

/**
 * Questions asked of a layout — where a drop lands, what it lands on — and small block helpers.
 */

/**
 * Where a block dropped on (`date`, `hour`) should land in the person's queue.
 *
 * Returns the index of the first block scheduled at or after that point, so dropping on
 * empty space at the end appends.
 */
export function insertionIndex(
  sprint: Sprint,
  layout: MemberLayout,
  memberId: string,
  date: ISODate,
  hour: number
): number {
  const queue = sprint.queues[memberId] ?? []
  const order = new Map(queue.map((b, i) => [b.id, i]))

  for (const segment of layout.segments) {
    // Pinned work does not move when something is inserted near it, and history is not part
    // of the queue at all, so neither can define an insertion point.
    if (segment.pinned || segment.fromHistory) continue
    if (segment.date < date) continue
    if (segment.date === date && segment.startHour + segment.hours <= hour) continue
    const index = order.get(segment.blockId)
    if (index !== undefined) return index
  }
  return queue.length
}

/** A block already sitting where something is about to be dropped. */
export interface Occupant {
  blockId: string
  workItemId: number
  /** Hours of the block that come before the dropped hour, counted across day boundaries. */
  offset: number
  /** The block's total hours. */
  hours: number
  /** Its position in the person's queue. */
  index: number
}

/**
 * The block occupying (`date`, `hour`) on this person's calendar, and how far into it the
 * drop lands.
 *
 * The offset is measured across the whole block, not the piece of it visible on that day, so
 * a task cut over a day boundary answers "the fifth of its eight hours" rather than "the
 * first of the three that spilled over".
 *
 * History and reported hours are records rather than blocks — nothing can be inserted into
 * them — so they never count as an occupant.
 */
export function occupantAt(
  sprint: Sprint,
  layout: MemberLayout,
  memberId: string,
  date: ISODate,
  hour: number
): Occupant | null {
  const hit = layout.segments.find(
    (segment) =>
      !segment.fromHistory &&
      !segment.isDone &&
      segment.date === date &&
      hour >= segment.startHour &&
      hour < segment.startHour + segment.hours
  )
  if (!hit) return null

  const queue = sprint.queues[memberId] ?? []
  const index = queue.findIndex((block) => block.id === hit.blockId)
  if (index < 0) return null

  const earlier = layout.segments
    .filter(
      (segment) =>
        segment.blockId === hit.blockId &&
        (segment.date < hit.date ||
          (segment.date === hit.date && segment.startHour < hit.startHour))
    )
    .reduce((sum, segment) => sum + segment.hours, 0)

  return {
    blockId: hit.blockId,
    workItemId: hit.workItemId,
    offset: round(earlier + (hour - hit.startHour)),
    hours: queue[index].hours,
    index
  }
}

/**
 * True when a drop at this offset lands strictly inside a task — neither its first hour, which
 * plainly means "before this", nor its last, which plainly means "after it". Only then is
 * there a real question to ask.
 */
export function landsInside(occupant: Occupant): boolean {
  return occupant.offset > 0 && occupant.offset < occupant.hours - 1
}

/**
 * The anchor day: the first working day of the sprint at or after today.
 *
 * Snapping forward matters because weekends are not columns — on a Saturday the anchor
 * becomes the following Monday rather than a date that is nowhere in the grid.
 */
export function anchorFor(sprint: Sprint, today: ISODate): ISODate {
  if (sprint.days.length === 0) return today
  const next = sprint.days.find((day) => day.date >= today)
  return next ? next.date : sprint.days[sprint.days.length - 1].date
}

/** Split a block into a kept part of `hours` and a remainder, preserving the work item. */
export function splitBlock(block: Block, hours: number, newId: () => string): [Block, Block] {
  const kept = clamp(hours, 0, block.hours)
  return [
    { ...block, hours: round(kept) },
    { id: newId(), workItemId: block.workItemId, hours: round(block.hours - kept) }
  ]
}

/** Hours of a work item currently placed on the calendar, across all people and splits. */
export function placedHours(sprint: Sprint, workItemId: number): number {
  let total = 0
  for (const queue of Object.values(sprint.queues)) {
    for (const block of queue) if (block.workItemId === workItemId) total += block.hours
  }
  return round(total)
}
