import { findBlock, pinBlockAt, pinReportedAt } from './mutations'
import { effectiveCapacity, layoutSprint } from './scheduling'
import type { ISODate, Segment, Sprint } from './types'
import { round } from './math'

/**
 * Moving the selected task one step with Shift + ← / →.
 *
 * One step is one *working* hour: evenings, days off, part-days and locked days are skipped,
 * so a task at the end of Friday steps onto Monday morning rather than into time nobody has —
 * or, with Monday locked, onto Tuesday. What is in that hour decides what happens:
 *
 *  - nothing: the task moves one hour and is pinned there — a gap is something only a pin can
 *    hold, since the queue flows everything else together;
 *  - another task: the two change places;
 *  - a record of the past, or the edge of the sprint: nothing happens.
 *
 * The same rules as a drop (`drop.ts`): work still to do never goes before today, reported hours
 * never after it, and nothing on a locked day moves at all.
 */

export type Direction = -1 | 1

interface Point {
  date: ISODate
  hour: number
}

/** Guards the "just before this point" probe against landing exactly on a boundary. */
const EPSILON = 1e-6

export function nudgeBlock(
  sprint: Sprint,
  blockId: string,
  direction: Direction,
  anchor: ISODate
): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found || found.location.kind !== 'member') return sprint
  const memberId = found.location.memberId

  const layout = layoutSprint(sprint, anchor)[memberId]
  const own = inOrder(
    layout.segments.filter((s) => s.blockId === blockId && !s.fromHistory && !s.isDone)
  )
  if (own.length === 0) return sprint

  const start: Point = { date: own[0].date, hour: own[0].startHour }
  const last = own[own.length - 1]
  const end: Point = { date: last.date, hour: last.startHour + last.hours }
  if (onLockedDay(sprint, own)) return sprint

  const probe = probePoint(sprint, memberId, direction === 1 ? end : start, direction)
  if (!probe) return sprint

  const neighbour = layout.segments.find(
    (s) => s.blockId !== blockId && s.date === probe.date && covers(s, probe.hour)
  )

  if (!neighbour) {
    const target = stepWorking(sprint, memberId, start, direction)
    // Work still to do cannot be planned into the past.
    if (!target || target.date < anchor) return sprint
    return pinBlockAt(sprint, blockId, memberId, target.date, target.hour)
  }

  // Records say what happened; they are not something a plan can trade places with.
  if (neighbour.fromHistory || neighbour.isDone) return sprint
  return swap(sprint, memberId, layout.segments, blockId, neighbour.blockId, direction, anchor)
}

/**
 * The same step for the ribbon of hours TFS reports against a work item.
 *
 * Those hours happened, so they only ever move through free time before the anchor and never
 * trade places with anything — the other things back there are records too.
 */
export function nudgeReported(
  sprint: Sprint,
  workItemId: number,
  direction: Direction,
  anchor: ISODate,
  /** The real date: reported hours may step onto the anchor day only when it is today. */
  today: ISODate = anchor
): Sprint {
  const layouts = layoutSprint(sprint, anchor)
  const owner = Object.entries(layouts).find(([, l]) =>
    l.segments.some((s) => s.isDone && s.workItemId === workItemId)
  )
  if (!owner) return sprint
  const [memberId, layout] = owner

  const own = inOrder(layout.segments.filter((s) => s.isDone && s.workItemId === workItemId))
  const start: Point = { date: own[0].date, hour: own[0].startHour }
  const last = own[own.length - 1]
  const end: Point = { date: last.date, hour: last.startHour + last.hours }
  if (onLockedDay(sprint, own)) return sprint

  // The last day they may go on is the anchor day when it is today, else the day before it.
  // On today they are drawn from its start, so from there there is nowhere further right.
  const onToday = anchor <= today
  if (direction === 1 && start.date >= anchor) return sprint
  const allowed = (date: ISODate): boolean => date < anchor || (date === anchor && onToday)

  const probe = probePoint(sprint, memberId, direction === 1 ? end : start, direction)
  if (!probe || !allowed(probe.date)) return sprint
  // Only the ribbon itself is excluded — a block of the same work item pinned back there is
  // still something the hours cannot slide over. Today's plan is not in the way: reported hours
  // on today go before it.
  const taken = layout.segments.some(
    (s) =>
      !(s.isDone && s.workItemId === workItemId) &&
      !(s.date >= anchor && !s.isDone) &&
      s.date === probe.date &&
      covers(s, probe.hour)
  )
  if (taken) return sprint

  const target = stepWorking(sprint, memberId, start, direction)
  if (!target || !allowed(target.date)) return sprint
  return pinReportedAt(sprint, workItemId, memberId, target.date, target.hour)
}

/**
 * Trades the places of two blocks.
 *
 * Two flowing blocks simply swap in the queue and the layout does the rest. Where either is
 * pinned the queue order says nothing about position, so both are pinned: the one that was
 * second starts where the first did, and the other follows it.
 */
function swap(
  sprint: Sprint,
  memberId: string,
  segments: Segment[],
  moving: string,
  other: string,
  direction: Direction,
  anchor: ISODate
): Sprint {
  const queue = sprint.queues[memberId] ?? []
  const a = queue.findIndex((b) => b.id === moving)
  const b = queue.findIndex((b) => b.id === other)
  if (a < 0 || b < 0) return sprint

  if (!queue[a].pin && !queue[b].pin) {
    const next = [...queue]
    ;[next[a], next[b]] = [next[b], next[a]]
    return { ...sprint, queues: { ...sprint.queues, [memberId]: next } }
  }

  // Whichever of the two comes first on the calendar, and the one right after it.
  const [firstId, secondId] = direction === 1 ? [moving, other] : [other, moving]
  const pairStart = startOf(segments, firstId)
  const second = queue.find((block) => block.id === secondId)
  if (!pairStart || !second) return sprint

  // The second one takes the pair's start; the first follows once it is done, measured in the
  // hours the second actually takes rather than the hours of whatever used to be there.
  const follows = stepWorking(sprint, memberId, pairStart, 1, second.hours)
  if (!follows) return sprint
  // The moving task may not end up before today, any more than by a plain step.
  const movedTo = secondId === moving ? pairStart : follows
  if (movedTo.date < anchor) return sprint
  const moved = pinBlockAt(sprint, secondId, memberId, pairStart.date, pairStart.hour)
  return pinBlockAt(moved, firstId, memberId, follows.date, follows.hour)
}

function startOf(segments: Segment[], blockId: string): Point | null {
  const mine = inOrder(segments.filter((s) => s.blockId === blockId && !s.fromHistory))
  return mine.length === 0 ? null : { date: mine[0].date, hour: mine[0].startHour }
}

/**
 * The instant just past `edge` in the given direction, in working time: the first working
 * moment after an end, or the last one before a start. `null` past either end of the sprint.
 */
function probePoint(
  sprint: Sprint,
  memberId: string,
  edge: Point,
  direction: Direction
): Point | null {
  const days = sprint.days
  let index = days.findIndex((day) => day.date === edge.date)
  if (index < 0) return null

  if (direction === 1) {
    let hour = edge.hour
    while (index < days.length) {
      if (hour < capacity(sprint, memberId, index) - EPSILON)
        return { date: days[index].date, hour }
      index++
      hour = 0
    }
    return null
  }

  let hour = edge.hour - EPSILON
  while (index >= 0) {
    if (hour >= 0) return { date: days[index].date, hour }
    index--
    if (index >= 0) hour = capacity(sprint, memberId, index) - EPSILON
  }
  return null
}

/**
 * `from` moved by `hours` of working time. Time the person does not have — beyond a day's
 * capacity, or a whole day off — is skipped rather than counted.
 */
function stepWorking(
  sprint: Sprint,
  memberId: string,
  from: Point,
  direction: Direction,
  hours = 1
): Point | null {
  const days = sprint.days
  let index = days.findIndex((day) => day.date === from.date)
  if (index < 0) return null

  if (direction === 1) {
    let hour = from.hour + hours
    while (index < days.length) {
      const cap = capacity(sprint, memberId, index)
      if (hour < cap - EPSILON) return { date: days[index].date, hour: round(hour) }
      hour -= Math.max(cap, 0)
      index++
      // A start exactly at the end of a day is the start of the next working one.
      if (hour < EPSILON) hour = 0
    }
    return null
  }

  let hour = from.hour - hours
  while (index >= 0) {
    if (hour > -EPSILON) return { date: days[index].date, hour: round(Math.max(hour, 0)) }
    index--
    if (index >= 0) hour += capacity(sprint, memberId, index)
  }
  return null
}

/** Working hours on a day, for stepping: none on a locked day, which a step jumps. */
function capacity(sprint: Sprint, memberId: string, index: number): number {
  const date = sprint.days[index].date
  return (sprint.lockedDays ?? []).includes(date) ? 0 : effectiveCapacity(sprint, memberId, date)
}

/** Whether any of these pieces sits on a locked day — then nothing of it moves. */
function onLockedDay(sprint: Sprint, pieces: Segment[]): boolean {
  const locked = new Set(sprint.lockedDays ?? [])
  return pieces.some((piece) => locked.has(piece.date))
}

/**
 * Whether the segment holds this instant. The tolerance is far smaller than `EPSILON` on
 * purpose: a probe sits `EPSILON` inside a boundary, and it must still land in the segment on
 * that side of it — a neighbour ending exactly where the task starts has to count.
 */
function covers(segment: Segment, hour: number): boolean {
  const tolerance = 1e-9
  return (
    hour >= segment.startHour - tolerance && hour < segment.startHour + segment.hours - tolerance
  )
}

function inOrder(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
}
