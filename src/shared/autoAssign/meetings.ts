import { effectiveCapacity, layoutSprint } from '../scheduling'
import type { Block, ISODate, Sprint } from '../types'
import { round } from '../math'

/** Spreading a meeting allowance over the sprint instead of placing it in one lump. */

/**
 * How a meeting allowance is cut: into two to five pieces, never more pieces than there are
 * days to put them on, and never a piece under an hour.
 *
 * Preference, first match wins:
 *  1. the most pieces that divide it evenly and are at least 2h each — 8h is 4 × 2h;
 *  2. the most pieces at least 2h each — 7h is 3h + 2h + 2h;
 *  3. the most pieces that divide it evenly — 3h is 3 × 1h;
 *  4. the most pieces.
 *
 * Whole hours throughout: an uneven remainder goes an hour at a time to the first pieces, and
 * any fraction of an hour to the first piece alone.
 */
export function meetingPieces(hours: number, days: number): number[] {
  const most = Math.min(5, days, Math.floor(hours))
  if (most < 2) return [round(hours)]

  const options: Array<{ pieces: number[]; even: boolean; smallest: number }> = []
  for (let n = most; n >= 2; n--) {
    const pieces = distribute(hours, n)
    options.push({
      pieces,
      even: pieces.every((piece) => piece === pieces[0]),
      smallest: Math.min(...pieces)
    })
  }
  const pick =
    options.find((o) => o.even && o.smallest >= 2) ??
    options.find((o) => o.smallest >= 2) ??
    options.find((o) => o.even) ??
    options[0]
  return pick.pieces
}

export function distribute(hours: number, n: number): number[] {
  const whole = Math.floor(hours)
  const base = Math.floor(whole / n)
  const extra = whole - base * n
  const pieces = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
  pieces[0] = round(pieces[0] + (hours - whole))
  return pieces
}

/** `n` of the given days, spread as evenly as they go — the middle of each equal share. */
export function spreadDays(days: ISODate[], n: number): ISODate[] {
  return Array.from({ length: n }, (_, i) => days[Math.floor(((i + 0.5) * days.length) / n)])
}

/**
 * Days a person's meetings can go on: working days for them from the anchor on, never the
 * sprint's first working day — that is planning, and a meeting allowance is for everything
 * else — and never a locked day.
 */
export function meetingDays(sprint: Sprint, memberId: string, anchor: ISODate): ISODate[] {
  const first = sprint.days.find((day) => day.capacity > 0)?.date
  const locked = new Set(sprint.lockedDays ?? [])
  return sprint.days
    .filter(
      (day) =>
        day.date >= anchor &&
        day.date !== first &&
        !locked.has(day.date) &&
        effectiveCapacity(sprint, memberId, day.date) > 0
    )
    .map((day) => day.date)
}

/** The sprint's last working day: review and retrospective, whose afternoon stays free. */
export function lastWorkingDay(sprint: Sprint): ISODate | undefined {
  return [...sprint.days].reverse().find((day) => day.capacity > 0)?.date
}

/**
 * Whether any of these newly placed pieces runs into the second half of the sprint's last
 * working day — measured on the calendar as drawn, so a meeting already at the start of that
 * day, which pushes a new piece along, counts too.
 */
export function runsIntoLastAfternoon(
  sprint: Sprint,
  memberId: string,
  pieces: Block[],
  anchor: ISODate
): boolean {
  const last = lastWorkingDay(sprint)
  if (!last || !pieces.some((piece) => piece.pin?.date === last)) return false
  const middle = effectiveCapacity(sprint, memberId, last) / 2
  const ids = new Set(pieces.map((piece) => piece.id))
  return (layoutSprint(sprint, anchor)[memberId]?.segments ?? []).some(
    (segment) =>
      ids.has(segment.blockId) &&
      segment.date === last &&
      segment.startHour + segment.hours > middle + 1e-9
  )
}

/**
 * Puts a meeting on the calendar as pieces pinned to the start of their days. The start of the
 * day rather than anywhere in it: the rest of the day's work then simply follows the meeting,
 * instead of a task being cut in two around it.
 */
export function placeMeeting(
  sprint: Sprint,
  block: Block,
  memberId: string,
  days: ISODate[],
  newId: (index: number) => string
): { sprint: Sprint; pieces: Block[] } | null {
  if (days.length === 0) return null
  const hours = meetingPieces(block.hours, days.length)
  const dates = spreadDays(days, hours.length)
  const pieces: Block[] = hours.map((h, i) => ({
    id: i === 0 ? block.id : newId(i),
    workItemId: block.workItemId,
    hours: h,
    pin: { date: dates[i], startHour: 0 }
  }))
  return {
    sprint: {
      ...sprint,
      backlog: sprint.backlog.filter((b) => b.id !== block.id),
      queues: { ...sprint.queues, [memberId]: [...(sprint.queues[memberId] ?? []), ...pieces] }
    },
    pieces
  }
}
