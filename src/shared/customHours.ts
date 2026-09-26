import { resizeItemTo } from './refresh'
import { plannedHours } from './sizing'
import type { ISODate, Sprint, WorkItem } from './types'

/**
 * Overruling TFS about how long a task is.
 *
 * The figures the server gives — estimate, remaining, completed — are usually the best
 * account of a task's size, but not always: an estimate nobody revisited, or work everyone
 * knows is larger than the ticket says. A manual time says "plan for this instead", and it
 * holds until a refresh brings a new figure and the user is asked what to do about it.
 */

/** Sets a manual time and resizes the task's blocks to total it. */
export function setCustomHours(
  sprint: Sprint,
  workItemId: number,
  hours: number,
  anchor: ISODate,
  newId: () => string
): Sprint {
  if (!Number.isFinite(hours) || hours <= 0) return sprint
  const rounded = Math.round(hours * 100) / 100
  const withCustom: Sprint = {
    ...sprint,
    customHours: { ...(sprint.customHours ?? {}), [workItemId]: rounded }
  }
  return resizeItemTo(withCustom, workItemId, rounded, anchor, newId)
}

/** Drops the manual time and puts the task back to whatever TFS says it is. */
export function clearCustomHours(
  sprint: Sprint,
  workItemId: number,
  anchor: ISODate,
  newId: () => string
): Sprint {
  if (sprint.customHours?.[workItemId] === undefined) return sprint
  const custom = { ...sprint.customHours }
  delete custom[workItemId]
  const item = sprint.workItems[workItemId]
  const withoutCustom: Sprint = { ...sprint, customHours: custom }
  if (!item) return withoutCustom
  return resizeItemTo(withoutCustom, workItemId, plannedHours(item), anchor, newId)
}

/** A manual time that the figures just fetched from TFS disagree with. */
export interface CustomConflict {
  workItemId: number
  title: string
  /** The number the user set. */
  yours: number
  /** What TFS now says the task is worth. */
  theirs: number
}

/**
 * Manual times that a set of freshly fetched work items disagrees with.
 *
 * Only disagreements: a manual time that happens to match what TFS now says needs no
 * decision, and asking about it would train the user to click through the dialog.
 */
export function customConflicts(sprint: Sprint, items: WorkItem[]): CustomConflict[] {
  const custom = sprint.customHours ?? {}
  const conflicts: CustomConflict[] = []
  for (const item of items) {
    const yours = custom[item.id]
    if (yours === undefined) continue
    const theirs = plannedHours(item)
    if (theirs === yours) continue
    conflicts.push({ workItemId: item.id, title: item.title, yours, theirs })
  }
  return conflicts.sort((a, b) => a.workItemId - b.workItemId)
}

/**
 * What to do about one of them. `keep` leaves the manual time alone, `theirs` drops it for
 * the TFS figure, and `set` replaces it with a number typed after seeing both.
 */
export type CustomChoice = { kind: 'keep' } | { kind: 'theirs' } | { kind: 'set'; hours: number }

/** Applies one decision per conflict, in one pass. */
export function applyCustomChoices(
  sprint: Sprint,
  choices: Map<number, CustomChoice>,
  anchor: ISODate,
  newId: () => string
): Sprint {
  let next = sprint
  for (const [workItemId, choice] of choices) {
    if (choice.kind === 'keep') continue
    next =
      choice.kind === 'theirs'
        ? clearCustomHours(next, workItemId, anchor, newId)
        : setCustomHours(next, workItemId, choice.hours, anchor, newId)
  }
  return next
}
