import { clamp, round } from './math'
import type { Block, Sprint } from './types'

/**
 * Finding and rearranging blocks, wherever they live: in someone's queue or in the backlog.
 *
 * The building blocks every transform in `mutations.ts` and `refresh.ts` is made of. Each
 * returns a new sprint with fresh arrays for whatever changed, so React sees the update.
 */

export type Location = { kind: 'member'; memberId: string } | { kind: 'backlog' }

export interface BlockPosition {
  location: Location
  index: number
  block: Block
}

/** Where a block currently sits, or null if it is not in this sprint. */
export function findBlock(sprint: Sprint, blockId: string): BlockPosition | null {
  const backlogIndex = sprint.backlog.findIndex((block) => block.id === blockId)
  if (backlogIndex >= 0) {
    return {
      location: { kind: 'backlog' },
      index: backlogIndex,
      block: sprint.backlog[backlogIndex]
    }
  }
  for (const [memberId, queue] of Object.entries(sprint.queues)) {
    const index = queue.findIndex((block) => block.id === blockId)
    if (index >= 0) {
      return { location: { kind: 'member', memberId }, index, block: queue[index] }
    }
  }
  return null
}

/** Applies `fn` to every block, in every queue and in the backlog. */
export function mapBlocks(sprint: Sprint, fn: (block: Block) => Block): Sprint {
  const queues: Record<string, Block[]> = {}
  for (const [memberId, queue] of Object.entries(sprint.queues)) queues[memberId] = queue.map(fn)
  return { ...sprint, queues, backlog: sprint.backlog.map(fn) }
}

/** Puts `next` where the block with `blockId` was. */
export function replaceBlock(sprint: Sprint, blockId: string, next: Block): Sprint {
  return mapBlocks(sprint, (block) => (block.id === blockId ? next : block))
}

/** Changes one block's hours, leaving it where it is. */
export function setBlockHours(sprint: Sprint, blockId: string, hours: number): Sprint {
  const found = findBlock(sprint, blockId)
  if (!found) return sprint
  return replaceBlock(sprint, blockId, { ...found.block, hours })
}

/** Takes blocks out of the sprint altogether. */
export function removeBlocks(sprint: Sprint, blockIds: string[]): Sprint {
  const gone = new Set(blockIds)
  const queues: Record<string, Block[]> = {}
  for (const [memberId, queue] of Object.entries(sprint.queues)) {
    queues[memberId] = queue.filter((block) => !gone.has(block.id))
  }
  return { ...sprint, queues, backlog: sprint.backlog.filter((block) => !gone.has(block.id)) }
}

/**
 * Adds a card to the end of the backlog as it is. Unlike {@link insertBlock} it does not merge
 * with a card of the same work item — a refresh adds a *new* task's card, which has none.
 */
export function appendToBacklog(sprint: Sprint, block: Block): Sprint {
  return { ...sprint, backlog: [...sprint.backlog, block] }
}

/** Puts a block at `index` in a queue or in the backlog. */
export function insertBlock(sprint: Sprint, block: Block, to: Location, index: number): Sprint {
  if (to.kind === 'backlog') {
    return { ...sprint, backlog: insertIntoBacklog(sprint.backlog, block, index) }
  }

  const queue = [...(sprint.queues[to.memberId] ?? [])]
  queue.splice(clamp(index, 0, queue.length), 0, block)
  return { ...sprint, queues: { ...sprint.queues, [to.memberId]: queue } }
}

/**
 * Parts of the same work item rejoin in the backlog rather than piling up as separate
 * cards, so returning both halves of a split leaves the item whole again.
 */
export function insertIntoBacklog(backlog: Block[], block: Block, index: number): Block[] {
  const existing = backlog.findIndex((other) => other.workItemId === block.workItemId)
  if (existing >= 0) {
    const merged = [...backlog]
    merged[existing] = { ...merged[existing], hours: round(merged[existing].hours + block.hours) }
    return merged
  }
  const next = [...backlog]
  next.splice(clamp(index, 0, next.length), 0, block)
  return next
}
