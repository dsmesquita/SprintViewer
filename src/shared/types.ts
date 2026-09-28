/** Domain model shared by the main and renderer processes. */

import type { ChildQueryMode } from './settings'
import type { TaskTemplate } from './taskCreation'

/** Calendar date as `YYYY-MM-DD`. Never a Date object — these are serialised to JSON on disk. */
export type ISODate = string

export const DEFAULT_HOURS_PER_DAY = 8

export interface Member {
  id: string
  name: string
  /** TFS identity (`Display Name <domain\\user>`) used to match work items on import. */
  tfsIdentity?: string
  /** Row order in the calendar. */
  order: number
}

/**
 * One column group of the calendar. Only days that belong to the sprint are listed;
 * weekends are simply absent unless the sprint was created with them included.
 *
 * `capacity` is the hours available to *everyone* that day. 0 disables the day for the
 * whole team (public holiday, planning day); 4 makes it a half day (demo & retro).
 */
export interface SprintDay {
  date: ISODate
  capacity: number
  /** Shown in the day header when the day is disabled or reduced, e.g. "Public holiday". */
  label?: string
}

export interface WorkItem {
  id: number
  title: string
  /** Deep link back to the work item in TFS. */
  url: string
  type: string
  state: string
  assignedTo?: string
  /** Microsoft.VSTS.Scheduling.RemainingWork at the last refresh. */
  remainingWork: number
  /**
   * Original Estimate and Completed Work, when the server tracks them. Undefined means the
   * field is absent rather than zero. Completed Work is half of a task's size — see `sizing.ts`
   * — while Original Estimate is only ever used to judge whether a task went off track.
   */
  originalEstimate?: number
  completedWork?: number
  /**
   * The parent work item's Business Order, when the server has such a field. Auto-assign
   * sorts by it; nothing else reads it.
   */
  businessOrder?: number
  /** The User Story or Bug this task hangs off, when it has one. */
  parentId?: number
  parentTitle?: string
  parentType?: string
  /**
   * The work item's tags in TFS (`System.Tags`). Not the discipline prefix in the title, which
   * the app also calls a tag — see `tags.ts`. Only known for items fetched in full, which is
   * every Bug and User Story; tasks created under one copy its tags.
   */
  tfsTags?: string[]
  /** `System.AreaPath` and `System.IterationPath`, copied the same way. */
  areaPath?: string
  iterationPath?: string
  /**
   * Set when a refresh no longer finds this item in the query. Its blocks are left alone
   * rather than deleted — someone spent time scheduling them, and a query can change for
   * reasons that have nothing to do with the work.
   */
  missingFromQuery?: boolean
}

/**
 * A chunk of a work item's hours. A work item with no splits has exactly one block; splitting
 * produces several blocks that share `workItemId`. However it is split, and wherever the pieces
 * are — calendars, the backlog, or both — they sum to the size `sizing.ts` gives the item.
 */
export interface Block {
  id: string
  workItemId: number
  hours: number
  /**
   * Fixes the block to a slot instead of letting it flow with the queue.
   *
   * A pin means "start no earlier than here": the block claims the first free space at or
   * after that point, and unpinned work flows around it. This is how a day that has already
   * happened gets recorded — you drop a task on Tuesday morning because that is when it was
   * actually worked, and nothing shuffles it away.
   */
  pin?: { date: ISODate; startHour: number }
}

/** The competency a note about a person speaks to. */
export type NoteCategory =
  | 'Agility'
  | 'Commitment'
  | 'Communication'
  | 'Customer Orientation'
  | 'Execution & Delivery'
  | 'Innovation'

export interface Note {
  id: string
  /** Notes always belong to a person — that is where they are displayed. */
  memberId: string
  text: string
  /** Which competency the note is about, when the writer said. Older notes have none. */
  category?: NoteCategory
  /** Work items this note refers to. Empty for a note about the person themselves. */
  taskIds: number[]
  createdAt: string
  updatedAt: string
}

/**
 * A block resolved to a position in the grid by the layout engine. Produced on every
 * render from the queues; never stored.
 */
export interface Segment {
  blockId: string
  workItemId: number
  date: ISODate
  /** 0-based hour offset within the day. */
  startHour: number
  hours: number
  /** True when the block was cut across a day boundary and this is not its first piece. */
  continued: boolean
  /** True when a later piece of the same block follows on the next day. */
  continues: boolean
  /** True when the block is pinned to its slot rather than flowing with the queue. */
  pinned?: boolean
  /**
   * True when this came from a past refresh's snapshot rather than a block in a queue.
   * History is a record, so it cannot be dragged or edited.
   */
  fromHistory?: boolean
  /**
   * True for hours reported against the work item in TFS, drawn before today. Derived from
   * Completed Work rather than from any block, so it is a record and never draggable.
   */
  isDone?: boolean
  /** Reported hours that did not fit before the sprint began, named in the tooltip. */
  doneOverflow?: number
}

export interface Sprint {
  id: string
  name: string
  days: SprintDay[]
  /** Default hours in a working day, before any day or person override. */
  hoursPerDay: number
  members: Member[]
  /**
   * Per-person capacity overrides keyed by member id then date. Holidays and part-time
   * days live here; a missing entry means "use the sprint day's capacity".
   */
  capacityOverrides: Record<string, Record<ISODate, number>>
  /** Ordered queue of blocks per member. Position in the array *is* the schedule. */
  queues: Record<string, Block[]>
  /** Blocks not assigned to anyone: fresh imports and split remainders. */
  backlog: Block[]
  workItems: Record<number, WorkItem>
  notes: Note[]
  /**
   * Hours the user has set by hand for a work item, overruling everything TFS says about its
   * size. Keyed by work item id and kept here rather than on the `WorkItem`, which a refresh
   * replaces wholesale from the server's answer and would wipe.
   */
  customHours?: Record<number, number>
  /**
   * Tags hidden from the backlog by the filter row. Hidden rather than shown is deliberate:
   * a tag that first appears at a later refresh is then visible by default, instead of being
   * filtered out by a list written before it existed.
   */
  hiddenTags?: string[]
  /**
   * Days the user has explicitly locked. Locked days reject new drops and are skipped by
   * clear and refresh. Only an explicit unlock removes the lock — a clear does not.
   */
  lockedDays?: string[]
  /**
   * Where the user has said a work item's reported hours were actually worked, keyed by work
   * item id.
   *
   * Reported hours are derived from Completed Work rather than from a block, so with no pin
   * they are packed backwards from the anchor — near enough, but a guess. Dragging one is how
   * you say "this happened on Tuesday morning", and the pin is what remembers that.
   */
  reportedPins?: Record<number, { memberId: string; date: ISODate; startHour: number }>
  /**
   * Tasks whose done hours wait in the backlog as a card of their own, drawn nowhere until they
   * are dragged onto a day (see `doneHours.ts`).
   */
  doneInBacklog?: number[]
  /** Tasks already asked about after a refresh — where their done hours go — so each once. */
  doneDecided?: number[]
  /**
   * Tasks hidden from the backlog (`hiddenBacklog.ts`). Placing one on a calendar clears its
   * mark; auto-assign places them like any other task.
   */
  hiddenBacklog?: number[]
  /** TFS query the work items were imported from, and the one Refresh reads. */
  queryUrl?: string
  /**
   * The sprint's own copy of settings the app keeps defaults for (`sprintSettings.ts`): how
   * Refresh fetches child tasks, and who DOC and QA tasks created here go to, from which
   * templates. Absent on sprints saved before they had a copy; they get the app's when opened.
   */
  childQueryMode?: ChildQueryMode
  docOwner?: string
  qaOwner?: string
  taskTemplates?: TaskTemplate[]
  lastRefreshedAt?: string
  /**
   * Frozen layout for days that have already passed, captured at each refresh so that
   * history shows what was actually worked rather than being re-flowed from today.
   */
  history: Record<string, Record<ISODate, Segment[]>>
  /**
   * The reported hours drawn on days that have passed, exactly as they were drawn, per person
   * and day. Taken at every refresh: once a day has been shown with real figures it is a
   * record, and later refreshes only add hours TFS reports on top of it — into free space,
   * oldest gap first — rather than redrawing it.
   *
   * Absent on sprints that have never been refreshed under this rule; those draw the past from
   * `history` instead.
   */
  pastRecord?: Record<string, Record<ISODate, Segment[]>>
}
