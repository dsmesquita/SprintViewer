import { isContainerType } from '../grouping'
import { tagOf, untagged } from '../tags'
import type { Sprint, WorkItem } from '../types'

/** The kinds of task auto-assign treats specially: meetings, and VALs that follow a DEV. */

/**
 * A meeting allowance: a title that is just "Meeting" or "Meetings", or starts with it and a
 * colon or two — "Meetings:: Tech talk + Others", "Meetings: Tech talk" — with or without a tag
 * in front. The colon is what makes it a label rather than the first word of something else,
 * like "Meeting notes".
 */
export function isMeeting(item: WorkItem | undefined): boolean {
  if (item === undefined) return false
  return [item.title.trim(), untagged(item.title)].some((title) =>
    /^meetings?\s*(:{1,2}.*)?$/i.test(title)
  )
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
