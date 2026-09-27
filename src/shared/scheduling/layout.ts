import { round } from '../math'
import { completedHours } from '../sizing'
import type { Block, ISODate, Segment, Sprint } from '../types'
import { effectiveCapacity } from './capacity'
import { claim, freeIntervals, type Interval } from './intervals'
import { liveRecord } from './record'
import { withReportedHours } from './reported'

/**
 * Flowing each person's queue across the sprint, and the whole board from that.
 */

export interface MemberLayout {
  segments: Segment[]
  /**
   * Reported hours with nowhere to go before today, because the days that have passed are
   * already full. Never silently dropped: the calendar would understate the work.
   */
  reportedOverflow: Array<{ workItemId: number; hours: number }>
  /** Hours that did not fit before the sprint ends. > 0 means the person is over-committed. */
  spillover: number
  /** Hours queued from the anchor day onwards. */
  queuedHours: number
  /** Working hours available to this person from the anchor day onwards. */
  availableHours: number
}

/**
 * Flow one person's queue across the sprint.
 *
 * Pinned blocks are placed first, each claiming the first free space at or after its pin, in
 * pin order. Whatever space is left — which may now be fragmented, a gap before a pin and
 * another after it — is filled by the unpinned blocks in queue order, starting at the anchor.
 *
 * @param anchor First day the unpinned queue may schedule into. Days before it are replayed
 *   from history, except on days the person has pinned work: a pin is a deliberate record of
 *   what happened, so it wins over the snapshot.
 */
export function layoutMember(
  sprint: Sprint,
  memberId: string,
  anchor: ISODate,
  /**
   * Hours at the start of today already taken by work reported in TFS — see
   * {@link layoutSprint}. Those hours have been worked, so nothing can be planned into them.
   */
  reportedToday = 0,
  /**
   * This person's recorded past — see {@link Sprint.pastRecord} — already trimmed to what TFS
   * still reports. Drawn as it stands and claimed before anything else, so nothing placed later
   * can land on top of it.
   */
  record?: Record<ISODate, Segment[]>
): MemberLayout {
  const segments: Segment[] = []
  const occupied = new Map<ISODate, Interval[]>()
  const dayIndex = new Map(sprint.days.map((day, index) => [day.date, index]))

  for (const [date, pieces] of Object.entries(record ?? {})) {
    if (date >= anchor) continue
    for (const piece of pieces) {
      segments.push(piece)
      claim(occupied, date, { start: piece.startHour, end: round(piece.startHour + piece.hours) })
    }
  }

  const today = sprint.days.find((day) => day.date >= anchor)?.date
  const taken =
    today === undefined ? 0 : Math.min(reportedToday, effectiveCapacity(sprint, memberId, today))
  if (today !== undefined && taken > 0) claim(occupied, today, { start: 0, end: taken })

  // Locked days are left out of both sides of "free": nothing new can go on them, and what is
  // already there is not using room that anything else could have.
  const locked = new Set(sprint.lockedDays ?? [])
  let availableHours = 0
  for (const day of sprint.days) {
    if (day.date >= anchor && !locked.has(day.date)) {
      availableHours += effectiveCapacity(sprint, memberId, day.date)
    }
  }
  availableHours = round(availableHours - (today !== undefined && locked.has(today) ? 0 : taken))

  const queue = sprint.queues[memberId] ?? []
  const pinned = queue.filter((block) => block.pin).sort(byPin)
  const unpinned = queue.filter((block) => !block.pin)
  let spillover = 0

  const place = (block: Block, fromDate: ISODate, fromHour: number): Position | null => {
    const result = allocate(sprint, memberId, block, fromDate, fromHour, occupied, dayIndex)
    segments.push(...result.segments)
    spillover = round(spillover + result.leftover)
    return result.end
  }

  for (const block of pinned) place(block, block.pin!.date, block.pin!.startHour)

  // The unpinned queue runs as one sequence: each block starts where the previous one ended.
  let cursor: Position = { date: anchor, hour: 0 }
  for (const block of unpinned) {
    const end = place(block, cursor.date, cursor.hour)
    if (end) cursor = end
  }

  // Sprints with a recorded past draw it above, from `record`. Only one saved before that rule
  // existed, still being opened for the first time, falls back to its old plan snapshots.
  if (!sprint.pastRecord) {
    const pinnedDays = new Set(pinned.map((block) => block.pin!.date))
    segments.push(...replayLegacySnapshots(sprint, memberId, anchor, pinnedDays))
  }

  const usedHours = segments
    .filter(
      (segment) => !segment.fromHistory && segment.date >= anchor && !locked.has(segment.date)
    )
    .reduce((sum, segment) => sum + segment.hours, 0)

  return {
    segments,
    reportedOverflow: [],
    spillover,
    queuedHours: round(usedHours + spillover),
    availableHours
  }
}

interface Position {
  date: ISODate
  hour: number
}

interface Allocation {
  segments: Segment[]
  leftover: number
  end: Position | null
}

/**
 * Lays `block` into the first free space at or after (`fromDate`, `fromHour`), splitting it
 * across days and around already-occupied slots as needed.
 */
function allocate(
  sprint: Sprint,
  memberId: string,
  block: Block,
  fromDate: ISODate,
  fromHour: number,
  occupied: Map<ISODate, Interval[]>,
  dayIndex: Map<ISODate, number>
): Allocation {
  const segments: Segment[] = []
  let left = block.hours
  let end: Position | null = null

  const startIndex = dayIndex.get(fromDate) ?? nextDayIndex(sprint, fromDate)
  if (startIndex < 0) return { segments, leftover: left, end: null }

  const locked = new Set(sprint.lockedDays ?? [])
  for (let index = startIndex; index < sprint.days.length && left > 0; index++) {
    const day = sprint.days[index]
    const capacity = effectiveCapacity(sprint, memberId, day.date)
    if (capacity <= 0) continue
    // A locked day takes nothing new: only what was pinned onto it when it was locked. Anything
    // else jumps it, like a day off.
    if (locked.has(day.date) && block.pin?.date !== day.date) continue

    const floor = index === startIndex ? fromHour : 0
    for (const gap of freeIntervals(capacity, occupied.get(day.date))) {
      if (left <= 0) break
      const start = Math.max(gap.start, floor)
      if (start >= gap.end) continue

      const take = Math.min(left, round(gap.end - start))
      const continued = left < block.hours
      left = round(left - take)
      segments.push({
        blockId: block.id,
        workItemId: block.workItemId,
        date: day.date,
        startHour: start,
        hours: take,
        continued,
        continues: left > 0,
        pinned: block.pin !== undefined
      })
      claim(occupied, day.date, { start, end: round(start + take) })
      end = { date: day.date, hour: round(start + take) }
    }
  }

  return { segments, leftover: left, end }
}

/** First sprint day on or after `date`, for a pin that landed on a weekend or a dropped day. */
function nextDayIndex(sprint: Sprint, date: ISODate): number {
  return sprint.days.findIndex((day) => day.date >= date)
}

function byPin(a: Block, b: Block): number {
  const left = a.pin!
  const right = b.pin!
  return left.date.localeCompare(right.date) || left.startHour - right.startHour
}

/**
 * The past as the plan snapshots (`sprint.history`) had it, before past days became a fixed
 * record. Used only to draw a sprint saved by an older version, once, so that its record can
 * be taken from exactly what it showed — see `opened()` in the store and `applyRefresh`.
 *
 * A snapshot says what the plan was on a day that has since passed. Where it disagrees with
 * what TFS says was actually completed, it gives way: a task nobody reported an hour against
 * did not happen, whatever Monday's plan claimed, and it must not hold Monday's space against
 * work that did. A server with no Completed Work field cannot be judged, so its snapshots are
 * replayed whole. Days with a block pinned by hand are left to the pin.
 */
function replayLegacySnapshots(
  sprint: Sprint,
  memberId: string,
  anchor: ISODate,
  pinnedDays: Set<ISODate>
): Segment[] {
  const history = sprint.history[memberId] ?? {}
  const segments: Segment[] = []
  const justified = new Map<number, number>()
  for (const day of sprint.days) {
    if (day.date >= anchor || pinnedDays.has(day.date)) continue
    for (const segment of history[day.date] ?? []) {
      const allowed = completedHours(sprint.workItems[segment.workItemId])
      if (allowed === undefined) {
        segments.push({ ...segment, fromHistory: true })
        continue
      }
      const used = justified.get(segment.workItemId) ?? 0
      const room = round(allowed - used)
      if (room <= 0) continue
      const hours = Math.min(segment.hours, room)
      justified.set(segment.workItemId, round(used + hours))
      segments.push({ ...segment, hours, fromHistory: true })
    }
  }
  return segments
}

/**
 * The whole board: everyone's queue flowed across the sprint, with the hours TFS reports drawn
 * on the days they were worked.
 *
 * Reported hours normally fit in the days that have passed and cost the plan nothing. When they
 * do not — more reported than those days can hold — the rest lands on today, and today's plan
 * has to move along to make room for it. That is why this runs more than once: lay out, see how
 * much of today the reported hours took, lay out again around them. Two passes settle it in all
 * but contrived cases, and the loop stops either way.
 */
export function layoutSprint(sprint: Sprint, anchor: ISODate): Record<string, MemberLayout> {
  let reportedToday = new Map<string, number>()
  let result: Record<string, MemberLayout> = {}
  const record = liveRecord(sprint, anchor)

  for (let pass = 0; pass < 3; pass++) {
    const layouts: Record<string, MemberLayout> = {}
    for (const member of sprint.members) {
      layouts[member.id] = layoutMember(
        sprint,
        member.id,
        anchor,
        reportedToday.get(member.id) ?? 0,
        record[member.id]
      )
    }
    const withReported = withReportedHours(sprint, layouts, anchor)
    result = withReported.layouts
    if (sameReserved(reportedToday, withReported.reportedToday)) break
    reportedToday = withReported.reportedToday
  }
  return result
}

function sameReserved(before: Map<string, number>, after: Map<string, number>): boolean {
  if (before.size !== after.size) return false
  for (const [memberId, hours] of before) if (after.get(memberId) !== hours) return false
  return true
}
