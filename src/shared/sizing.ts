import type { Sprint, WorkItem } from './types'

/**
 * How much space a work item takes on the board.
 *
 * A task is worth **Remaining Work + Completed Work**, wherever it is — on a calendar, in the
 * backlog, or split across both and several people. That is the whole of it: what is left plus
 * what has been done. The two parts are drawn either side of today, so the total never changes
 * as work is reported; only where it sits does.
 *
 * | Reported (Completed Work) | Remaining | Ahead of today | Drawn as done |
 * | ------------------------- | --------- | -------------- | ------------- |
 * | any                       | some      | Remaining Work | Reported      |
 * | any                       | none      | nothing        | Reported      |
 * | none                      | none      | nothing        | —             |
 *
 * Which side of today each part falls on is the whole point. Reported hours have already
 * happened, so they are drawn on the days that have passed — or on today when there are more of
 * them than those days can hold. Remaining work has not happened, so it is drawn from today on.
 * A task part done is therefore two pieces: the hours behind today and the hours ahead of it.
 *
 * **Original Estimate is not part of this.** It is what somebody guessed beforehand, and using
 * it to size a task means the board shows the guess rather than the work. It is kept for the
 * sprint summary, which uses it to say which tasks went off track — see {@link isOffTrack}.
 */

export interface Size {
  /** Hours the item needs on the calendar. What a block of it is worth. */
  planned: number
  /** Hours already reported in TFS, drawn before today. Zero when they are the block. */
  reported: number
}

export function sizeOf(item: WorkItem): Size {
  return { planned: atLeastZero(item.remainingWork), reported: atLeastZero(item.completedWork) }
}

/**
 * How much longer a task took than it was given, as a fraction of the estimate. Beyond this it
 * is worth looking at: an estimate is a guess, and a guess is not wrong by a quarter.
 */
export const OFF_TRACK_RATIO = 1.25

/**
 * True when more was spent on a task than its Original Estimate allowed for, by enough to mean
 * something. The only thing the estimate is used for, and only in the sprint summary — never to
 * size anything on the board.
 */
export function isOffTrack(item: WorkItem | undefined): boolean {
  const estimate = atLeastZero(item?.originalEstimate)
  const reported = atLeastZero(item?.completedWork)
  return estimate > 0 && reported > estimate * OFF_TRACK_RATIO
}

/** Hours the item still needs ahead of today: Remaining Work, and nothing else. */
export function plannedHours(item: WorkItem): number {
  return sizeOf(item).planned
}

/**
 * The same, but honouring a manual time if one has been set for this work item.
 *
 * Anything asking "how big is this task" from inside a sprint should ask this rather than
 * {@link plannedHours}, or it will disagree with the calendar.
 */
export function plannedHoursIn(sprint: Sprint, workItemId: number): number {
  const custom = sprint.customHours?.[workItemId]
  if (custom !== undefined) return custom
  const item = sprint.workItems[workItemId]
  return item ? sizeOf(item).planned : 0
}

/** True when this work item's size was set by hand rather than read from TFS. */
export function hasCustomHours(sprint: Sprint, workItemId: number): boolean {
  return sprint.customHours?.[workItemId] !== undefined
}

/** Hours already reported against the item in TFS, drawn before today. */
export function reportedHours(item: WorkItem): number {
  return sizeOf(item).reported
}

/** The item's whole span: what was done plus what is left. */
export function totalHours(item: WorkItem): number {
  const size = sizeOf(item)
  return round(size.planned + size.reported)
}

/**
 * True when a task is nothing but the hours reported against it: none left to do, some done.
 *
 * Such a task has no block at all — its hours are drawn on the days they were worked, behind
 * today, like every other reported hour. {@link alignReportedOnly} is what takes the block
 * away when a task reaches this state.
 */
export function isReportedOnly(item: WorkItem): boolean {
  return atLeastZero(item.completedWork) > 0 && atLeastZero(item.remainingWork) <= 0
}

/**
 * Hours TFS says were actually completed, or `undefined` when the server does not track the
 * field at all.
 *
 * This is what justifies a task's presence on a day that has already passed: work in the past
 * happened, and Completed Work is the only record of what happened. It differs from
 * {@link reportedHours}, which is zero for a task whose reported hours have *become* its
 * block — there the hours are still justified, they are simply drawn as the block itself.
 *
 * The undefined case matters: without it, a server with no Completed Work field would judge
 * every past day unjustified and empty the whole record.
 */
export function completedHours(item: WorkItem | undefined): number | undefined {
  if (!item || item.completedWork === undefined) return undefined
  return atLeastZero(item.completedWork)
}

/** True when nothing anywhere gives the item a size, so there is nothing to draw or drag. */
export function hasNoSize(item: WorkItem): boolean {
  const size = sizeOf(item)
  return size.planned <= 0 && size.reported <= 0
}

function atLeastZero(value: number | undefined): number {
  return value === undefined || value <= 0 ? 0 : round(value)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
