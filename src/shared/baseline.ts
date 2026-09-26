import type { SnapshotMeta } from './snapshots'
import type { ISODate, Sprint } from './types'

/**
 * The sprint's plan, kept automatically.
 *
 * What a sprint is measured against is the board as it stood once planning was done, and
 * nobody remembers to take that snapshot on the day. So the app takes it: on the first working
 * day it keeps replacing it as the plan is worked out, and from the second working day on it is
 * left alone — it is then the plan as it stood at the end of planning day.
 */

export const BASELINE_NAME = 'Sprint start'

export type BaselineAction = 'none' | 'take' | 'replace'

/** The sprint's first working day — the planning day. */
export function planningDay(sprint: Sprint): ISODate | undefined {
  return sprint.days.find((day) => day.capacity > 0)?.date
}

/** Whether anything is on anybody's calendar. An empty board is not a plan yet. */
function hasPlan(sprint: Sprint): boolean {
  return Object.values(sprint.queues).some((queue) => queue.length > 0)
}

/**
 * What to do about the baseline, given the board and whether one exists.
 *
 * Nothing before the planning day, and nothing while the board is empty. On the planning day a
 * baseline is taken, and replaced by every later change that day. After it, one is only ever
 * taken if there is none at all — for a sprint that was already under way, or whose baseline
 * was deleted — and then never replaced.
 */
export function baselineAction(
  sprint: Sprint,
  today: ISODate,
  existing: SnapshotMeta | undefined
): BaselineAction {
  const first = planningDay(sprint)
  if (!first || today < first || !hasPlan(sprint)) return 'none'
  if (!existing) return 'take'
  return today === first ? 'replace' : 'none'
}

/** The name it is saved under, saying so when it was taken after the plan was already moving. */
export function baselineName(sprint: Sprint, today: ISODate): string {
  const first = planningDay(sprint)
  return first && today > first ? `${BASELINE_NAME} (taken mid-sprint, ${today})` : BASELINE_NAME
}
