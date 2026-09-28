import type { PlanSettings } from '@shared/sprintSettings'
import type { CustomChoice, CustomConflict } from '@shared/customHours'
import type { Location } from '@shared/mutations'
import type { NoteDraft } from '@shared/notes'
import type { Direction } from '@shared/nudge'
import type {
  AppSettings,
  SprintSummary,
  StartSprintRequest,
  WritableSettings
} from '@shared/settings'
import type { CreateTasksResult, TaskDraft } from '@shared/taskCreation'
import type { ISODate, Member, Sprint } from '@shared/types'

export type PanelTab = 'backlog' | 'person' | 'task'
export type DialogKind =
  | 'none'
  | 'settings'
  | 'start-sprint'
  | 'split'
  | 'note'
  | 'hours'
  | 'snapshots'
  | 'create-tasks'
  | 'summary'
  | 'help'
  | 'export-calendar'

/** What the note dialog opens on: an existing note, or a blank one seeded from context. */
export interface NoteTarget {
  noteId?: string
  memberId?: string
  taskId?: number
}

/** The open sprint, where it came from, and moving between sprints. */
export interface SprintSlice {
  /** Null until a sprint is started or loaded — the app opens on an empty state. */
  sprint: Sprint | null
  /** True while showing the built-in sample sprint, which is never written to disk. */
  isSample: boolean
  settings: AppSettings | null
  loading: boolean
  /** Set when a write to disk fails, so the user learns before closing the app. */
  saveError: string | null
  /** Loaded list of saved sprints, for the sprint switcher. */
  sprintList: SprintSummary[]

  init: () => Promise<void>
  applySettings: (settings: AppSettings) => void
  saveSettings: (patch: WritableSettings) => Promise<void>
  startSprint: (request: StartSprintRequest) => Promise<string | null>
  loadSample: () => void
  loadSprintList: () => Promise<void>
  switchSprint: (id: string) => Promise<void>
}

/** Every change to the board, and going back on one. */
export interface BoardSlice {
  /**
   * Sprints as they were before each change, newest last, so the back button can put one
   * back. In memory only: a restart starts a fresh plan, not a fresh history of one.
   */
  undoStack: Array<{ sprint: Sprint; label: string }>
  /** What the back button would undo, for its label. Null when there is nothing to undo. */
  undo: () => void

  saveNote: (draft: NoteDraft, noteId?: string) => void
  removeNote: (noteId: string) => void
  moveBlock: (blockId: string, to: Location, index: number) => void
  pinBlock: (blockId: string, memberId: string, date: ISODate, startHour: number) => void
  unpinBlock: (blockId: string) => void
  pinReported: (workItemId: number, memberId: string, date: ISODate, startHour: number) => void
  unpinReported: (workItemId: number) => void
  /** Done hours dropped on the backlog: they wait there as a card. */
  returnDoneToBacklog: (workItemId: number) => void
  /** Moves the selected block one working hour, or swaps it with its neighbour. */
  nudge: (direction: Direction) => void
  /** Rescales the open sprint around a new working-day length. */
  setHoursPerDay: (hoursPerDay: number) => void
  /** Gives the open sprint the roster's TFS identities and any people it does not have yet. */
  syncSprintMembers: (roster: Member[]) => void
  setCustomHours: (workItemId: number, hours: number) => void
  clearCustomHours: (workItemId: number) => void
  clearSprint: () => void
  /** Changes the query or sprint URL that Refresh reads the open sprint from. */
  setQueryUrl: (url: string) => void
  /** Saves the Sprint tab of Settings into the open sprint, as one undoable change. */
  applySprintSettings: (next: PlanSettings & { name: string }) => void
  /** Replaces the sprint with one already transformed by the caller, then persists it. */
  applySprint: (next: Sprint, label?: string) => void
  splitBlock: (blockId: string, keepHours: number) => void
  splitIntoN: (blockId: string, parts: number[]) => void
  setDayCapacity: (date: ISODate, capacity: number, label?: string) => void
  setMemberCapacity: (memberId: string, date: ISODate, capacity: number | null) => void
  lockDay: (date: ISODate) => void
  unlockDay: (date: ISODate) => void
  toggleTag: (tag: string) => void
  showAllTags: () => void
  /** Hides a task's backlog cards; placing it anywhere shows it again. */
  hideInBacklog: (workItemId: number) => void
  unhideInBacklog: (workItemId: number) => void
  /**
   * Creates tasks in TFS and adds whatever was created to the backlog. Resolves to the
   * server's answer, or to a message when the request could not be made at all.
   */
  createTasks: (parentId: number, drafts: TaskDraft[]) => Promise<CreateTasksResult | string>
}

/** Re-reading the sprint from TFS. */
export interface RefreshSlice {
  refreshing: boolean
  /** Outcome of the last refresh, shown in the toolbar. */
  refreshStatus: { ok: boolean; text: string } | null
  /**
   * A refresh that has been fetched and reconciled but not committed, because it disagrees
   * with times the user set by hand. Held until they say what to do about each one.
   */
  pendingRefresh: {
    sprint: Sprint
    text: string
    conflicts: CustomConflict[]
  } | null
  /**
   * Tasks in the backlog with hours done by someone on the team, found by the last refresh or
   * import and not asked about before: where should those hours go?
   */
  doneQuestion: number[] | null
  /** Place them on the calendar where they were worked, or keep them in the backlog. */
  answerDoneQuestion: (place: boolean) => void
  dismissDoneQuestion: () => void
  refresh: () => Promise<void>
  resolveRefresh: (choices: Map<number, CustomChoice>) => void
  cancelRefresh: () => void
}

/** What is being looked at, and how: selection, the panel, zoom, the backlog filter. */
export interface ViewSlice {
  /** The anchor for the layout engine: days before it are history, days after are planned. */
  today: ISODate
  selectedMemberId: string | null
  /**
   * People picked on the calendar with Ctrl+click or Shift+click, for acting on several at once
   * (exporting their calendars). A plain click clears it.
   */
  pickedMembers: string[]
  /** The last name clicked, where a Shift+click range starts. */
  pickAnchor: string | null
  selectedWorkItemId: number | null
  /**
   * The block that was clicked, which is what Shift + ←/→ moves. The work item alone is not
   * enough: a split task has several blocks. Reported-hours ribbons use `done:<id>`.
   */
  selectedBlockId: string | null
  panelCollapsed: boolean
  panelTab: PanelTab
  /** Work item highlighted across the grid and the panel, e.g. from a note's task chip. */
  highlightedWorkItemId: number | null
  /**
   * Width of one hour column, in px. A view preference rather than part of the plan, so it
   * lives in `localStorage` and never reaches the sprint file or the settings.
   */
  hourWidth: number
  /**
   * Filter text for the backlog list. Lives here rather than in the panel so it survives
   * switching to the person tab and back.
   */
  backlogSearch: string
  /** Keys of backlog groups the user has folded away. */
  collapsedGroups: string[]
  /** Whether the backlog lists the tasks hidden from it, dimmed, so they can be unhidden. */
  showHiddenBacklog: boolean

  selectMember: (memberId: string) => void
  /**
   * A click on a person's name: `toggle` (Ctrl) adds or removes them, `range` (Shift) picks
   * everyone from the last one clicked to them, `only` (a plain click) starts again from them.
   */
  pickMember: (memberId: string, mode: 'toggle' | 'range' | 'only') => void
  selectTask: (workItemId: number, blockId?: string) => void
  /** Drops the task the panel is describing, and leaves the Task tab if that is where we are. */
  clearTask: () => void
  setPanelTab: (tab: PanelTab) => void
  /** Steps the calendar zoom, in stops. `null` goes back to 100%. */
  zoomBy: (steps: number | null) => void
  togglePanel: () => void
  highlightWorkItem: (workItemId: number | null) => void
  setBacklogSearch: (search: string) => void
  toggleGroup: (key: string) => void
  setCollapsedGroups: (keys: string[]) => void
  setShowHiddenBacklog: (show: boolean) => void
}

/** Which dialog is open, and what it is acting on. */
export interface DialogSlice {
  dialog: DialogKind
  /** Seeds the Start sprint dialog when it is opened from a right-clicked day. */
  startDateSeed: ISODate | null
  /** The block the split dialog is acting on. */
  splitTarget: string | null
  /** What the note dialog is acting on. */
  noteTarget: NoteTarget | null
  /** The work item whose hours are being set by hand. */
  hoursTarget: number | null
  /** The Bug or User Story new tasks are being created under. */
  createTasksParent: number | null
  /** The people whose calendars are being exported. */
  exportMembers: string[] | null

  openDialog: (dialog: DialogKind, startDateSeed?: ISODate) => void
  openSplit: (blockId: string) => void
  openNote: (target: NoteTarget) => void
  openHours: (workItemId: number) => void
  openCreateTasks: (parentId: number) => void
  openExportCalendar: (memberIds: string[]) => void
  closeDialog: () => void
}

export type AppState = SprintSlice & BoardSlice & RefreshSlice & ViewSlice & DialogSlice
