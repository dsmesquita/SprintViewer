import type { Block, Sprint } from './types'

/**
 * Tasks hidden from the backlog: deprecated items, work nobody on the squad will pick up — the
 * cards that would otherwise be scrolled past at every planning. Hiding is a view of the
 * backlog, not a verdict on the task: auto-assign still places a hidden task like any other.
 *
 * The mark belongs to the task while it waits in the backlog. Placing it on a calendar, by hand
 * or by auto-assign, removes the mark, so a task sent back to the backlog later is shown again
 * unless it is hidden again.
 */

/** The tasks hidden from the backlog. */
export function hiddenInBacklog(sprint: Sprint): Set<number> {
  return new Set(sprint.hiddenBacklog ?? [])
}

/** The backlog cards that count: everything but the hidden ones. */
export function shownBacklog(sprint: Sprint): Block[] {
  const hidden = hiddenInBacklog(sprint)
  return hidden.size === 0
    ? sprint.backlog
    : sprint.backlog.filter((block) => !hidden.has(block.workItemId))
}

/** Whether anything of the task waits in the backlog: a card, or its done hours. */
function waitsInBacklog(sprint: Sprint, workItemId: number): boolean {
  return (
    sprint.backlog.some((block) => block.workItemId === workItemId) ||
    (sprint.doneInBacklog ?? []).includes(workItemId)
  )
}

/** Hides a task's backlog cards — its remaining hours and any done hours waiting there. */
export function hideInBacklog(sprint: Sprint, workItemId: number): Sprint {
  const hidden = sprint.hiddenBacklog ?? []
  if (hidden.includes(workItemId) || !waitsInBacklog(sprint, workItemId)) return sprint
  return { ...sprint, hiddenBacklog: [...hidden, workItemId] }
}

export function unhideInBacklog(sprint: Sprint, workItemId: number): Sprint {
  const hidden = sprint.hiddenBacklog ?? []
  if (!hidden.includes(workItemId)) return sprint
  return { ...sprint, hiddenBacklog: hidden.filter((id) => id !== workItemId) }
}

/**
 * Drops the mark from every hidden task that `before → after` placed: one of its backlog cards
 * went onto a calendar, or its waiting done hours were put on a day. Also forgets tasks with
 * nothing left in the backlog at all (finished, or gone from TFS), so a mark never outlives the
 * cards it was hiding. Every board change runs through this, so no caller has to remember it.
 */
export function forgetPlacedHidden(before: Sprint, after: Sprint): Sprint {
  const hidden = after.hiddenBacklog ?? []
  if (hidden.length === 0) return after

  const wasInBacklog = new Set(before.backlog.map((block) => block.id))
  const placed = new Set(
    Object.values(after.queues)
      .flat()
      .filter((block) => wasInBacklog.has(block.id))
      .map((block) => block.workItemId)
  )
  const doneAfter = new Set(after.doneInBacklog ?? [])
  for (const id of before.doneInBacklog ?? []) if (!doneAfter.has(id)) placed.add(id)

  const kept = hidden.filter((id) => !placed.has(id) && waitsInBacklog(after, id))
  return kept.length === hidden.length ? after : { ...after, hiddenBacklog: kept }
}
