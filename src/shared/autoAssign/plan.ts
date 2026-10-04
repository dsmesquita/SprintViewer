import { doneWaiting, placeDone } from '../doneHours'
import { isContainerType } from '../grouping'
import { moveBlock, pinBlockAt } from '../mutations'
import { layoutSprint } from '../scheduling'
import type { ISODate, Sprint } from '../types'
import { round } from '../math'
import type {
  AssignSummary,
  AssignRule,
  BaseChange,
  AssignPlan,
  AssignOptions,
  Candidate
} from './types'
import { isMeeting, isChainedVal } from './kinds'
import { compareForAssignment, ownerOf } from './ordering'
import { lastWorkingDay, meetingDays, placeMeeting, runsIntoLastAfternoon } from './meetings'
import { type Point, before, valStart, devUnplanned, drawnHours, latestFit } from './valChain'

/** How many times VAL placements are revisited when placing one pushes another DEV later. */
export const MAX_VAL_PASSES = 12

/** Every base block's position, as a string that changes when any part of it moves. */
export function placementsOf(
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
    meetingsTooLate: 0,
    valsChained: 0,
    valsLate: 0,
    waitingForDev: 0,
    donePlaced: 0
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

  // 1. Meetings, spread over the sprint — never into the afternoon of its last working day,
  // which is for the review and the retrospective. A piece too long for that morning sends the
  // whole meeting over the other days instead.
  const lastDay = lastWorkingDay(sprint)
  for (const candidate of accepted.filter((c) => c.kind === 'meeting')) {
    const place = (days: ISODate[]) => {
      const placed = placeMeeting(next, candidate.block, candidate.memberId, days, newId)
      if (
        !placed ||
        !runsIntoLastAfternoon(placed.sprint, candidate.memberId, placed.pieces, anchor)
      )
        return placed
      return placeMeeting(
        next,
        candidate.block,
        candidate.memberId,
        days.filter((day) => day !== lastDay),
        newId
      )
    }
    const days = meetingDays(next, candidate.memberId, anchor)
    let placed = place(days)
    if (placed && keepBase && disturbs(placed.sprint)) {
      // Only days after this person's existing work can take a pin without moving any of it.
      const last = lastBaseDay(next, anchor, candidate.memberId, baseIds)
      placed = place(days.filter((day) => last === null || day > last))
      if (placed && disturbs(placed.sprint)) placed = null
    }
    if (!placed && days.length > 0 && days.every((day) => day === lastDay)) {
      // The last day is all that is left, and its morning is too short: as ordinary work it
      // would run into the afternoon all the same, so it waits in the backlog.
      summary.meetingsTooLate++
      continue
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

  // 5. Done hours waiting in the backlog go onto their owner's row, where they were worked.
  // Drawing them can push today's plan along, so with the calendar held fixed only those that
  // move nothing already there.
  for (const item of doneWaiting(next)) {
    if (!ownerOf(next, item)) continue
    const placed = placeDone(next, [item.id])
    if (keepBase && disturbs(placed)) continue
    next = placed
    summary.donePlaced++
  }

  // 6. What happened to the work that was already there.
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
export function lastBaseDay(
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
