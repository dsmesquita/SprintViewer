import { memberMatches } from '../assignment'
import { plannedHoursIn } from '../sizing'
import type { Block, Sprint, WorkItem } from '../types'

/** Who a task belongs to, and in what order a person's tasks are placed. */

/** Business Order at or below this counts as prioritised work. */
export const PRIORITY_ORDER = 50

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

export function parentOf(sprint: Sprint, item: WorkItem): WorkItem | undefined {
  return item.parentId === undefined ? undefined : sprint.workItems[item.parentId]
}

export function parentActive(sprint: Sprint, item: WorkItem): boolean {
  return parentOf(sprint, item)?.state.trim().toLowerCase() === 'active'
}

export function underStory(sprint: Sprint, item: WorkItem): boolean {
  const parent = parentOf(sprint, item)
  return parent !== undefined && parent.type.trim().toLowerCase() === 'user story'
}

export function prioritised(sprint: Sprint, item: WorkItem): boolean {
  // Business Order lives on the parent. A task with no parent, or a server with no such
  // field, simply does not win this key rather than losing the ones after it.
  const order = parentOf(sprint, item)?.businessOrder
  return order !== undefined && order <= PRIORITY_ORDER
}

/** True sorts before false. */
export function rank(a: boolean, b: boolean): number {
  return Number(a) - Number(b)
}

/** Who on the team this task belongs to, by the name TFS has against it. */
export function ownerOf(sprint: Sprint, item: WorkItem): string | null {
  if (!item.assignedTo) return null
  const member = sprint.members.find((m) => memberMatches(m, item.assignedTo ?? ''))
  return member ? member.id : null
}
