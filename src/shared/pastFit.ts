import { splitInPlace, unpinBlock } from './mutations'
import { layoutSprint } from './scheduling'
import { completedHours } from './sizing'
import type { ISODate, Sprint } from './types'

/**
 * Making room in the past for work that actually happened.
 *
 * Days that have passed should hold what was done, and Completed Work is the only record of
 * that. A task sitting on a past day with no hours reported against it did not happen there,
 * whatever the plan said at the time — and while it holds that space, the hours that *were*
 * reported have nowhere to be drawn.
 *
 * The snapshot from a refresh gives way on its own, in the layout. Blocks pinned by hand are
 * a different matter: they are real, they were put there deliberately, and moving one is a
 * change to the plan. So this module names them and offers, rather than acting.
 */

export interface PastOffender {
  blockId: string
  workItemId: number
  /** Hours it holds in the past that Completed Work does not account for. */
  excess: number
  /** Hours of it that are accounted for, and so stay where they are. */
  justified: number
}

export interface PastConflict {
  memberId: string
  memberName: string
  /** Reported hours with nowhere to go before today. */
  missing: number
  offenders: PastOffender[]
  /** How much moving every offender forward would free. */
  freeable: number
  /**
   * True when freeing everything still would not be enough. The numbers themselves are then
   * inconsistent — more hours reported against past days than those days ever held — and no
   * rearranging can fix it.
   */
  impossible: boolean
}

/** Everyone whose reported hours will not fit in the days that have passed. */
export function pastConflicts(sprint: Sprint, anchor: ISODate): PastConflict[] {
  const layouts = layoutSprint(sprint, anchor)
  const conflicts: PastConflict[] = []

  for (const member of sprint.members) {
    const layout = layouts[member.id]
    const missing = round((layout?.reportedOverflow ?? []).reduce((sum, o) => sum + o.hours, 0))
    if (missing <= 0) continue

    // How much of the past each pinned block is holding, against how much it has earned.
    const held = new Map<string, number>()
    for (const segment of layout.segments) {
      if (!segment.pinned || segment.date >= anchor) continue
      held.set(segment.blockId, round((held.get(segment.blockId) ?? 0) + segment.hours))
    }

    const offenders: PastOffender[] = []
    for (const [blockId, hours] of held) {
      const block = (sprint.queues[member.id] ?? []).find((b) => b.id === blockId)
      if (!block) continue
      const done = completedHours(sprint.workItems[block.workItemId])
      // A server that does not track Completed Work cannot judge anybody.
      if (done === undefined) continue
      const justified = Math.min(hours, done)
      const excess = round(hours - justified)
      if (excess > 0) offenders.push({ blockId, workItemId: block.workItemId, excess, justified })
    }

    const freeable = round(offenders.reduce((sum, o) => sum + o.excess, 0))
    conflicts.push({
      memberId: member.id,
      memberName: member.name,
      missing,
      offenders,
      freeable,
      impossible: freeable < missing
    })
  }
  return conflicts
}

/**
 * Moves the unearned part of every offending block out of the past and back into the plan.
 *
 * Only the unearned part: a block holding eight hours with three reported against it keeps
 * those three where they are and sends the other five forward, because the three did happen
 * and the calendar should go on saying so.
 */
export function freePastSpace(sprint: Sprint, anchor: ISODate, newId: () => string): Sprint {
  let next = sprint
  for (const conflict of pastConflicts(sprint, anchor)) {
    for (const offender of conflict.offenders) {
      next =
        offender.justified <= 0
          ? // Nothing about it is earned, so the whole block rejoins the queue and flows.
            unpinBlock(next, offender.blockId)
          : splitInPlace(next, offender.blockId, offender.justified, newId)
    }
  }
  return next
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
