import { memberFor } from './assignment'
import { isContainerType } from './grouping'
import { reportedHours } from './sizing'
import type { Sprint, WorkItem } from './types'

/**
 * A task's done hours and its remaining hours, handled apart.
 *
 * The remaining hours are a block: a card in the backlog, or a block on the calendar from today
 * on. The done hours are drawn behind today on their own. For a task already on the calendar
 * that happens by itself. For one still in the backlog the user chooses: have them drawn on the
 * calendar, where their owner worked them, or keep them in the backlog as a card of their own,
 * to drag onto the day they were really done.
 *
 * `sprint.doneInBacklog` lists the tasks whose done hours wait in the backlog; nothing of them
 * is drawn until they are placed. `sprint.doneDecided` lists the tasks already asked about, so
 * each is asked once.
 */

/** The tasks whose done hours wait in the backlog, as cards. */
export function doneWaiting(sprint: Sprint): WorkItem[] {
  return (sprint.doneInBacklog ?? [])
    .map((id) => sprint.workItems[id])
    .filter((item): item is WorkItem => item !== undefined && reportedHours(item) > 0)
}

/**
 * The tasks to ask about after a refresh or an import: not on the calendar, with hours done by
 * someone on the team, and not asked about before. A task on the calendar needs no question —
 * its done hours are drawn where its work is — and one done by someone off the team has no row
 * to be drawn on.
 */
export function doneToDecide(sprint: Sprint): number[] {
  const onCalendar = new Set(
    Object.values(sprint.queues)
      .flat()
      .map((block) => block.workItemId)
  )
  const decided = new Set([...(sprint.doneDecided ?? []), ...(sprint.doneInBacklog ?? [])])
  return Object.values(sprint.workItems)
    .filter(
      (item) =>
        !isContainerType(item.type) &&
        !onCalendar.has(item.id) &&
        !decided.has(item.id) &&
        sprint.reportedPins?.[item.id] === undefined &&
        reportedHours(item) > 0 &&
        memberFor(sprint.members, item.assignedTo) !== undefined
    )
    .map((item) => item.id)
    .sort((a, b) => a - b)
}

/** The answer "keep them in the backlog": their done hours wait there as cards. */
export function keepDoneInBacklog(sprint: Sprint, ids: number[]): Sprint {
  if (ids.length === 0) return sprint
  return {
    ...sprint,
    doneInBacklog: union(sprint.doneInBacklog, ids),
    doneDecided: union(sprint.doneDecided, ids)
  }
}

/** The answer "place them on the calendar": drawn where their owner worked them. */
export function placeDone(sprint: Sprint, ids: number[]): Sprint {
  if (ids.length === 0) return sprint
  return {
    ...sprint,
    doneInBacklog: (sprint.doneInBacklog ?? []).filter((id) => !ids.includes(id)),
    doneDecided: union(sprint.doneDecided, ids)
  }
}

/**
 * Done hours dragged onto the backlog: they leave the calendar and wait there as a card.
 * Whatever pinned them to a day goes with them.
 */
export function returnDoneToBacklog(sprint: Sprint, workItemId: number): Sprint {
  if ((sprint.doneInBacklog ?? []).includes(workItemId)) return sprint
  const reportedPins = { ...(sprint.reportedPins ?? {}) }
  delete reportedPins[workItemId]
  return {
    ...sprint,
    reportedPins,
    doneInBacklog: union(sprint.doneInBacklog, [workItemId]),
    doneDecided: union(sprint.doneDecided, [workItemId])
  }
}

function union(list: number[] | undefined, ids: number[]): number[] {
  return [...new Set([...(list ?? []), ...ids])]
}
