import { displayName } from './assignment'
import type { Block, Sprint, WorkItem } from './types'

/**
 * Tasks in TFS hang off a User Story or a Bug. The side panel shows that structure: the
 * parent is a heading, its tasks are the things you drag.
 */

/**
 * Work item types that hold other work rather than being work themselves. These are headings
 * in the panel and are never schedulable, however many children they have.
 *
 * The test is a denylist rather than "only Task is schedulable" so that a process template
 * with a custom leaf type still reaches the backlog. Silently dropping work would be a far
 * worse failure than showing a card for something unusual.
 */
const CONTAINER_TYPES = new Set([
  'user story',
  'bug',
  'feature',
  'epic',
  'product backlog item',
  'requirement'
])

export function isContainerType(type: string): boolean {
  return CONTAINER_TYPES.has(type.trim().toLowerCase())
}

/** Ids that at least one other item in the set points at as its parent. */
export function parentIdsIn(items: WorkItem[]): Set<number> {
  const parents = new Set<number>()
  for (const item of items) if (item.parentId !== undefined) parents.add(item.parentId)
  return parents
}

/**
 * The work items that can be put on the calendar: the leaves.
 *
 * A story or bug is a heading whether or not it has children — the work lives in the tasks
 * beneath it. One with no tasks at all is not schedulable either; it shows up as an empty
 * group instead, so it stays visible without pretending to be something you can plan.
 */
export function schedulableItems(items: WorkItem[]): WorkItem[] {
  return items.filter((item) => !isContainerType(item.type))
}

/** Why a container has no cards under it in the panel. */
export type EmptyReason = 'no-tasks' | 'all-scheduled'

export interface EmptyGroup {
  item: WorkItem
  reason: EmptyReason
  /** How many tasks the container has in the sprint. Zero for `no-tasks`. */
  taskCount: number
}

/**
 * Containers that belong in the panel with no cards under them.
 *
 * Two quite different situations, worth telling apart. A bug nobody has broken into tasks is
 * work that cannot be planned until somebody adds one — the most important thing not to hide.
 * A story whose tasks are every one of them scheduled is finished business for the panel, but
 * it stays visible so that a story you are part way through does not vanish from the list the
 * moment its last task is placed.
 */
export function emptyGroupsFor(sprint: Sprint): EmptyGroup[] {
  const children = new Map<number, WorkItem[]>()
  for (const item of Object.values(sprint.workItems)) {
    if (item.parentId === undefined) continue
    children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
  }
  const inBacklog = new Set(sprint.backlog.map((block) => block.workItemId))

  const empty: EmptyGroup[] = []
  for (const item of Object.values(sprint.workItems)) {
    if (!isContainerType(item.type)) continue
    const mine = children.get(item.id) ?? []
    if (mine.length === 0) empty.push({ item, reason: 'no-tasks', taskCount: 0 })
    else if (!mine.some((child) => inBacklog.has(child.id))) {
      empty.push({ item, reason: 'all-scheduled', taskCount: mine.length })
    }
  }
  return empty.sort((a, b) => a.item.id - b.item.id)
}

export interface BacklogGroup {
  /** Stable key for collapse state: the parent id, or `none`. */
  key: string
  /** Absent for the group of tasks that have no parent. */
  parent?: WorkItem
  blocks: Block[]
  hours: number
  /** Set only for a heading with no cards under it, saying which kind of empty it is. */
  empty?: EmptyGroup
}

/**
 * Groups blocks under their parent work item, keeping the backlog's own order: groups appear
 * in the order their first task does, and tasks keep their order within a group. The
 * unparented group always sorts last, since it is the leftovers rather than a real heading.
 */
export function groupBlocks(
  sprint: Sprint,
  blocks: Block[],
  empties: EmptyGroup[] = []
): BacklogGroup[] {
  const groups = new Map<string, BacklogGroup>()

  for (const block of blocks) {
    const item = sprint.workItems[block.workItemId]
    // Container types are group headers only — they have no size and cannot be scheduled.
    if (item && isContainerType(item.type)) continue
    const parentId = item?.parentId
    const key = parentId === undefined ? 'none' : String(parentId)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        parent: parentId === undefined ? undefined : sprint.workItems[parentId],
        blocks: [],
        hours: 0
      }
      groups.set(key, group)
    }
    group.blocks.push(block)
    group.hours = Math.round((group.hours + block.hours) * 100) / 100
  }

  // Empty headings come after the groups that have work in them and before the leftovers, so
  // the list reads: work to place, then work that is spoken for, then odds and ends.
  const blank: BacklogGroup[] = empties
    .filter((empty) => !groups.has(String(empty.item.id)))
    .map((empty) => ({
      key: String(empty.item.id),
      parent: empty.item,
      blocks: [],
      hours: 0,
      empty
    }))

  const ordered = [...groups.values()]
  return [
    ...ordered.filter((g) => g.key !== 'none'),
    ...blank,
    ...ordered.filter((g) => g.key === 'none')
  ]
}

/**
 * The text a search runs against.
 *
 * The parent's title is included so that searching for a story finds the tasks underneath it,
 * and the assignee so that searching for a person finds their work. Matching is a plain
 * contains over all of it, so any part of a name works — first name, surname, or a fragment
 * running across both.
 */
export function searchTextFor(sprint: Sprint, block: Block): string {
  const item = sprint.workItems[block.workItemId]
  if (!item) return String(block.workItemId)
  const parent = item.parentId === undefined ? undefined : sprint.workItems[item.parentId]
  return [item.id, item.title, item.type, displayName(item.assignedTo), parent?.id, parent?.title]
    .filter(Boolean)
    .join(' ')
}
