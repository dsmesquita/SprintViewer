import { memberMatches } from './assignment'
import { completedHours, reportedHours } from './sizing'
import type { Block, ISODate, Segment, Sprint } from './types'

/**
 * The layout engine.
 *
 * Placements are stored as an *ordered queue of blocks per person*, never as fixed
 * (day, hour) coordinates. This module flows those queues across the sprint's working
 * days, which is what makes a refresh cheap: change a block's hours and re-flow, and
 * everything after it shifts right — across day boundaries — on its own.
 *
 * Days before the anchor (normally today) are not flowed. They are replayed from
 * `sprint.history`, so the past shows what was actually worked rather than a projection.
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

/** Hours this person can work on this day, after the sprint-wide and personal overrides. */
export function effectiveCapacity(sprint: Sprint, memberId: string, date: ISODate): number {
  const day = sprint.days.find((d) => d.date === date)
  if (!day) return 0
  const override = sprint.capacityOverrides[memberId]?.[date]
  const capacity = override === undefined ? day.capacity : Math.min(day.capacity, override)
  return clamp(capacity, 0, sprint.hoursPerDay)
}

/** True when the day is off for the whole team, as opposed to just this person. */
export function isDayDisabledForAll(sprint: Sprint, date: ISODate): boolean {
  return (sprint.days.find((d) => d.date === date)?.capacity ?? 0) <= 0
}

interface Interval {
  start: number
  end: number
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
  const taken = today === undefined ? 0 : Math.min(reportedToday, effectiveCapacity(sprint, memberId, today))
  if (today !== undefined && taken > 0) claim(occupied, today, { start: 0, end: taken })

  let availableHours = 0
  for (const day of sprint.days) {
    if (day.date >= anchor) availableHours += effectiveCapacity(sprint, memberId, day.date)
  }
  availableHours = round(availableHours - taken)

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

  const pinnedDays = new Set(pinned.map((block) => block.pin!.date))
  // A sprint with a recorded past draws the past from that record alone. The plan snapshots
  // are what made days already shown reshape themselves as Completed Work grew.
  const history = sprint.pastRecord ? {} : (sprint.history[memberId] ?? {})
  // A snapshot says what the plan was on a day that has since passed. Where it disagrees with
  // what TFS says was actually completed, it gives way: a task nobody reported an hour
  // against did not happen, whatever Monday's plan claimed, and it must not hold Monday's
  // space against work that did. A server with no Completed Work field cannot be judged, so
  // its snapshots are replayed whole.
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

  const usedHours = segments
    .filter((segment) => !segment.fromHistory && segment.date >= anchor)
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

  for (let index = startIndex; index < sprint.days.length && left > 0; index++) {
    const day = sprint.days[index]
    const capacity = effectiveCapacity(sprint, memberId, day.date)
    if (capacity <= 0) continue

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

/** The parts of a day that are inside capacity and not already taken, left to right. */
function freeIntervals(capacity: number, taken: Interval[] | undefined): Interval[] {
  if (!taken || taken.length === 0) return [{ start: 0, end: capacity }]

  const gaps: Interval[] = []
  let cursor = 0
  for (const interval of [...taken].sort((a, b) => a.start - b.start)) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: Math.min(interval.start, capacity) })
    cursor = Math.max(cursor, interval.end)
    if (cursor >= capacity) break
  }
  if (cursor < capacity) gaps.push({ start: cursor, end: capacity })
  return gaps.filter((gap) => gap.end > gap.start)
}

function claim(occupied: Map<ISODate, Interval[]>, date: ISODate, interval: Interval): void {
  const existing = occupied.get(date)
  if (existing) existing.push(interval)
  else occupied.set(date, [interval])
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

/**
 * The recorded past as it should be drawn now.
 *
 * Two things can overrule it. A reported pin: dragging a task's done hours is the user saying
 * where they belong, so that task's recorded pieces give way and are drawn from the pin. And
 * TFS itself: when Completed Work goes *down* — a typo corrected — the record cannot go on
 * showing hours nobody reports, so the most recent of them are dropped. Nothing else moves.
 */
export function liveRecord(sprint: Sprint, anchor: ISODate): Record<string, Record<ISODate, Segment[]>> {
  if (!sprint.pastRecord) return {}
  const all: Array<{ memberId: string; piece: Segment }> = []
  for (const [memberId, byDate] of Object.entries(sprint.pastRecord)) {
    for (const [date, pieces] of Object.entries(byDate)) {
      if (date >= anchor) continue
      for (const piece of pieces) all.push({ memberId, piece })
    }
  }
  all.sort((a, b) => a.piece.date.localeCompare(b.piece.date) || a.piece.startHour - b.piece.startHour)

  const used = new Map<number, number>()
  const out: Record<string, Record<ISODate, Segment[]>> = {}
  for (const { memberId, piece } of all) {
    if (sprint.reportedPins?.[piece.workItemId]) continue
    const allowed = completedHours(sprint.workItems[piece.workItemId])
    let hours = piece.hours
    if (allowed !== undefined) {
      const room = round(allowed - (used.get(piece.workItemId) ?? 0))
      if (room <= 0) continue
      hours = Math.min(hours, room)
    }
    used.set(piece.workItemId, round((used.get(piece.workItemId) ?? 0) + hours))
    const byDate = (out[memberId] ??= {})
    const day = (byDate[piece.date] ??= [])
    day.push({ ...piece, hours, isDone: true, fromHistory: undefined })
  }
  return out
}

/**
 * The reported hours drawn on each day before the anchor, per person — what a refresh stores
 * as {@link Sprint.pastRecord}. Pieces that ran onto today are left out: today is not over.
 */
export function recordPast(sprint: Sprint, anchor: ISODate): Record<string, Record<ISODate, Segment[]>> {
  const record: Record<string, Record<ISODate, Segment[]>> = {}
  for (const [memberId, layout] of Object.entries(layoutSprint(sprint, anchor))) {
    const byDate: Record<ISODate, Segment[]> = {}
    for (const segment of layout.segments) {
      if (segment.date >= anchor || !(segment.isDone || segment.fromHistory)) continue
      const { doneOverflow: _overflow, fromHistory: _history, pinned: _pinned, ...piece } = segment
      const day = (byDate[segment.date] ??= [])
      day.push({ ...piece, blockId: `done:${segment.workItemId}`, isDone: true })
    }
    record[memberId] = byDate
  }
  return record
}

function sameReserved(before: Map<string, number>, after: Map<string, number>): boolean {
  if (before.size !== after.size) return false
  for (const [memberId, hours] of before) if (after.get(memberId) !== hours) return false
  return true
}

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
function withReportedHours(
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
      if (!best || segment.date < best.date ||
        (segment.date === best.date && segment.startHour < best.startHour)) {
        earliest.set(segment.workItemId, { memberId, date: segment.date, startHour: segment.startHour })
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
    targets.set(workItemId, { memberId: position.memberId, date: position.date, hour: position.startHour })
  }
  // A task with nothing left has no block to be found by, and one that was finished before
  // anybody scheduled it never had one. TFS still says whose it was, and those hours happened:
  // without this they would be drawn nowhere at all.
  for (const item of Object.values(sprint.workItems)) {
    if (targets.has(item.id) || reportedHours(item) <= 0) continue
    const owner = sprint.members.find((member) => memberMatches(member, item.assignedTo ?? ''))
    if (owner && layouts[owner.id]) {
      targets.set(item.id, { memberId: owner.id, date: anchor, hour: 0 })
    }
  }
  for (const [key, pin] of Object.entries(sprint.reportedPins ?? {})) {
    if (!layouts[pin.memberId]) continue
    targets.set(Number(key), { memberId: pin.memberId, date: pin.date, hour: pin.startHour, pinned: true })
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
      if ((leftRecord === undefined) !== (rightRecord === undefined)) return leftRecord === undefined ? 1 : -1
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
    const todayCapacity = todayDate === undefined ? 0 : effectiveCapacity(sprint, memberId, todayDate)

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
        (segment.date < hit.date || (segment.date === hit.date && segment.startHour < hit.startHour))
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

/**
 * Snapshot the days before `anchor` so they stop being re-flowed.
 *
 * Called at each refresh: the days that have passed keep showing what was scheduled at the
 * time, while the hours still remaining in TFS re-flow forward from the anchor. A block can
 * therefore appear both in history and ahead of the anchor — that is the point, since work
 * carried over is exactly what a partially finished task looks like.
 */
export function freezeHistoryBefore(
  sprint: Sprint,
  anchor: ISODate
): Record<string, Record<ISODate, Segment[]>> {
  const first = sprint.days[0]?.date
  if (!first) return {}
  const history: Record<string, Record<ISODate, Segment[]>> = {}

  for (const member of sprint.members) {
    const previous = sprint.history[member.id] ?? {}
    // Flow from the top of the sprint so the past is laid out, then keep only the past.
    const { segments } = layoutMember({ ...sprint, history: {} }, member.id, first)
    // Pinned blocks are already an explicit record of the past, so snapshotting them too
    // would show the same work twice.
    const flowed = segments.filter((segment) => !segment.pinned && !segment.fromHistory)
    const byDate: Record<ISODate, Segment[]> = {}
    for (const day of sprint.days) {
      if (day.date >= anchor) break
      byDate[day.date] = previous[day.date] ?? flowed.filter((s) => s.date === day.date)
    }
    history[member.id] = byDate
  }
  return history
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Guards against float drift from repeated subtraction of fractional remaining work. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
