import { memberFor } from '../assignment'
import { round } from '../math'
import { reportedHours } from '../sizing'
import type { ISODate, Segment, Sprint } from '../types'
import { effectiveCapacity } from './capacity'
import { claim, freeIntervals, type Interval } from './intervals'
import type { MemberLayout } from './layout'

/**
 * Draws the hours already reported in TFS on the days before the anchor.
 *
 * This runs across the whole sprint rather than inside `layoutMember`, because deciding who
 * a work item's reported hours belong to needs everybody's positions: a task split between
 * two people is drawn as done once, under whoever holds its earliest part.
 *
 * Reported hours never consume capacity from the anchor onwards. Letting them would eat into
 * the plan and inflate spillover, which would make the calendar wrong in a way that matters
 * far more than the drawing is worth.
 */
export function withReportedHours(
  sprint: Sprint,
  layouts: Record<string, MemberLayout>,
  anchor: ISODate
): { layouts: Record<string, MemberLayout>; reportedToday: Map<string, number> } {
  const reportedToday = new Map<string, number>()
  const anchorIndex = sprint.days.findIndex((day) => day.date >= anchor)
  if (anchorIndex < 0) return { layouts, reportedToday }

  // Earliest position of each work item, and who holds it.
  const earliest = new Map<number, { memberId: string; date: ISODate; startHour: number }>()
  for (const [memberId, layout] of Object.entries(layouts)) {
    for (const segment of layout.segments) {
      if (segment.fromHistory || segment.isDone) continue
      const best = earliest.get(segment.workItemId)
      if (
        !best ||
        segment.date < best.date ||
        (segment.date === best.date && segment.startHour < best.startHour)
      ) {
        earliest.set(segment.workItemId, {
          memberId,
          date: segment.date,
          startHour: segment.startHour
        })
      }
    }
  }

  // Where each work item's reported hours belong, and in what order they are drawn. A pin
  // overrules the derived position entirely — including which person holds the hours, since
  // dragging the ribbon onto another row is exactly how you say who did the work. It also
  // stands on its own: the hours were worked whether or not anything of the task is still
  // scheduled, so a pinned item is drawn even with no block left anywhere.
  const targets = new Map<number, Placement>()
  for (const [workItemId, position] of earliest) {
    targets.set(workItemId, {
      memberId: position.memberId,
      date: position.date,
      hour: position.startHour
    })
  }
  // A task with nothing left has no block to be found by, and one that was finished before
  // anybody scheduled it never had one. TFS still says whose it was, and those hours happened:
  // without this they would be drawn nowhere at all.
  for (const item of Object.values(sprint.workItems)) {
    if (targets.has(item.id) || reportedHours(item) <= 0) continue
    const owner = memberFor(sprint.members, item.assignedTo)
    if (owner && layouts[owner.id]) {
      targets.set(item.id, { memberId: owner.id, date: anchor, hour: 0 })
    }
  }
  for (const [key, pin] of Object.entries(sprint.reportedPins ?? {})) {
    if (!layouts[pin.memberId]) continue
    targets.set(Number(key), {
      memberId: pin.memberId,
      date: pin.date,
      hour: pin.startHour,
      pinned: true
    })
  }

  const owned = new Map<string, Array<{ workItemId: number; hours: number; pinned: boolean }>>()
  for (const [workItemId, target] of targets) {
    const item = sprint.workItems[workItemId]
    if (!item) continue
    // Whatever is already on the calendar for these hours — pinned by hand, or replayed from
    // a snapshot — is the same work, so only the difference is drawn. Subtracting rather than
    // skipping matters: two hours recorded against six reported should leave four to draw,
    // not nothing at all.
    const hours = round(reportedHours(item) - recordedPast(layouts, workItemId, anchor))
    if (hours <= 0) continue
    const entry = { workItemId, hours, pinned: target.pinned === true }
    owned.set(target.memberId, [...(owned.get(target.memberId) ?? []), entry])
  }

  // Where each task's recorded hours begin. A task already on the record continues before one
  // that is not, so its new hours sit with its old ones rather than behind somebody else's.
  const firstRecorded = new Map<number, string>()
  for (const layout of Object.values(layouts)) {
    for (const segment of layout.segments) {
      if (!segment.isDone || segment.date >= anchor) continue
      const key = `${segment.date}@${String(segment.startHour).padStart(5, '0')}`
      const seen = firstRecorded.get(segment.workItemId)
      if (seen === undefined || key < seen) firstRecorded.set(segment.workItemId, key)
    }
  }

  const next: Record<string, MemberLayout> = { ...layouts }
  for (const [memberId, wanted] of owned) {
    const layout = layouts[memberId]
    const occupied = new Map<ISODate, Interval[]>()
    for (const segment of layout.segments) {
      if (segment.date >= anchor) continue
      claim(occupied, segment.date, {
        start: segment.startHour,
        end: round(segment.startHour + segment.hours)
      })
    }

    // Pinned hours claim their slots first — they are a statement about what happened, and
    // anything derived has to make way for it. The rest are served in the order their work
    // appears on the calendar, each filling the oldest free space first.
    const ordered = [...wanted].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      const leftRecord = firstRecorded.get(a.workItemId)
      const rightRecord = firstRecorded.get(b.workItemId)
      if ((leftRecord === undefined) !== (rightRecord === undefined))
        return leftRecord === undefined ? 1 : -1
      if (leftRecord !== undefined && rightRecord !== undefined && leftRecord !== rightRecord) {
        return leftRecord < rightRecord ? -1 : 1
      }
      const left = targets.get(a.workItemId)!
      const right = targets.get(b.workItemId)!
      return left.date.localeCompare(right.date) || left.hour - right.hour
    })

    const done: Segment[] = []
    const overflow: Array<{ workItemId: number; hours: number }> = []
    // Hours reported today's own working hours have had to take, because the days before it
    // were full. The plan is laid out again around them: they have been worked, so the day
    // cannot be planned into them.
    let todayUsed = 0
    const todayDate = sprint.days[anchorIndex]?.date
    const todayCapacity =
      todayDate === undefined ? 0 : effectiveCapacity(sprint, memberId, todayDate)

    for (const { workItemId, hours, pinned } of ordered) {
      const target = targets.get(workItemId)!
      const packed = pinned
        ? packFromPin(sprint, memberId, workItemId, hours, target, anchorIndex, occupied)
        : packForwards(sprint, memberId, workItemId, hours, anchorIndex, occupied)
      const pieces = [...packed.segments]
      let left = packed.leftover

      if (left > 0 && todayDate !== undefined && todayUsed < todayCapacity) {
        const take = Math.min(left, round(todayCapacity - todayUsed))
        pieces.push(donePiece(workItemId, todayDate, todayUsed, take))
        todayUsed = round(todayUsed + take)
        left = round(left - take)
      }

      const joined = joinPieces(pieces, left)
      done.push(...joined.segments)
      if (left > 0) overflow.push({ workItemId, hours: left })
    }
    if (todayUsed > 0) reportedToday.set(memberId, todayUsed)
    if (done.length > 0 || overflow.length > 0) {
      next[memberId] = {
        ...layout,
        segments: [...layout.segments, ...done],
        reportedOverflow: overflow
      }
    }
  }
  return { layouts: next, reportedToday }
}

/**
 * Hours of this work item already drawn on days before the anchor — pinned, replayed or
 * recorded — on anybody's row: a task can move to someone else after its hours were drawn.
 */
function recordedPast(
  layouts: Record<string, MemberLayout>,
  workItemId: number,
  anchor: ISODate
): number {
  let total = 0
  for (const layout of Object.values(layouts)) {
    for (const segment of layout.segments) {
      if (segment.workItemId !== workItemId || segment.date >= anchor) continue
      if (segment.pinned === true || segment.fromHistory === true || segment.isDone === true) {
        total += segment.hours
      }
    }
  }
  return round(total)
}

/** Where a work item's reported hours are drawn, and whether the user put them there. */
interface Placement {
  memberId: string
  date: ISODate
  hour: number
  pinned?: boolean
}

interface Packed {
  segments: Segment[]
  leftover: number
}

/**
 * The same, but starting where the user dropped the ribbon and filling forwards.
 *
 * Forwards rather than backwards because a pin says "it started here". Anything that will not
 * fit ahead of the pin falls back to {@link packForwards} rather than being lost — a pin whose
 * day has since been shortened should still draw every hour somewhere.
 */
function packFromPin(
  sprint: Sprint,
  memberId: string,
  workItemId: number,
  hours: number,
  pin: Placement,
  anchorIndex: number,
  occupied: Map<ISODate, Interval[]>
): Packed {
  const pieces: Segment[] = []
  let left = hours

  // A pin can land on a day that has since left the sprint, so start from the first day at or
  // after it rather than insisting on an exact match.
  const startIndex = sprint.days.findIndex((day) => day.date >= pin.date)
  if (startIndex >= 0) {
    for (let index = startIndex; index < anchorIndex && left > 0; index++) {
      const day = sprint.days[index]
      const capacity = effectiveCapacity(sprint, memberId, day.date)
      if (capacity <= 0) continue

      const floor = index === startIndex ? pin.hour : 0
      for (const gap of freeIntervals(capacity, occupied.get(day.date))) {
        if (left <= 0) break
        const start = Math.max(gap.start, floor)
        if (start >= gap.end) continue
        const take = Math.min(left, round(gap.end - start))
        left = round(left - take)
        pieces.push(donePiece(workItemId, day.date, start, take))
        claim(occupied, day.date, { start, end: round(start + take) })
      }
    }
  }

  if (left > 0) {
    const back = packForwards(sprint, memberId, workItemId, left, anchorIndex, occupied)
    pieces.push(...back.segments)
    left = back.leftover
  }

  return joinPieces(pieces, left)
}

/**
 * Lays `hours` into the free space before the anchor, oldest gap first: a hole left on Tuesday
 * is filled before Wednesday is touched. Days already drawn keep what is on them — only their
 * empty stretches are used.
 */
function packForwards(
  sprint: Sprint,
  memberId: string,
  workItemId: number,
  hours: number,
  anchorIndex: number,
  occupied: Map<ISODate, Interval[]>
): Packed {
  const pieces: Segment[] = []
  let left = hours

  for (let index = 0; index < anchorIndex && left > 0; index++) {
    const day = sprint.days[index]
    const capacity = effectiveCapacity(sprint, memberId, day.date)
    if (capacity <= 0) continue
    for (const gap of freeIntervals(capacity, occupied.get(day.date))) {
      if (left <= 0) break
      const take = Math.min(left, round(gap.end - gap.start))
      if (take <= 0) continue
      left = round(left - take)
      pieces.push(donePiece(workItemId, day.date, gap.start, take))
      claim(occupied, day.date, { start: gap.start, end: round(gap.start + take) })
    }
  }

  return joinPieces(pieces, left)
}

function donePiece(workItemId: number, date: ISODate, startHour: number, hours: number): Segment {
  return {
    blockId: `done:${workItemId}`,
    workItemId,
    date,
    startHour,
    hours,
    continued: false,
    continues: false,
    isDone: true
  }
}

/** Orders the pieces of one item's reported hours and marks where they run into each other. */
function joinPieces(pieces: Segment[], leftover: number): Packed {
  const sorted = [...pieces].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour
  )
  return {
    leftover,
    segments: sorted.map((piece, index) => ({
      ...piece,
      continued: index > 0,
      continues: index < sorted.length - 1,
      doneOverflow: leftover > 0 ? leftover : undefined
    }))
  }
}
