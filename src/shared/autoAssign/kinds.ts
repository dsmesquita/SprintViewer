import { isContainerType } from '../grouping'
import { tagOf, untagged } from '../tags'
import type { Sprint, WorkItem } from '../types'

/** The kinds of task auto-assign treats specially: meetings, and VALs that follow a DEV. */

/** A meeting allowance: the title, once its tag is off, is just "Meeting" or "Meetings". */
export function isMeeting(item: WorkItem | undefined): boolean {
  return item !== undefined && /^meetings?$/i.test(untagged(item.title))
}

export function isTagged(item: WorkItem, tag: string): boolean {
  return !isContainerType(item.type) && tagOf(item.title) === tag
}

/** The DEV tasks under the same Bug or User Story. */
export function devSiblings(sprint: Sprint, item: WorkItem): WorkItem[] {
  if (item.parentId === undefined) return []
  return Object.values(sprint.workItems).filter(
    (other) => other.parentId === item.parentId && isTagged(other, 'DEV')
  )
}

/** A VAL task with a DEV task to follow. A VAL on its own is ordinary work. */
export function isChainedVal(sprint: Sprint, item: WorkItem | undefined): boolean {
  return item !== undefined && isTagged(item, 'VAL') && devSiblings(sprint, item).length > 0
}
