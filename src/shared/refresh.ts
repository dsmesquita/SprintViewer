import { isContainerType } from './grouping'
import { appendToBacklog, removeBlocks, setBlockHours } from './blocks'
import { pinReportedAt } from './mutations'
import { layoutSprint, liveRecord, recordPast } from './scheduling'
import { completedHours, isReportedOnly, plannedHours, reportedHours } from './sizing'
import type { Block, ISODate, Segment, Sprint, WorkItem } from './types'
import { round } from './math'

/**
 * Reconciling the calendar with TFS.
 *
 * Two rules the whole feature rests on. A work item's blocks add up to its Remaining Work —
 * what is left, not what was planned. And the hours reported against it are drawn behind today
 * as a *record*: once a refresh has drawn a day that has passed, later refreshes leave what is
 * on it alone and only add the hours TFS reports on top, into free space, oldest gap first.
 *
 * Everything else follows. A task whose remaining work drops from eight hours to three keeps
 * its place in the queue and simply gets shorter, and because the layout engine flows the queue
 * with no gaps, every task behind it slides left or right to suit. That is the behaviour
 * asked for originally: update the remaining time and the day rearranges itself.
 */

export interface RefreshSummary {
  /** Work items whose remaining hours changed. */
  updated: number
  /** Work items that reached zero remaining hours and left the calendar. */
  completed: number
  /** Work items the query returned that the sprint had never seen. */
  added: number
  /** Work items the sprint holds that the query no longer returns. */
  missing: number
}

export interface RefreshResult {
  sprint: Sprint
  summary: RefreshSummary
}

export function applyRefresh(
  sprint: Sprint,
  items: WorkItem[],
  anchor: ISODate,
  newId: () => string
): RefreshResult {
  const summary: RefreshSummary = { updated: 0, completed: 0, added: 0, missing: 0 }

  // A sprint refreshed for the first time under the record rule starts its record from exactly
  // what it shows now, so nothing already on screen jumps.
  let next: Sprint = { ...sprint, pastRecord: sprint.pastRecord ?? recordPast(sprint, anchor) }

  const incoming = new Map(items.map((item) => [item.id, item]))
  const workItems: Record<number, WorkItem> = {}
  for (const [id, existing] of Object.entries(sprint.workItems)) {
    const fresh = incoming.get(Number(id))
    if (fresh) workItems[Number(id)] = { ...fresh, missingFromQuery: false }
    else {
      workItems[Number(id)] = { ...existing, missingFromQuery: true }
      if (hasBlocks(sprint, Number(id))) summary.missing++
    }
  }
  for (const item of items) if (!workItems[item.id]) workItems[item.id] = item
  next = { ...next, workItems, reportedPins: livePins(workItems, sprint.reportedPins) }

  // Blocks dropped by hand on a day that has passed said "this was worked then". TFS now says
  // how much was: that much becomes part of the record, in the same slot, and the block rejoins
  // the queue as what is left to do.
  next = settlePastPins(next, anchor)

  // Everything behind today, drawn with the new figures, is the record the next refresh builds
  // on: what was there stays, and new hours have gone into free space, oldest gap first. Taken
  // while every block is still in place, because a task's blocks are what say whose row its
  // hours belong on — a finished task is about to lose its own.
  next = { ...next, pastRecord: recordPast(next, anchor) }

  // A task with nothing left to do is only the hours reported against it, and those are drawn
  // on the days they were worked rather than taking up room ahead of today.
  const aligned = alignReportedOnly(next, anchor)
  next = aligned.sprint
  summary.completed += aligned.removed

  // Where every block currently sits, so a change can be aimed at the part of a split task
  // that comes first on the calendar. Computed once: the parts of one work item almost never
  // swap places with each other as their neighbours are resized.
  const positions = blockPositions(next, anchor)

  for (const item of items) {
    const parts = schedulable(next, item.id, positions)
    const owner = recordOwner(next, item.id)

    if (parts.length === 0 && owner === null) {
      // Stories and bugs are headings, not work, so a new one must not turn up in the
      // backlog as something to schedule. Neither must a task that arrives already finished:
      // its hours are drawn on the days they were worked, and a card for it would be an empty
      // one asking to be planned.
      if (!wasKnown(sprint, item.id) && !isContainerType(item.type) && !isReportedOnly(item)) {
        next = appendToBacklog(next, {
          id: newId(),
          workItemId: item.id,
          hours: plannedHours(item)
        })
        summary.added++
      }
      continue
    }

    const current = round(parts.reduce((sum, part) => sum + part.block.hours, 0))
    // What is left of it, or the hours reported against it when nothing is left — see
    // `sizing.ts`. A manual time overrules that, and stays put until the user is asked.
    const target = sprint.customHours?.[item.id] ?? plannedHours(item)
    if (current === target) continue

    if (target <= 0) {
      next = removeBlocks(
        next,
        parts.map((part) => part.block.id)
      )
      summary.completed++
      continue
    }

    next = resize(next, item.id, parts, target - current, owner, newId)
    summary.updated++
  }

  return { sprint: { ...next, lastRefreshedAt: new Date().toISOString() }, summary }
}

/**
 * Turns blocks pinned to days that have passed into recorded hours and unpins them.
 *
 * As many of the block's hours as TFS reports and the record does not already hold are
 * recorded exactly where the block is drawn. The block itself goes back to flowing from today:
 * whatever of it is still to do belongs ahead of today, and the resize that follows sets it to
 * the Remaining Work.
 */
export function settlePastPins(sprint: Sprint, anchor: ISODate): Sprint {
  const pinnedPast = Object.values(sprint.queues).some((queue) =>
    queue.some((block) => block.pin && block.pin.date < anchor)
  )
  if (!pinnedPast) return sprint

  const layouts = layoutSprint(sprint, anchor)
  const recorded = new Map<number, number>()
  for (const byDate of Object.values(liveRecord(sprint, anchor))) {
    for (const pieces of Object.values(byDate)) {
      for (const piece of pieces) {
        recorded.set(piece.workItemId, round((recorded.get(piece.workItemId) ?? 0) + piece.hours))
      }
    }
  }

  const record: NonNullable<Sprint['pastRecord']> = {}
  for (const [memberId, byDate] of Object.entries(sprint.pastRecord ?? {})) {
    record[memberId] = Object.fromEntries(
      Object.entries(byDate).map(([date, pieces]) => [date, [...pieces]])
    )
  }
  const queues: Record<string, Block[]> = {}

  for (const [memberId, queue] of Object.entries(sprint.queues)) {
    queues[memberId] = queue.map((block) => {
      if (!block.pin || block.pin.date >= anchor) return block
      const item = sprint.workItems[block.workItemId]
      let left = round((completedHours(item) ?? 0) - (recorded.get(block.workItemId) ?? 0))
      const drawn = (layouts[memberId]?.segments ?? [])
        .filter((s) => s.blockId === block.id && s.date < anchor && !s.isDone && !s.fromHistory)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour)
      for (const segment of drawn) {
        if (left <= 0) break
        const hours = Math.min(segment.hours, left)
        left = round(left - hours)
        const piece: Segment = {
          blockId: `done:${block.workItemId}`,
          workItemId: block.workItemId,
          date: segment.date,
          startHour: segment.startHour,
          hours,
          continued: false,
          continues: false,
          isDone: true
        }
        const days = (record[memberId] ??= {})
        days[segment.date] = [...(days[segment.date] ?? []), piece]
        recorded.set(block.workItemId, round((recorded.get(block.workItemId) ?? 0) + hours))
      }
      const { pin: _pin, ...unpinned } = block
      return unpinned
    })
  }

  return { ...sprint, queues, pastRecord: record }
}

/**
 * Takes the blocks away from tasks that are nothing but reported hours.
 *
 * Their hours belong behind today, where the layout draws every reported hour, so a block for
 * them would show the same work twice — once in the past and once ahead of today, which is
 * where an unpinned block flows to. Where the user had pinned one to a day already past, that
 * day is kept: the pin becomes the record of when those hours were worked.
 *
 * Runs at every refresh, and once over a sprint as it is loaded, which is what brings boards
 * built before this rule into line with it.
 */
export function alignReportedOnly(
  sprint: Sprint,
  anchor: ISODate
): { sprint: Sprint; removed: number } {
  let next = sprint
  let removed = 0

  for (const item of Object.values(sprint.workItems)) {
    // A manual time is the user overruling TFS about the size; it is not ours to undo.
    if (!isReportedOnly(item) || sprint.customHours?.[item.id] !== undefined) continue

    const blocks: Array<{ block: Block; memberId: string | null }> = []
    for (const [memberId, queue] of Object.entries(next.queues)) {
      for (const block of queue) if (block.workItemId === item.id) blocks.push({ block, memberId })
    }
    for (const block of next.backlog) {
      if (block.workItemId === item.id) blocks.push({ block, memberId: null })
    }
    if (blocks.length === 0) continue

    const recorded = blocks
      .filter(
        (entry) => entry.memberId !== null && entry.block.pin && entry.block.pin.date < anchor
      )
      .sort(
        (a, b) =>
          a.block.pin!.date.localeCompare(b.block.pin!.date) ||
          a.block.pin!.startHour - b.block.pin!.startHour
      )[0]
    if (recorded && next.reportedPins?.[item.id] === undefined) {
      next = pinReportedAt(
        next,
        item.id,
        recorded.memberId!,
        recorded.block.pin!.date,
        recorded.block.pin!.startHour
      )
    }
    next = removeBlocks(
      next,
      blocks.map((entry) => entry.block.id)
    )
    removed++
  }

  return { sprint: next, removed }
}

/**
 * Resizes one work item's blocks so they total `target`, leaving everything else alone.
 *
 * The same call a refresh makes, exposed because setting a manual time has to do exactly
 * this — grow the part earliest on the calendar, take from the latest — and two
 * implementations of that would drift apart within a release.
 */
export function resizeItemTo(
  sprint: Sprint,
  workItemId: number,
  target: number,
  anchor: ISODate,
  newId: () => string
): Sprint {
  const parts = schedulable(sprint, workItemId, blockPositions(sprint, anchor))
  const current = round(parts.reduce((sum, part) => sum + part.block.hours, 0))
  if (current === round(target)) return sprint
  if (target <= 0)
    return removeBlocks(
      sprint,
      parts.map((part) => part.block.id)
    )
  return resize(
    sprint,
    workItemId,
    parts,
    round(target) - current,
    recordOwner(sprint, workItemId),
    newId
  )
}

interface Part {
  block: Block
  memberId: string | null
}

/**
 * The blocks of a work item that still represent work to do, in calendar order: the part
 * earliest on someone's calendar first, anything still in the backlog last.
 *
 * That order is what the two directions of change are aimed at — extra hours go to the
 * earliest part, and hours taken away come off the latest. Spreading a change proportionally
 * across every part of a split task instead would move work the user placed by hand on days
 * they chose, which is a surprising thing for a refresh to do.
 */
function schedulable(sprint: Sprint, workItemId: number, positions: Map<string, Position>): Part[] {
  const scheduled: Part[] = []
  for (const member of sprint.members) {
    for (const block of sprint.queues[member.id] ?? []) {
      if (block.workItemId !== workItemId) continue
      scheduled.push({ block, memberId: member.id })
    }
  }

  scheduled.sort((a, b) => {
    const left = positions.get(a.block.id)
    const right = positions.get(b.block.id)
    if (!left || !right) return 0
    return left.date.localeCompare(right.date) || left.startHour - right.startHour
  })

  const loose: Part[] = sprint.backlog
    .filter((block) => block.workItemId === workItemId)
    .map((block) => ({ block, memberId: null }))

  return [...scheduled, ...loose]
}

interface Position {
  date: ISODate
  startHour: number
}

/** The first slot each block occupies, from a full layout of the sprint. */
function blockPositions(sprint: Sprint, anchor: ISODate): Map<string, Position> {
  const positions = new Map<string, Position>()
  for (const layout of Object.values(layoutSprint(sprint, anchor))) {
    for (const segment of layout.segments) {
      if (segment.fromHistory || segment.isDone) continue
      const best = positions.get(segment.blockId)
      if (
        !best ||
        segment.date < best.date ||
        (segment.date === best.date && segment.startHour < best.startHour)
      ) {
        positions.set(segment.blockId, { date: segment.date, startHour: segment.startHour })
      }
    }
  }
  return positions
}

function resize(
  sprint: Sprint,
  workItemId: number,
  parts: Part[],
  delta: number,
  owner: string | null,
  newId: () => string
): Sprint {
  if (delta > 0) {
    if (parts.length === 0) {
      // Only recorded hours remain on the calendar, so the work carried over. Give it back to
      // whoever was doing it rather than dropping it into the backlog for someone to find.
      const block: Block = { id: newId(), workItemId, hours: round(delta) }
      return owner
        ? {
            ...sprint,
            queues: { ...sprint.queues, [owner]: [...(sprint.queues[owner] ?? []), block] }
          }
        : appendToBacklog(sprint, block)
    }
    // Extra hours join the part that comes first on the calendar: the work grew, and it grows
    // where it is being done. If nothing is scheduled, the single merged backlog card takes it.
    const first = parts[0].block
    return setBlockHours(sprint, first.id, round(first.hours + delta))
  }

  // Shrinking cascades backwards: take it out of the last part, and if that part is used up,
  // keep going into the one before it.
  let left = -delta
  let next = sprint
  for (let index = parts.length - 1; index >= 0 && left > 0; index--) {
    const block = parts[index].block
    const take = Math.min(block.hours, left)
    left = round(left - take)
    const remaining = round(block.hours - take)
    next = remaining > 0 ? setBlockHours(next, block.id, remaining) : removeBlocks(next, [block.id])
  }
  return next
}

/** The member whose recorded past holds this work item's hours, if any. */
function recordOwner(sprint: Sprint, workItemId: number): string | null {
  for (const member of sprint.members) {
    const byDate = sprint.pastRecord?.[member.id] ?? {}
    for (const pieces of Object.values(byDate)) {
      if (pieces.some((piece) => piece.workItemId === workItemId)) return member.id
    }
  }
  return null
}

/**
 * Reported-hour pins that still refer to something.
 *
 * A pin says when a work item's Completed Work was worked. Once TFS reports none — the field
 * was cleared, or the item is gone — the pin is about nothing, and keeping it would silently
 * place hours again the day somebody re-enters them.
 */
function livePins(
  workItems: Record<number, WorkItem>,
  pins: Sprint['reportedPins']
): NonNullable<Sprint['reportedPins']> {
  const kept: NonNullable<Sprint['reportedPins']> = {}
  for (const [key, pin] of Object.entries(pins ?? {})) {
    const item = workItems[Number(key)]
    if (item && reportedHours(item) > 0) kept[Number(key)] = pin
  }
  return kept
}

function wasKnown(sprint: Sprint, workItemId: number): boolean {
  return sprint.workItems[workItemId] !== undefined
}

function hasBlocks(sprint: Sprint, workItemId: number): boolean {
  return (
    sprint.backlog.some((block) => block.workItemId === workItemId) ||
    Object.values(sprint.queues).some((queue) =>
      queue.some((block) => block.workItemId === workItemId)
    )
  )
}
