import { layoutMember, splitBlock } from './scheduling'
import type { Block, ISODate, Sprint } from './types'
import {
  findBlock,
  insertBlock,
  insertIntoBacklog,
  removeBlocks,
  replaceBlock,
  type Location
} from './blocks'
import { clamp, round } from './math'

// Where a block lives, and how to find it, are part of this module's vocabulary too.
export { findBlock, type BlockPosition, type Location } from './blocks'

/**
 * Pure transforms of a sprint. Every scheduling action the user takes is one of these:
 * they take a sprint and return a new one, with fresh arrays for anything that changed so
 * React sees the update. Nothing here touches disk or the network.
 */

/**
 * Moves a block to `to`, at `index` within its new home.
 *
 * Moving within one queue accounts for the block's own removal, so dropping a block one
 * place to the right lands where the user pointed rather than one short of it.
 */
export function moveBlock(sprint: Sprint, blockId: string, to: Location, index: number): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found) return sprint

  // An ordinary move puts the block back under the queue's control. Dragging a pinned block
  // to a new place is how you unpin it.
  const { pin: _pin, ...moved } = found.block
  const withoutBlock = removeBlocks(sprint, [blockId])
  const sameList =
    found.location.kind === to.kind &&
    (to.kind === 'backlog' ||
      (found.location.kind === 'member' && found.location.memberId === to.memberId))
  const target = sameList && index > found.index ? index - 1 : index

  return insertBlock(withoutBlock, moved, to, target)
}

/**
 * Fixes a block to a slot on a person's calendar, moving it there if it lived somewhere else.
 *
 * This is the gesture for recording work that has already happened: the block stops flowing
 * with the queue and holds the day and hour it was dropped on.
 */
export function pinBlockAt(
  sprint: Sprint,
  blockId: string,
  memberId: string,
  date: ISODate,
  startHour: number
): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found) return sprint

  const pinnedBlock: Block = { ...found.block, pin: { date, startHour: Math.max(0, startHour) } }
  const withoutBlock = removeBlocks(sprint, [blockId])
  const alreadyThere =
    found.location.kind === 'member' && found.location.memberId === memberId
      ? found.index
      : (withoutBlock.queues[memberId]?.length ?? 0)

  return insertBlock(withoutBlock, pinnedBlock, { kind: 'member', memberId }, alreadyThere)
}

/**
 * Says where a work item's reported hours were actually worked.
 *
 * Reported hours are drawn from Completed Work rather than from a block, so there is nothing
 * to move — the pin is the whole record, and the layout draws the hours forwards from it.
 */
export function pinReportedAt(
  sprint: Sprint,
  workItemId: number,
  memberId: string,
  date: ISODate,
  startHour: number
): Sprint {
  return {
    ...sprint,
    reportedPins: {
      ...(sprint.reportedPins ?? {}),
      [workItemId]: { memberId, date, startHour: Math.max(0, startHour) }
    }
  }
}

/** Hands a work item's reported hours back to the automatic packing. */
export function unpinReported(sprint: Sprint, workItemId: number): Sprint {
  if (sprint.reportedPins?.[workItemId] === undefined) return sprint
  const reportedPins = { ...sprint.reportedPins }
  delete reportedPins[workItemId]
  return { ...sprint, reportedPins }
}

/** Hands a pinned block back to the queue, where it flows with everything else. */
export function unpinBlock(sprint: Sprint, blockId: string): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found?.block.pin) return sprint
  const { pin: _pin, ...unpinned } = found.block
  return replaceBlock(sprint, blockId, unpinned)
}

/**
 * Splits a block, keeping `keepHours` where it is and sending the rest to the backlog.
 *
 * This is the "I only want two of these six hours today" action: the calendar keeps the
 * part that fits and the remainder becomes available to schedule again, for this person or
 * anyone else.
 */
export function splitAndReturn(
  sprint: Sprint,
  blockId: string,
  keepHours: number,
  newId: () => string
): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found) return sprint
  if (keepHours <= 0 || keepHours >= found.block.hours) return sprint

  const [kept, remainder] = splitBlock(found.block, keepHours, newId)
  const withKept = replaceBlock(sprint, blockId, kept)
  return insertBlock(withKept, remainder, { kind: 'backlog' }, withKept.backlog.length)
}

/**
 * Splits a block into N parts. The first part stays where the block was; each subsequent part
 * goes to the backlog. Parts with equal hours, remainder added to the first.
 */
export function splitIntoN(
  sprint: Sprint,
  blockId: string,
  parts: number[],
  newId: () => string
): Sprint {
  if (parts.length < 2) return sprint
  const found = findBlock(sprint, blockId)
  if (!found) return sprint

  // Build all new blocks: first keeps the original id (via replaceBlock), rest are new.
  const firstHours = parts[0]
  const restParts = parts.slice(1)

  const firstBlock: Block = { ...found.block, hours: firstHours }
  let next = replaceBlock(sprint, blockId, firstBlock)
  for (const h of restParts) {
    const remainder: Block = { id: newId(), workItemId: found.block.workItemId, hours: h }
    next = insertBlock(next, remainder, { kind: 'backlog' }, next.backlog.length)
  }
  return next
}

/**
 * Locks a day so drops are rejected and clear/refresh skip it. A block that runs into the
 * locked day from the days before is split where that day starts, so no block spans it.
 */
export function lockDay(
  sprint: Sprint,
  date: ISODate,
  anchor: ISODate,
  newId: () => string
): Sprint {
  const lockedDays = [...(sprint.lockedDays ?? []), date].filter(
    (d, i, arr) => arr.indexOf(d) === i
  )
  let next: Sprint = { ...sprint, lockedDays }

  // A block still running when the locked day starts is cut there: what it covers before that
  // day stays, the rest goes to the backlog. Only a piece that *continues* onto the locked day
  // counts — one that starts on it was placed there before the lock, and is left alone.
  for (const member of sprint.members) {
    const { segments } = layoutMember(next, member.id, anchor)
    const running = segments.filter(
      (segment) =>
        segment.date === date && segment.continued && !segment.isDone && !segment.fromHistory
    )
    for (const segment of running) {
      const before = segments
        .filter(
          (s) => s.blockId === segment.blockId && s.date < date && !s.isDone && !s.fromHistory
        )
        .reduce((sum, s) => sum + s.hours, 0)
      next = splitAndReturn(next, segment.blockId, before, newId)
    }
  }

  return next
}

/** Removes a day from the locked set. */
export function unlockDay(sprint: Sprint, date: ISODate): Sprint {
  return { ...sprint, lockedDays: (sprint.lockedDays ?? []).filter((d) => d !== date) }
}

/**
 * Empties the calendar: every block goes back to the backlog and the frozen history is
 * discarded, leaving the sprint as it was the moment after import.
 *
 * Pins are dropped on the way, since a pin is a statement about a slot the block no longer
 * occupies. Blocks go through `insertIntoBacklog`, so parts of a task that were split across
 * days or people rejoin as one card — starting again should not leave the wreckage of the
 * plan being cleared.
 *
 * Blocks pinned to locked days are left in place — the lock survives a clear.
 */
export function clearCalendar(sprint: Sprint): Sprint {
  const locked = new Set(sprint.lockedDays ?? [])
  let backlog = sprint.backlog
  const queues: Record<string, Block[]> = {}
  for (const member of sprint.members) {
    const kept: Block[] = []
    for (const block of sprint.queues[member.id] ?? []) {
      if (block.pin && locked.has(block.pin.date)) {
        kept.push(block)
      } else {
        const { pin: _pin, ...unpinned } = block
        backlog = insertIntoBacklog(backlog, unpinned, backlog.length)
      }
    }
    queues[member.id] = kept
  }
  return { ...sprint, queues, backlog, history: {}, reportedPins: {}, pastRecord: undefined }
}

/**
 * Changes how many hours a working day holds, and rescales the sprint around it.
 *
 * A day the user marked off stays off and a half day stays half: the capacities they set are
 * statements about a *proportion* of the day, so they scale with it rather than surviving as
 * the raw number of hours they happened to be. Pins are pulled back inside the shorter day for
 * the same reason — a pin at hour 7 of a six-hour day is nowhere at all.
 */
export function setHoursPerDay(sprint: Sprint, hoursPerDay: number): Sprint {
  const next = clamp(Math.round(hoursPerDay), 1, 24)
  const previous = sprint.hoursPerDay
  if (next === previous || previous <= 0) return sprint

  const scale = (capacity: number): number =>
    capacity <= 0
      ? 0
      : capacity >= previous
        ? next
        : clamp(round(capacity * (next / previous)), 0, next)

  const capacityOverrides: Sprint['capacityOverrides'] = {}
  for (const [memberId, byDate] of Object.entries(sprint.capacityOverrides)) {
    const scaled: Record<ISODate, number> = {}
    for (const [date, capacity] of Object.entries(byDate)) scaled[date] = scale(capacity)
    capacityOverrides[memberId] = scaled
  }

  const lastHour = next - 1
  const queues: Record<string, Block[]> = {}
  for (const [memberId, queue] of Object.entries(sprint.queues)) {
    queues[memberId] = queue.map((block) =>
      block.pin && block.pin.startHour > lastHour
        ? { ...block, pin: { ...block.pin, startHour: lastHour } }
        : block
    )
  }

  const reportedPins: NonNullable<Sprint['reportedPins']> = {}
  for (const [key, pin] of Object.entries(sprint.reportedPins ?? {})) {
    reportedPins[Number(key)] = pin.startHour > lastHour ? { ...pin, startHour: lastHour } : pin
  }

  // Frozen history is replayed verbatim rather than re-flowed, so a snapshot of an eight-hour
  // day would keep drawing eight hours across a six-hour column and spill into the next day.
  // Trimmed to the new day instead: the record is of a day that no longer has that shape, and
  // showing it over the top of its neighbour would say something plainly untrue about both.
  const trim = (frozen: Sprint['history']): Sprint['history'] => {
    const out: Sprint['history'] = {}
    for (const [memberId, byDate] of Object.entries(frozen)) {
      const days: Record<ISODate, (typeof byDate)[string]> = {}
      for (const [date, segments] of Object.entries(byDate)) {
        days[date] = segments
          .filter((segment) => segment.startHour < next)
          .map((segment) =>
            segment.startHour + segment.hours > next
              ? { ...segment, hours: round(next - segment.startHour), continues: true }
              : segment
          )
      }
      out[memberId] = days
    }
    return out
  }
  const history = trim(sprint.history)
  const pastRecord = sprint.pastRecord ? trim(sprint.pastRecord) : undefined

  return {
    ...sprint,
    hoursPerDay: next,
    days: sprint.days.map((day) => ({ ...day, capacity: scale(day.capacity) })),
    capacityOverrides,
    queues,
    reportedPins,
    history,
    pastRecord
  }
}

/** What a clear would remove, for the confirmation to state before it happens. */
export function clearCalendarCost(sprint: Sprint): { blocks: number; recordedDays: number } {
  const blocks = Object.values(sprint.queues).reduce((sum, queue) => sum + queue.length, 0)
  const days = new Set<ISODate>()
  for (const byDate of [
    ...Object.values(sprint.history),
    ...Object.values(sprint.pastRecord ?? {})
  ]) {
    for (const [date, segments] of Object.entries(byDate)) {
      if (segments.length > 0) days.add(date)
    }
  }
  return { blocks, recordedDays: days.size }
}

/**
 * Cuts a block in two where it stands, both halves staying in the same queue, one after the
 * other. Unlike {@link splitAndReturn} nothing goes back to the backlog: this is the split
 * that makes room for something dropped into the middle of a task, so the hours have to stay
 * exactly where they were and simply part around the newcomer.
 */
export function splitInPlace(
  sprint: Sprint,
  blockId: string,
  atHours: number,
  newId: () => string
): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found || found.location.kind !== 'member') return sprint
  if (atHours <= 0 || atHours >= found.block.hours) return sprint

  const [first, second] = splitBlock(found.block, atHours, newId)
  const queue = [...(sprint.queues[found.location.memberId] ?? [])]
  queue.splice(found.index, 1, first, second)
  return { ...sprint, queues: { ...sprint.queues, [found.location.memberId]: queue } }
}

export function setDayCapacity(
  sprint: Sprint,
  date: ISODate,
  capacity: number,
  label?: string
): Sprint {
  return {
    ...sprint,
    days: sprint.days.map((day) =>
      day.date === date ? { ...day, capacity: clamp(capacity, 0, sprint.hoursPerDay), label } : day
    )
  }
}

/** Sets one person's capacity for one day. `null` clears the override. */
export function setMemberCapacity(
  sprint: Sprint,
  memberId: string,
  date: ISODate,
  capacity: number | null
): Sprint {
  const forMember = { ...(sprint.capacityOverrides[memberId] ?? {}) }
  if (capacity === null) delete forMember[date]
  else forMember[date] = clamp(capacity, 0, sprint.hoursPerDay)

  return {
    ...sprint,
    capacityOverrides: { ...sprint.capacityOverrides, [memberId]: forMember }
  }
}
