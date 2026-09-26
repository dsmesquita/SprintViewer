import { formatDayHeader } from '../dates'
import { moveBlock, pinBlockAt } from '../mutations'
import { effectiveCapacity, layoutSprint, type MemberLayout } from '../scheduling'
import type { ISODate, Sprint, WorkItem } from '../types'
import { round } from '../math'
import type { Candidate } from './types'
import { devSiblings, isChainedVal } from './kinds'

/**
 * VAL after DEV: a validation task starts the hour its development ends, whoever does each —
 * or, when that is too late to finish, as late as its owner's sprint allows.
 */

export interface Point {
  date: ISODate
  hour: number
}

export function before(a: Point, b: Point): boolean {
  return a.date < b.date || (a.date === b.date && a.hour < b.hour - 1e-9)
}

/** Where the last of a parent's DEV work ends on anyone's calendar, if it is anywhere. */
export function devEnd(
  sprint: Sprint,
  layouts: Record<string, MemberLayout>,
  item: WorkItem
): Point | null {
  const devIds = new Set(devSiblings(sprint, item).map((dev) => dev.id))
  let end: Point | null = null
  for (const layout of Object.values(layouts)) {
    for (const segment of layout.segments) {
      if (!devIds.has(segment.workItemId) || segment.fromHistory || segment.isDone) continue
      const point = { date: segment.date, hour: round(segment.startHour + segment.hours) }
      if (!end || before(end, point)) end = point
    }
  }
  return end
}

/**
 * Where a VAL task should start: the hour its DEV work ends, or the anchor when that has
 * already passed or there is no DEV work left on any calendar. A locked day is skipped for the
 * start of the next one that is not.
 */
export function valStart(
  sprint: Sprint,
  layouts: Record<string, MemberLayout>,
  item: WorkItem,
  anchor: ISODate
): Point {
  const end = devEnd(sprint, layouts, item)
  let start = !end || end.date < anchor ? { date: anchor, hour: 0 } : end
  const locked = new Set(sprint.lockedDays ?? [])
  if (locked.has(start.date)) {
    const next = sprint.days.find((day) => day.date > start.date && !locked.has(day.date))
    if (next) start = { date: next.date, hour: 0 }
  }
  return start
}

/** Whether any DEV task of this VAL's parent is still waiting in the backlog. */
export function devUnplanned(sprint: Sprint, item: WorkItem): boolean {
  const devIds = new Set(devSiblings(sprint, item).map((dev) => dev.id))
  return sprint.backlog.some((block) => devIds.has(block.workItemId) && block.hours > 0)
}

/**
 * VAL tasks on the calendar that start before their DEV work ends — the link is set once, by
 * auto-assign, so a DEV task that later grows or moves can leave its VAL behind. Keyed by
 * block, with the reason to show.
 */
export function valWarnings(
  sprint: Sprint,
  layouts: Record<string, MemberLayout>,
  anchor: ISODate
): Map<string, string> {
  const warnings = new Map<string, string>()
  for (const [memberId, layout] of Object.entries(layouts)) {
    const firsts = new Map<string, Point & { workItemId: number }>()
    for (const segment of layout.segments) {
      if (segment.fromHistory || segment.isDone) continue
      const seen = firsts.get(segment.blockId)
      const point = { date: segment.date, hour: segment.startHour, workItemId: segment.workItemId }
      if (!seen || before(point, seen)) firsts.set(segment.blockId, point)
    }
    for (const [blockId, start] of firsts) {
      if (start.date < anchor) continue
      const item = sprint.workItems[start.workItemId]
      if (!isChainedVal(sprint, item)) continue
      const end = devEnd(sprint, layouts, item!)
      if (end && before(start, end)) {
        // Ending on the sprint's last hour means auto-assign put it as late as it could go.
        const last = sprintEnd(sprint, memberId, anchor)
        const ends = lastEnd(layout, blockId)
        const atEnd =
          last !== null && ends !== null && ends.date === last.date && ends.hour >= last.hour - 1e-9
        warnings.set(
          blockId,
          `Starts before its DEV work ends (${formatDayHeader(end.date)}, hour ${Math.ceil(end.hour)})` +
            (atEnd ? ' — placed as late as the sprint allows' : '')
        )
      }
    }
  }
  return warnings
}

/** Where a block's last drawn piece ends. */
export function lastEnd(layout: MemberLayout, blockId: string): Point | null {
  let end: Point | null = null
  for (const segment of layout.segments) {
    if (segment.blockId !== blockId || segment.fromHistory || segment.isDone) continue
    const point = { date: segment.date, hour: round(segment.startHour + segment.hours) }
    if (!end || before(end, point)) end = point
  }
  return end
}

/** How many of a block's hours the layout manages to draw ahead of the anchor. */
export function drawnHours(
  layouts: Record<string, MemberLayout>,
  memberId: string,
  blockId: string
): number {
  return (layouts[memberId]?.segments ?? [])
    .filter((s) => s.blockId === blockId && !s.fromHistory && !s.isDone)
    .reduce((sum, s) => sum + s.hours, 0)
}

/** The days a person can have work pinned to from the anchor on: working, and not locked. */
export function workingDaysFrom(
  sprint: Sprint,
  memberId: string,
  anchor: ISODate
): Array<{ date: ISODate; capacity: number }> {
  const locked = new Set(sprint.lockedDays ?? [])
  return sprint.days
    .filter((day) => day.date >= anchor && !locked.has(day.date))
    .map((day) => ({ date: day.date, capacity: effectiveCapacity(sprint, memberId, day.date) }))
    .filter((day) => day.capacity > 0)
}

/** The last hour of a person's sprint — where a VAL placed as late as possible ends. */
export function sprintEnd(sprint: Sprint, memberId: string, anchor: ISODate): Point | null {
  const days = workingDaysFrom(sprint, memberId, anchor)
  const last = days[days.length - 1]
  return last ? { date: last.date, hour: last.capacity } : null
}

/**
 * The latest start from which a VAL still fits before the end of its owner's sprint, and the
 * sprint with it pinned there.
 *
 * The first guess walks back from the end of the sprint over the time no pin holds — unpinned
 * work flows around a pin, so it does not count as taken. That guess is then checked against a
 * real layout, because pins are laid in date order and one placed just before a meeting could
 * push that meeting later. A start is only taken when the VAL is drawn whole, nothing else
 * pinned moves, nobody is pushed past the sprint, no other VAL is left starting before its DEV
 * ends, and — when asked — nothing already on the calendar moves. Failing that, earlier whole
 * hours are tried in turn.
 */
export function latestFit(
  sprint: Sprint,
  anchor: ISODate,
  candidate: Candidate,
  disturbs: (candidate: Sprint) => boolean
): { sprint: Sprint; start: Point } | null {
  const { block, memberId } = candidate
  const without = moveBlock(sprint, block.id, { kind: 'backlog' }, sprint.backlog.length)
  const baseLayouts = layoutSprint(without, anchor)
  const spill = (layouts: Record<string, MemberLayout>): number =>
    round(Object.values(layouts).reduce((sum, l) => sum + l.spillover, 0))
  const baseSpill = spill(baseLayouts)
  const baseWarnings = new Set(valWarnings(without, baseLayouts, anchor).keys())
  const basePins = pinnedPlacements(baseLayouts)

  const taken = new Map<ISODate, Array<{ start: number; end: number }>>()
  for (const s of baseLayouts[memberId]?.segments ?? []) {
    if (s.fromHistory || !(s.pinned || s.isDone)) continue
    taken.set(s.date, [
      ...(taken.get(s.date) ?? []),
      { start: s.startHour, end: round(s.startHour + s.hours) }
    ])
  }

  const days = workingDaysFrom(sprint, memberId, anchor)
  let guess: Point | null = null
  let need = block.hours
  for (let i = days.length - 1; i >= 0 && !guess; i--) {
    const gaps = freeGaps(days[i].capacity, taken.get(days[i].date) ?? [])
    for (let g = gaps.length - 1; g >= 0; g--) {
      const length = round(gaps[g].end - gaps[g].start)
      if (length >= need - 1e-9) {
        guess = { date: days[i].date, hour: round(gaps[g].end - need) }
        break
      }
      need = round(need - length)
    }
  }
  if (!guess) return null

  const tries: Point[] = [guess]
  for (let i = days.length - 1; i >= 0; i--) {
    for (let hour = Math.ceil(days[i].capacity) - 1; hour >= 0; hour--) {
      const point = { date: days[i].date, hour }
      if (before(point, guess)) tries.push(point)
    }
  }

  for (const start of tries) {
    const pinned = pinBlockAt(without, block.id, memberId, start.date, start.hour)
    const layouts = layoutSprint(pinned, anchor)
    if (drawnHours(layouts, memberId, block.id) < block.hours - 1e-9) continue
    if (spill(layouts) > baseSpill) continue
    const warnings = [...valWarnings(pinned, layouts, anchor).keys()]
    if (warnings.some((id) => id !== block.id && !baseWarnings.has(id))) continue
    if (pinnedPlacements(layouts, block.id) !== basePins) continue
    if (disturbs(pinned)) continue
    return { sprint: pinned, start }
  }
  return null
}

/** Where every pinned piece is drawn, as one string, leaving out `except`. */
export function pinnedPlacements(layouts: Record<string, MemberLayout>, except?: string): string {
  const parts: string[] = []
  for (const [memberId, layout] of Object.entries(layouts)) {
    for (const s of layout.segments) {
      if (!s.pinned || s.fromHistory || s.isDone || s.blockId === except) continue
      parts.push(`${memberId}:${s.blockId}:${s.date}@${s.startHour}+${s.hours}`)
    }
  }
  return parts.sort().join(' ')
}

/** The stretches of a day of `capacity` hours that none of `taken` covers, earliest first. */
export function freeGaps(
  capacity: number,
  taken: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const t of [...taken].sort((a, b) => a.start - b.start)) {
    if (t.start > cursor) gaps.push({ start: cursor, end: Math.min(t.start, capacity) })
    cursor = Math.max(cursor, t.end)
  }
  if (cursor < capacity) gaps.push({ start: cursor, end: capacity })
  return gaps.filter((gap) => gap.end > gap.start)
}
