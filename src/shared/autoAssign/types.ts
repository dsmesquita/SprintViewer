import type { Block, Sprint, WorkItem } from '../types'

/** The shapes of an auto-assign plan and what it reports. */

export interface AssignSummary {
  /** Tasks moved onto a calendar. A meeting spread over several days counts once. */
  placed: number
  /** How many people received work. */
  people: number
  /** Left behind because TFS names nobody on the team. */
  unattributed: number
  /** Left behind because the person has no room left for something that size. */
  tooBig: number
  /** Left behind because they have no hours at all. */
  unsized: number
  /** Meetings spread over more than one day. */
  meetingsSplit: number
  /**
   * Meetings left in the backlog because only the sprint's last working day is left, and its
   * morning is too short for them — its afternoon is kept free of meetings.
   */
  meetingsTooLate: number
  /** VAL tasks started straight after their DEV task. */
  valsChained: number
  /**
   * VAL tasks whose DEV ends too close to the end of the sprint for them to follow it, placed
   * as late as their owner's calendar allows instead.
   */
  valsLate: number
  /** VAL tasks left in the backlog because their DEV task is not planned yet. */
  waitingForDev: number
  /** Tasks whose done hours were waiting in the backlog, now drawn where their owner worked. */
  donePlaced: number
}

/** Which rule placed a task somewhere it could disturb other work. */
export type AssignRule = 'meeting' | 'val' | 'late-val'

/** A task already on a calendar that the plan would move or cut. */
export interface BaseChange {
  blockId: string
  workItemId: number
  memberId: string
  kind: 'moved' | 'split'
  /** The newly placed tasks on that person's calendar that made room for themselves. */
  causes: Array<{ workItemId: number; rule: AssignRule }>
}

export interface AssignPlan {
  sprint: Sprint
  summary: AssignSummary
  /** Empty when nothing already on a calendar moves. */
  baseChanges: BaseChange[]
}

export interface AssignOptions {
  /**
   * Leave everything already on a calendar exactly where it is. Rules that would need to move
   * something are relaxed for the tasks involved instead: a VAL goes to the end of its owner's
   * work, and a meeting is spread only where it disturbs nothing.
   */
  keepBase?: boolean
  /** Ids for the extra pieces a meeting is split into. */
  newId?: () => string
}

export interface Candidate {
  block: Block
  item: WorkItem
  memberId: string
  kind: 'meeting' | 'val' | 'ordinary'
}
