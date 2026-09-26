import { memberMatches } from './assignment'
import { formatDayHeader } from './dates'
import { isContainerType } from './grouping'
import { moveBlock, pinBlockAt } from './mutations'
import { effectiveCapacity, layoutSprint, type MemberLayout } from './scheduling'
import { plannedHoursIn } from './sizing'
import { tagOf, untagged } from './tags'
import type { Block, ISODate, Sprint, WorkItem } from './types'
import { round } from './math'

/**
 * Filling the calendar in one pass.
 *
 * TFS already knows who owns each task and roughly how important it is, so the sweep through
 * the backlog is mostly mechanical: attribute, order, and pour into whatever room each person
 * has left. Two kinds of task get more care than that. Meetings are spread over the sprint
 * rather than landing in one lump, and validation starts the hour its development ends,
 * whoever is doing each.
 *
 * What it deliberately does not do is guess. A task TFS attributes to nobody stays in the
 * backlog, nobody is pushed past the hours they actually have, and anything already on a
 * calendar is only ever moved with the user's say-so — the plan reports what it would disturb.
 */

/** Business Order at or below this counts as prioritised work. */
const PRIORITY_ORDER = 50

/** How many times VAL placements are revisited when placing one pushes another DEV later. */
const MAX_VAL_PASSES = 12

export interface AssignSummary {
  /** Tasks moved onto a calendar. A meeting spread over several days counts once. */
  placed: number
  /** How many people received work. */
  people: number
  /** Left behind because TFS names nobody on the team. */
  unattributed: number
  /** Left behind because the person has no room left for something that size. */
  tooBig: number
  /** Left behind because they have no hours at all. */
  unsized: number
  /** Meetings spread over more than one day. */
  meetingsSplit: number
  /** VAL tasks started straight after their DEV task. */
  valsChained: number
  /**
   * VAL tasks whose DEV ends too close to the end of the sprint for them to follow it, placed
   * as late as their owner's calendar allows instead.
   */
  valsLate: number
  /** VAL tasks left in the backlog because their DEV task is not planned yet. */
  waitingForDev: number
}

/** Which rule placed a task somewhere it could disturb other work. */
export type AssignRule = 'meeting' | 'val' | 'late-val'

/** A task already on a calendar that the plan would move or cut. */
export interface BaseChange {
  blockId: string
  workItemId: number
  memberId: string
  kind: 'moved' | 'split'
  /** The newly placed tasks on that person's calendar that made room for themselves. */
  causes: Array<{ workItemId: number; rule: AssignRule }>
}

export interface AssignPlan {
  sprint: Sprint
  summary: AssignSummary
  /** Empty when nothing already on a calendar moves. */
  baseChanges: BaseChange[]
}

export interface AssignOptions {
  /**
   * Leave everything already on a calendar exactly where it is. Rules that would need to move
   * something are relaxed for the tasks involved instead: a VAL goes to the end of its owner's
   * work, and a meeting is spread only where it disturbs nothing.
   */
  keepBase?: boolean
  /** Ids for the extra pieces a meeting is split into. */
  newId?: () => string
}

// ---------------------------------------------------------------------------------------------
// Task kinds

/** A meeting allowance: the title, once its tag is off, is just "Meeting" or "Meetings". */
export function isMeeting(item: WorkItem | undefined): boolean {
  return item !== undefined && /^meetings?$/i.test(untagged(item.title))
}

function isTagged(item: WorkItem, tag: string): boolean {
  return !isContainerType(item.type) && tagOf(item.title) === tag
}

/** The DEV tasks under the same Bug or User Story. */
function devSiblings(sprint: Sprint, item: WorkItem): WorkItem[] {
  if (item.parentId === undefined) return []
  return Object.values(sprint.workItems).filter(
    (other) => other.parentId === item.parentId && isTagged(other, 'DEV')
  )
}

/** A VAL task with a DEV task to follow. A VAL on its own is ordinary work. */
export function isChainedVal(sprint: Sprint, item: WorkItem | undefined): boolean {
  return item !== undefined && isTagged(item, 'VAL') && devSiblings(sprint, item).length > 0
}

// ---------------------------------------------------------------------------------------------
// Ordering

/**
 * Orders one person's ordinary tasks. Four keys, most significant first:
 *
 *  1. tasks whose parent work item is Active — work the team has already started on,
 *  2. then tasks under a User Story before tasks under anything else,
 *  3. then tasks whose parent's Business Order is 50 or lower,
 *  4. then the shortest first, which fits the most work into whatever room is left.
 *
 * Ties break on the work item id, so running it twice gives the same answer twice.
 */
export function compareForAssignment(sprint: Sprint, a: Block, b: Block): number {
  const left = sprint.workItems[a.workItemId]
  const right = sprint.workItems[b.workItemId]
  if (!left || !right) return 0

  return (
    rank(parentActive(sprint, right), parentActive(sprint, left)) ||
    rank(underStory(sprint, right), underStory(sprint, left)) ||
    rank(prioritised(sprint, right), prioritised(sprint, left)) ||
    plannedHoursIn(sprint, left.id) - plannedHoursIn(sprint, right.id) ||
    left.id - right.id
  )
}

function parentOf(sprint: Sprint, item: WorkItem): WorkItem | undefined {
  return item.parentId === undefined ? undefined : sprint.workItems[item.parentId]
}

function parentActive(sprint: Sprint, item: WorkItem): boolean {
  return parentOf(sprint, item)?.state.trim().toLowerCase() === 'active'
}

function underStory(sprint: Sprint, item: WorkItem): boolean {
  const parent = parentOf(sprint, item)
  return parent !== undefined && parent.type.trim().toLowerCase() === 'user story'
}

function prioritised(sprint: Sprint, item: WorkItem): boolean {
  // Business Order lives on the parent. A task with no parent, or a server with no such
  // field, simply does not win this key rather than losing the ones after it.
  const order = parentOf(sprint, item)?.businessOrder
  return order !== undefined && order <= PRIORITY_ORDER
}

/** True sorts before false. */
function rank(a: boolean, b: boolean): number {
  return Number(a) - Number(b)
}

/** Who on the team this task belongs to, by the name TFS has against it. */
export function ownerOf(sprint: Sprint, item: WorkItem): string | null {
  if (!item.assignedTo) return null
  const member = sprint.members.find((m) => memberMatches(m, item.assignedTo ?? ''))
  return member ? member.id : null
}

// ---------------------------------------------------------------------------------------------
// Meetings

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

function distribute(hours: number, n: number): number[] {
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
function meetingDays(sprint: Sprint, memberId: string, anchor: ISODate): ISODate[] {
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

/**
 * Puts a meeting on the calendar as pieces pinned to the start of their days. The start of the
 * day rather than anywhere in it: the rest of the day's work then simply follows the meeting,
 * instead of a task being cut in two around it.
 */
function placeMeeting(
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

// ---------------------------------------------------------------------------------------------
// VAL after DEV

interface Point {
  date: ISODate
  hour: number
}

function before(a: Point, b: Point): boolean {
  return a.date < b.date || (a.date === b.date && a.hour < b.hour - 1e-9)
}

/** Where the last of a parent's DEV work ends on anyone's calendar, if it is anywhere. */
function devEnd(
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
function valStart(
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
function devUnplanned(sprint: Sprint, item: WorkItem): boolean {
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
function lastEnd(layout: MemberLayout, blockId: string): Point | null {
  let end: Point | null = null
  for (const segment of layout.segments) {
    if (segment.blockId !== blockId || segment.fromHistory || segment.isDone) continue
    const point = { date: segment.date, hour: round(segment.startHour + segment.hours) }
    if (!end || before(end, point)) end = point
  }
  return end
}

// ---------------------------------------------------------------------------------------------
// Comparing against the calendar as it was

/** Every base block's position, as a string that changes when any part of it moves. */
function placementsOf(
  sprint: Sprint,
  anchor: ISODate,
  ids: Set<string>
): Map<string, { memberId: string; workItemId: number; signature: string; pieces: number }> {
  const out = new Map<string, { memberId: string; workItemId: number; parts: string[] }>()
  for (const [memberId, layout] of Object.entries(layoutSprint(sprint, anchor))) {
    for (const segment of layout.segments) {
      if (!ids.has(segment.blockId) || segment.fromHistory || segment.isDone) continue
      const entry = out.get(segment.blockId) ?? {
        memberId,
        workItemId: segment.workItemId,
        parts: []
      }
      entry.parts.push(`${segment.date}@${segment.startHour}+${segment.hours}`)
      out.set(segment.blockId, entry)
    }
  }
  return new Map(
    [...out].map(([id, entry]) => [
      id,
      {
        memberId: entry.memberId,
        workItemId: entry.workItemId,
        signature: [...entry.parts].sort().join(' '),
        pieces: entry.parts.length
      }
    ])
  )
}

// ---------------------------------------------------------------------------------------------
// The plan

interface Candidate {
  block: Block
  item: WorkItem
  memberId: string
  kind: 'meeting' | 'val' | 'ordinary'
}

/**
 * Works out where every backlog task would go, and returns the sprint that would result.
 *
 * Nothing is applied here — the caller shows the summary first, because this moves a great
 * many things at once and the counts are the only way to see what it is about to do. When the
 * plan would disturb work already on a calendar, `baseChanges` says what and why, so the caller
 * can ask before applying — or plan again with `keepBase`.
 */
export function planAutoAssign(
  sprint: Sprint,
  anchor: ISODate,
  options: AssignOptions = {}
): AssignPlan {
  const keepBase = options.keepBase === true
  const summary: AssignSummary = {
    placed: 0,
    people: 0,
    unattributed: 0,
    tooBig: 0,
    unsized: 0,
    meetingsSplit: 0,
    valsChained: 0,
    valsLate: 0,
    waitingForDev: 0
  }

  const baseIds = new Set(Object.values(sprint.queues).flatMap((queue) => queue.map((b) => b.id)))
  const original = placementsOf(sprint, anchor, baseIds)
  const disturbs = (candidate: Sprint): boolean => {
    const now = placementsOf(candidate, anchor, baseIds)
    for (const [id, was] of original) if (now.get(id)?.signature !== was.signature) return true
    return false
  }

  // 0. Who gets what.
  const byMember = new Map<string, Candidate[]>()
  for (const block of sprint.backlog) {
    const item = sprint.workItems[block.workItemId]
    if (!item || isContainerType(item.type)) continue
    if (block.hours <= 0) {
      summary.unsized++
      continue
    }
    const memberId = ownerOf(sprint, item)
    if (!memberId) {
      summary.unattributed++
      continue
    }
    const kind = isMeeting(item) ? 'meeting' : isChainedVal(sprint, item) ? 'val' : 'ordinary'
    byMember.set(memberId, [...(byMember.get(memberId) ?? []), { block, item, memberId, kind }])
  }

  // Room is measured once, against the calendar as it stands, and counted down. Meetings and
  // VAL tasks are served first: both are tied to dates and to other people, while ordinary work
  // can go wherever there is room.
  const baseLayouts = layoutSprint(sprint, anchor)
  const free = new Map<string, number>()
  const accepted: Candidate[] = []
  const skipped: Candidate[] = []
  const kindOrder = { meeting: 0, val: 1, ordinary: 2 }
  for (const [memberId, candidates] of byMember) {
    const layout = baseLayouts[memberId]
    let room = round((layout?.availableHours ?? 0) - (layout?.queuedHours ?? 0))
    const ordered = [...candidates].sort(
      (a, b) =>
        kindOrder[a.kind] - kindOrder[b.kind] || compareForAssignment(sprint, a.block, b.block)
    )
    for (const candidate of ordered) {
      if (candidate.block.hours > room) {
        // Skipped rather than stopped: a shorter task further down the order can still fit,
        // and leaving an obvious gap because one thing was too big helps nobody.
        summary.tooBig++
        if (candidate.kind === 'ordinary') skipped.push(candidate)
        continue
      }
      room = round(room - candidate.block.hours)
      accepted.push(candidate)
    }
    free.set(memberId, room)
  }

  const receivers = new Set<string>()
  const pinnedNew: Array<{ memberId: string; workItemId: number; rule: AssignRule }> = []
  const ordinary = accepted.filter((c) => c.kind === 'ordinary')
  let next = sprint
  let pieceCount = 0
  const newId = (): string => options.newId?.() ?? `auto-meeting-${Date.now()}-${++pieceCount}`

  // 1. Meetings, spread over the sprint.
  for (const candidate of accepted.filter((c) => c.kind === 'meeting')) {
    const days = meetingDays(next, candidate.memberId, anchor)
    let placed = placeMeeting(next, candidate.block, candidate.memberId, days, newId)
    if (placed && keepBase && disturbs(placed.sprint)) {
      // Only days after this person's existing work can take a pin without moving any of it.
      const last = lastBaseDay(next, anchor, candidate.memberId, baseIds)
      placed = placeMeeting(
        next,
        candidate.block,
        candidate.memberId,
        days.filter((day) => last === null || day > last),
        newId
      )
      if (placed && disturbs(placed.sprint)) placed = null
    }
    if (!placed) {
      // Nowhere to spread it: it goes in with the ordinary work, whole.
      ordinary.push({ ...candidate, kind: 'ordinary' })
      continue
    }
    next = placed.sprint
    receivers.add(candidate.memberId)
    summary.placed++
    if (placed.pieces.length > 1) summary.meetingsSplit++
    pinnedNew.push({ memberId: candidate.memberId, workItemId: candidate.item.id, rule: 'meeting' })
  }

  // 2. Ordinary work, at the end of each person's queue. Appending never moves anything that
  // was already there, so it needs no checking.
  const append = (candidate: Candidate): void => {
    const queue = next.queues[candidate.memberId] ?? []
    next = moveBlock(
      next,
      candidate.block.id,
      { kind: 'member', memberId: candidate.memberId },
      queue.length
    )
    receivers.add(candidate.memberId)
    summary.placed++
  }
  ordinary.forEach(append)

  // 3. VAL after DEV. A VAL whose DEV is still in the backlog has nothing to follow yet.
  const vals: Candidate[] = []
  for (const candidate of accepted.filter((c) => c.kind === 'val')) {
    if (devUnplanned(next, candidate.item)) {
      summary.waitingForDev++
      continue
    }
    vals.push(candidate)
  }

  // Pinning one VAL can cut into someone's DEV work and make it end later, which moves the
  // VAL that follows it. Everything only ever moves later and stops at the sprint's end, so
  // going round until nothing changes settles.
  const pins = new Map<string, Point>()
  const unlinked = new Set<string>()
  for (let pass = 0; pass < MAX_VAL_PASSES; pass++) {
    let changed = false
    const layouts = layoutSprint(next, anchor)
    const order = vals
      .filter((c) => !unlinked.has(c.block.id))
      .map((c) => ({ candidate: c, start: valStart(next, layouts, c.item, anchor) }))
      .sort((a, b) => (before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0))

    for (const { candidate, start } of order) {
      const current = pins.get(candidate.block.id)
      if (current && current.date === start.date && current.hour === start.hour) continue
      const pinned = pinBlockAt(
        next,
        candidate.block.id,
        candidate.memberId,
        start.date,
        start.hour
      )
      if (keepBase && disturbs(pinned)) {
        // The rule gives way to the calendar: the VAL joins the end of its owner's work. One
        // already pinned by an earlier pass is on the calendar and counted, so it is only
        // unpinned — moving it to the end of its own queue drops the pin.
        unlinked.add(candidate.block.id)
        pins.delete(candidate.block.id)
        if (current) {
          const queue = next.queues[candidate.memberId] ?? []
          next = moveBlock(
            next,
            candidate.block.id,
            { kind: 'member', memberId: candidate.memberId },
            queue.length
          )
        } else {
          append(candidate)
        }
        changed = true
        continue
      }
      if (!current) {
        receivers.add(candidate.memberId)
        summary.placed++
      }
      next = pinned
      pins.set(candidate.block.id, start)
      changed = true
    }
    if (!changed) break
  }

  // A VAL whose DEV ends too close to the end of the sprint cannot start straight after it and
  // still finish. It goes as late as its owner's calendar allows instead — overlapping the DEV,
  // which the grid flags — and only back to the backlog when there is no room for it at all.
  const late = new Set<string>()
  for (const blockId of [...pins.keys()]) {
    const candidate = vals.find((c) => c.block.id === blockId)!
    if (
      drawnHours(layoutSprint(next, anchor), candidate.memberId, blockId) >=
      candidate.block.hours - 1e-9
    )
      continue

    const fallback = latestFit(next, anchor, candidate, keepBase ? disturbs : () => false)
    if (fallback) {
      next = fallback.sprint
      pins.set(blockId, fallback.start)
      late.add(blockId)
      continue
    }
    next = moveBlock(next, blockId, { kind: 'backlog' }, next.backlog.length)
    pins.delete(blockId)
    summary.placed--
    summary.tooBig++
  }
  summary.valsLate = late.size
  summary.valsChained = pins.size - late.size
  for (const blockId of pins.keys()) {
    const candidate = vals.find((c) => c.block.id === blockId)!
    pinnedNew.push({
      memberId: candidate.memberId,
      workItemId: candidate.item.id,
      rule: late.has(blockId) ? 'late-val' : 'val'
    })
  }

  // 4. Room given back — a VAL still waiting, one that did not fit — goes to the work that was
  // turned away for lack of it, in the same order as before.
  if (skipped.length > 0) {
    const layouts = layoutSprint(next, anchor)
    const room = new Map(
      Object.entries(layouts).map(([id, l]) => [id, round(l.availableHours - l.queuedHours)])
    )
    for (const candidate of skipped) {
      const left = room.get(candidate.memberId) ?? 0
      if (candidate.block.hours > left) continue
      room.set(candidate.memberId, round(left - candidate.block.hours))
      append(candidate)
      summary.tooBig--
    }
  }

  summary.people = receivers.size

  // 5. What happened to the work that was already there.
  const baseChanges: BaseChange[] = []
  const after = placementsOf(next, anchor, baseIds)
  for (const [blockId, was] of original) {
    const now = after.get(blockId)
    if (!now || now.signature === was.signature) continue
    const seen = new Set<number>()
    baseChanges.push({
      blockId,
      workItemId: was.workItemId,
      memberId: was.memberId,
      kind: now.pieces > was.pieces ? 'split' : 'moved',
      causes: pinnedNew
        .filter(
          (p) => p.memberId === was.memberId && !seen.has(p.workItemId) && seen.add(p.workItemId)
        )
        .map(({ workItemId, rule }) => ({ workItemId, rule }))
    })
  }

  return { sprint: next, summary, baseChanges }
}

/** The last day any of a person's existing work is drawn on, from the anchor on. */
function lastBaseDay(
  sprint: Sprint,
  anchor: ISODate,
  memberId: string,
  baseIds: Set<string>
): ISODate | null {
  let last: ISODate | null = null
  for (const segment of layoutSprint(sprint, anchor)[memberId]?.segments ?? []) {
    if (!baseIds.has(segment.blockId) || segment.fromHistory || segment.isDone) continue
    if (segment.date >= anchor && (last === null || segment.date > last)) last = segment.date
  }
  return last
}

/** How many of a block's hours the layout manages to draw ahead of the anchor. */
function drawnHours(
  layouts: Record<string, MemberLayout>,
  memberId: string,
  blockId: string
): number {
  return (layouts[memberId]?.segments ?? [])
    .filter((s) => s.blockId === blockId && !s.fromHistory && !s.isDone)
    .reduce((sum, s) => sum + s.hours, 0)
}

/** The days a person can have work pinned to from the anchor on: working, and not locked. */
function workingDaysFrom(
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
function sprintEnd(sprint: Sprint, memberId: string, anchor: ISODate): Point | null {
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
function latestFit(
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
function pinnedPlacements(layouts: Record<string, MemberLayout>, except?: string): string {
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
function freeGaps(
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
