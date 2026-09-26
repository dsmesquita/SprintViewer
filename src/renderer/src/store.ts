import { create } from 'zustand'
import { todayISO } from '@shared/dates'
import { createMockSprint } from '@shared/mock'
import {
  clearCalendar,
  lockDay,
  moveBlock,
  pinBlockAt,
  pinReportedAt,
  setDayCapacity,
  setHoursPerDay,
  setMemberCapacity,
  splitAndReturn,
  splitIntoN,
  unlockDay,
  unpinBlock,
  unpinReported,
  type Location
} from '@shared/mutations'
import { addNote, deleteNote, updateNote, type NoteDraft } from '@shared/notes'
import { nudgeBlock, nudgeReported, type Direction } from '@shared/nudge'
import { alignReportedOnly, applyRefresh, type RefreshSummary } from '@shared/refresh'
import { addCreatedTasks, type CreateTasksResult, type TaskDraft } from '@shared/taskCreation'
import { syncSprintMembers } from '@shared/squad'
import { showAllTags, toggleTag } from '@shared/tags'
import { anchorFor, recordPast } from '@shared/scheduling'
import {
  applyCustomChoices,
  clearCustomHours,
  customConflicts,
  setCustomHours,
  type CustomChoice,
  type CustomConflict
} from '@shared/customHours'
import type { AppSettings, SprintSummary, StartSprintRequest, WritableSettings } from '@shared/settings'
import type { ISODate, Member, Sprint } from '@shared/types'
import { DEFAULT_HOUR_W, HOUR_W_STEPS, stepZoom } from './grid'

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

/** What the note dialog opens on: an existing note, or a blank one seeded from context. */
export interface NoteTarget {
  noteId?: string
  memberId?: string
  taskId?: number
}

interface AppState {
  /** Null until a sprint is started or loaded — the app opens on an empty state. */
  sprint: Sprint | null
  /** True while showing the built-in sample sprint, which is never written to disk. */
  isSample: boolean
  settings: AppSettings | null
  loading: boolean
  /** Set when a write to disk fails, so the user learns before closing the app. */
  saveError: string | null
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
  resolveRefresh: (choices: Map<number, CustomChoice>) => void
  cancelRefresh: () => void

  /** The anchor for the layout engine: days before it are history, days after are planned. */
  today: ISODate
  selectedMemberId: string | null
  /** The task the Task tab is describing, set by clicking a block on the calendar. */
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
  /**
   * Sprints as they were before each change, newest last, so the back button can put one
   * back. In memory only: a restart starts a fresh plan, not a fresh history of one.
   */
  undoStack: Array<{ sprint: Sprint; label: string }>

  dialog: DialogKind
  /** Seeds the Start sprint dialog when it is opened from a right-clicked day. */
  startDateSeed: ISODate | null
  /** The block the split dialog is acting on. */
  splitTarget: string | null
  openSplit: (blockId: string) => void
  /** What the note dialog is acting on. */
  noteTarget: NoteTarget | null
  openNote: (target: NoteTarget) => void
  /** The work item whose hours are being set by hand. */
  hoursTarget: number | null
  openHours: (workItemId: number) => void
  /** The Bug or User Story new tasks are being created under. */
  createTasksParent: number | null
  openCreateTasks: (parentId: number) => void
  /**
   * Creates tasks in TFS and adds whatever was created to the backlog. Resolves to the
   * server's answer, or to a message when the request could not be made at all.
   */
  createTasks: (parentId: number, drafts: TaskDraft[]) => Promise<CreateTasksResult | string>

  init: () => Promise<void>
  selectMember: (memberId: string) => void
  selectTask: (workItemId: number, blockId?: string) => void
  /** Drops the task the panel is describing, and leaves the Task tab if that is where we are. */
  clearTask: () => void
  /** Moves the selected block one working hour, or swaps it with its neighbour. */
  nudge: (direction: Direction) => void
  setPanelTab: (tab: PanelTab) => void
  /** Steps the calendar zoom, in stops. `null` goes back to 100%. */
  zoomBy: (steps: number | null) => void
  togglePanel: () => void
  highlightWorkItem: (workItemId: number | null) => void
  setBacklogSearch: (search: string) => void
  toggleGroup: (key: string) => void
  /** What the back button would undo, for its label. Null when there is nothing to undo. */
  undo: () => void
  setCollapsedGroups: (keys: string[]) => void
  toggleTag: (tag: string) => void
  showAllTags: () => void

  openDialog: (dialog: DialogKind, startDateSeed?: ISODate) => void
  closeDialog: () => void

  applySettings: (settings: AppSettings) => void
  saveSettings: (patch: WritableSettings) => Promise<void>
  startSprint: (request: StartSprintRequest) => Promise<string | null>
  refresh: () => Promise<void>
  loadSample: () => void

  saveNote: (draft: NoteDraft, noteId?: string) => void
  removeNote: (noteId: string) => void

  moveBlock: (blockId: string, to: Location, index: number) => void
  pinBlock: (blockId: string, memberId: string, date: ISODate, startHour: number) => void
  unpinBlock: (blockId: string) => void
  pinReported: (workItemId: number, memberId: string, date: ISODate, startHour: number) => void
  unpinReported: (workItemId: number) => void
  /** Rescales the open sprint around a new working-day length. */
  setHoursPerDay: (hoursPerDay: number) => void
  /** Gives the open sprint the roster's TFS identities and any people it does not have yet. */
  syncSprintMembers: (roster: Member[]) => void
  setCustomHours: (workItemId: number, hours: number) => void
  clearCustomHours: (workItemId: number) => void
  clearSprint: () => void
  /** Replaces the sprint with one already transformed by the caller, then persists it. */
  applySprint: (next: Sprint, label?: string) => void
  splitBlock: (blockId: string, keepHours: number) => void
  splitIntoN: (blockId: string, parts: number[]) => void
  setDayCapacity: (date: ISODate, capacity: number, label?: string) => void
  setMemberCapacity: (memberId: string, date: ISODate, capacity: number | null) => void
  lockDay: (date: ISODate) => void
  unlockDay: (date: ISODate) => void

  /** Loaded list of saved sprints, for the sprint switcher. */
  sprintList: SprintSummary[]
  loadSprintList: () => Promise<void>
  switchSprint: (id: string) => Promise<void>
}

export const useApp = create<AppState>((set) => ({
  sprint: null,
  isSample: false,
  settings: null,
  loading: true,
  saveError: null,
  refreshing: false,
  refreshStatus: null,
  pendingRefresh: null,

  today: todayISO(),
  selectedMemberId: null,
  selectedWorkItemId: null,
  selectedBlockId: null,
  panelCollapsed: false,
  panelTab: 'backlog',
  highlightedWorkItemId: null,
  hourWidth: storedHourWidth(),
  backlogSearch: '',
  collapsedGroups: [],
  undoStack: [],

  dialog: 'none',
  startDateSeed: null,
  splitTarget: null,
  noteTarget: null,
  hoursTarget: null,
  createTasksParent: null,
  sprintList: [],

  init: async () => {
    // `npm run dev:web` serves the UI without a main process, so there is no bridge to call.
    if (!window.api) {
      set({ loading: false })
      return
    }
    const settings = await window.api.getSettings()
    const sprint = settings.activeSprintId
      ? await window.api.loadSprint(settings.activeSprintId)
      : null
    const sprintList = await window.api.listSprints()
    set({ settings, sprint: opened(sprint), sprintList, isSample: false, loading: false, undoStack: [] })
    scheduleBaseline()
  },

  selectMember: (memberId) =>
    set({ selectedMemberId: memberId, panelTab: 'person', panelCollapsed: false }),
  selectTask: (selectedWorkItemId, blockId) =>
    set({
      selectedWorkItemId,
      selectedBlockId: blockId ?? null,
      panelTab: 'task',
      panelCollapsed: false
    }),
  clearTask: () =>
    set((state) =>
      state.selectedWorkItemId === null
        ? state
        : {
            ...state,
            selectedWorkItemId: null,
            selectedBlockId: null,
            // Only the Task tab is left behind. Somewhere else — a person's panel, say — is
            // where the user has already moved on to, and yanking them back to the backlog
            // would undo the very click that took them there.
            panelTab: state.panelTab === 'task' ? 'backlog' : state.panelTab
          }
    ),
  setPanelTab: (panelTab) => set({ panelTab }),
  zoomBy: (steps) =>
    set((state) => {
      const hourWidth = steps === null ? DEFAULT_HOUR_W : stepZoom(state.hourWidth, steps)
      if (hourWidth === state.hourWidth) return state
      rememberHourWidth(hourWidth)
      return { ...state, hourWidth }
    }),
  togglePanel: () => set((state) => ({ panelCollapsed: !state.panelCollapsed })),
  highlightWorkItem: (highlightedWorkItemId) => set({ highlightedWorkItemId }),
  setBacklogSearch: (backlogSearch) => set({ backlogSearch }),
  toggleGroup: (key) =>
    set((state) => ({
      collapsedGroups: state.collapsedGroups.includes(key)
        ? state.collapsedGroups.filter((other) => other !== key)
        : [...state.collapsedGroups, key]
    })),
  setCollapsedGroups: (collapsedGroups) => set({ collapsedGroups }),

  undo: () =>
    set((state) => {
      const previous = state.undoStack[state.undoStack.length - 1]
      if (!previous || !state.sprint) return state
      // The tag filter is a view preference rather than an operation, so going back a step
      // must not change what the user is looking at.
      const sprint = { ...previous.sprint, hiddenTags: state.sprint.hiddenTags }
      queueMicrotask(() => void persistSprint())
      return { ...state, sprint, undoStack: state.undoStack.slice(0, -1) }
    }),
  // The tag filter is part of the plan rather than a view preference, so unlike the search
  // box it lives on the sprint and is written to disk.
  toggleTag: (tag) => mutate((sprint) => toggleTag(sprint, tag), null),
  showAllTags: () => mutate((sprint) => showAllTags(sprint), null),

  openDialog: (dialog, startDateSeed) => set({ dialog, startDateSeed: startDateSeed ?? null }),
  openSplit: (blockId) => set({ dialog: 'split', splitTarget: blockId }),
  openNote: (noteTarget) => set({ dialog: 'note', noteTarget }),
  openHours: (hoursTarget) => set({ dialog: 'hours', hoursTarget }),
  openCreateTasks: (createTasksParent) => set({ dialog: 'create-tasks', createTasksParent }),
  createTasks: async (parentId, drafts) => {
    const { sprint } = useApp.getState()
    if (!sprint?.queryUrl) return 'Only a sprint imported from TFS can have tasks created in it.'
    if (!window.api) return 'Creating tasks needs the desktop app.'
    const result = await window.api.createTasks(sprint.queryUrl, parentId, drafts)
    if (!result.ok) return result.message
    // Applied to the sprint as it is *now*, not as it was when the request went out: the
    // requests take a while, and the user may have kept planning in the meantime.
    mutate(
      (current) => addCreatedTasks(current, result.value.created, () => crypto.randomUUID()),
      'create tasks'
    )
    return result.value
  },
  closeDialog: () =>
    set({
      dialog: 'none',
      startDateSeed: null,
      splitTarget: null,
      noteTarget: null,
      hoursTarget: null,
      createTasksParent: null
    }),

  applySettings: (settings) => set({ settings }),

  saveSettings: async (patch) => {
    set({ settings: await window.api.updateSettings(patch) })
  },

  startSprint: async (request) => {
    const result = await window.api.startSprint(request)
    if (!result.ok) return result.message
    set({
      sprint: result.value,
      isSample: false,
      selectedMemberId: null,
      panelTab: 'backlog',
      dialog: 'none',
      startDateSeed: null,
      undoStack: [],
      settings: await window.api.getSettings()
    })
    return null
  },

  refresh: async () => {
    const { sprint, today } = useApp.getState()
    if (!sprint?.queryUrl) return

    set({ refreshing: true, refreshStatus: null })
    const result = await window.api.refreshSprint(sprint.queryUrl)
    if (!result.ok) {
      set({ refreshing: false, refreshStatus: { ok: false, text: result.message } })
      return
    }

    const { sprint: next, summary } = applyRefresh(
      sprint,
      result.value,
      anchorFor(sprint, today),
      () => crypto.randomUUID()
    )
    // A manual time the new figures disagree with is a decision only the user can make, so
    // the whole refresh waits rather than quietly overruling them — or quietly ignoring TFS.
    const conflicts = customConflicts(sprint, result.value)
    if (conflicts.length > 0) {
      set({
        refreshing: false,
        pendingRefresh: { sprint: next, text: describe(summary), conflicts }
      })
      return
    }

    set((state) => ({
      sprint: next,
      undoStack: [...state.undoStack, { sprint, label: 'refresh' }].slice(-UNDO_DEPTH),
      refreshing: false,
      refreshStatus: { ok: true, text: describe(summary) }
    }))
    void persistSprint()
  },

  resolveRefresh: (choices) => {
    const { sprint, pendingRefresh } = useApp.getState()
    if (!sprint || !pendingRefresh) return
    const resolved = applyCustomChoices(
      pendingRefresh.sprint,
      choices,
      anchorOf(pendingRefresh.sprint),
      () => crypto.randomUUID()
    )
    set((state) => ({
      sprint: resolved,
      undoStack: [...state.undoStack, { sprint, label: 'refresh' }].slice(-UNDO_DEPTH),
      pendingRefresh: null,
      refreshStatus: { ok: true, text: pendingRefresh.text }
    }))
    void persistSprint()
  },

  // Abandoning it leaves the board exactly as it was. Nothing half-applied.
  cancelRefresh: () =>
    set({ pendingRefresh: null, refreshStatus: { ok: true, text: 'Refresh cancelled' } }),

  loadSample: () =>
    set({ sprint: createMockSprint(), isSample: true, dialog: 'none', loading: false, undoStack: [] }),

  saveNote: (draft, noteId) =>
    mutate(
      (sprint) =>
        noteId
          ? updateNote(sprint, noteId, draft)
          : addNote(sprint, draft, () => crypto.randomUUID()),
      noteId ? 'note edit' : 'note'
    ),
  removeNote: (noteId) => mutate((sprint) => deleteNote(sprint, noteId), 'note removal'),

  moveBlock: (blockId, to, index) =>
    mutate((sprint) => moveBlock(sprint, blockId, to, index), 'move'),
  pinBlock: (blockId, memberId, date, startHour) =>
    mutate((sprint) => pinBlockAt(sprint, blockId, memberId, date, startHour), 'move'),
  unpinBlock: (blockId) => mutate((sprint) => unpinBlock(sprint, blockId), 'unpin'),
  pinReported: (workItemId, memberId, date, startHour) =>
    mutate(
      (sprint) => pinReportedAt(sprint, workItemId, memberId, date, startHour),
      'reported hours'
    ),
  nudge: (direction) => {
    const blockId = useApp.getState().selectedBlockId
    if (!blockId) return
    const reported = blockId.startsWith('done:') ? Number(blockId.slice('done:'.length)) : null
    mutate(
      (sprint) =>
        reported === null
          ? nudgeBlock(sprint, blockId, direction, anchorOf(sprint))
          : nudgeReported(sprint, reported, direction, anchorOf(sprint)),
      'nudge'
    )
  },
  unpinReported: (workItemId) =>
    mutate((sprint) => unpinReported(sprint, workItemId), 'reported hours'),
  setHoursPerDay: (hoursPerDay) =>
    mutate((sprint) => setHoursPerDay(sprint, hoursPerDay), 'hours in a day'),
  syncSprintMembers: (roster) =>
    mutate((sprint) => syncSprintMembers(sprint, roster), 'team sync'),
  setCustomHours: (workItemId, hours) =>
    mutate(
      (sprint) =>
        setCustomHours(sprint, workItemId, hours, anchorOf(sprint), () => crypto.randomUUID()),
      'manual hours'
    ),
  clearCustomHours: (workItemId) =>
    mutate(
      (sprint) => clearCustomHours(sprint, workItemId, anchorOf(sprint), () => crypto.randomUUID()),
      'manual hours'
    ),
  clearSprint: () => mutate(clearCalendar, 'clear sprint'),
  applySprint: (next, label = 'change') => mutate(() => next, label),
  splitBlock: (blockId, keepHours) =>
    mutate((sprint) => splitAndReturn(sprint, blockId, keepHours, () => crypto.randomUUID()), 'split'),
  splitIntoN: (blockId, parts) =>
    mutate((sprint) => splitIntoN(sprint, blockId, parts, () => crypto.randomUUID()), 'split'),
  setDayCapacity: (date, capacity, label) =>
    mutate((sprint) => setDayCapacity(sprint, date, capacity, label), 'day capacity'),
  setMemberCapacity: (memberId, date, capacity) =>
    mutate((sprint) => setMemberCapacity(sprint, memberId, date, capacity), 'capacity'),
  lockDay: (date) =>
    mutate(
      (sprint) => lockDay(sprint, date, anchorOf(sprint), () => crypto.randomUUID()),
      'lock day'
    ),
  unlockDay: (date) => mutate((sprint) => unlockDay(sprint, date), 'unlock day'),

  loadSprintList: async () => {
    if (!window.api) return
    const sprintList = await window.api.listSprints()
    set({ sprintList })
  },

  switchSprint: async (id) => {
    if (!window.api) return
    const result = await window.api.switchSprint(id)
    if (!result.ok) return
    const sprintList = await window.api.listSprints()
    set({
      sprint: opened(result.value),
      isSample: false,
      selectedMemberId: null,
      panelTab: 'backlog',
      dialog: 'none',
      undoStack: [],
      sprintList,
      settings: await window.api.getSettings()
    })
    scheduleBaseline()
  }
}))

const ZOOM_KEY = 'sprint-viewer.hourWidth'

/**
 * The zoom the user left the calendar at. A stop rather than any remembered number, so a value
 * written by an older build — or edited by hand — cannot put the grid at a width the `−`/`+`
 * buttons have no way back from.
 */
function storedHourWidth(): number {
  try {
    const stored = Number(localStorage.getItem(ZOOM_KEY))
    return HOUR_W_STEPS.includes(stored) ? stored : DEFAULT_HOUR_W
  } catch {
    return DEFAULT_HOUR_W
  }
}

function rememberHourWidth(hourWidth: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(hourWidth))
  } catch {
    // A zoom that is not remembered is a smaller problem than one that cannot be changed.
  }
}

/**
 * A sprint as it opens. Boards built before reported-only tasks lost their blocks still carry
 * them, and they would be drawn twice; this brings them into line the moment the sprint is
 * loaded rather than waiting for a refresh.
 */
function opened(sprint: Sprint | null): Sprint | null {
  if (!sprint) return sprint
  const anchor = anchorFor(sprint, useApp.getState().today)
  let { sprint: aligned } = alignReportedOnly(sprint, anchor)
  // A sprint refreshed before past days became a fixed record starts one from exactly what it
  // shows now, so upgrading moves nothing and the next refresh only adds to it.
  if (!aligned.pastRecord && aligned.lastRefreshedAt) {
    aligned = { ...aligned, pastRecord: recordPast(aligned, anchor) }
  }
  if (aligned !== sprint) queueMicrotask(() => void persistSprint())
  return aligned
}

/** The day scheduling resumes from, for transforms that need it. */
function anchorOf(sprint: Sprint): ISODate {
  return anchorFor(sprint, useApp.getState().today)
}

/** How many steps back the button can go before the oldest is forgotten. */
const UNDO_DEPTH = 50

/**
 * Applies a transform to the current sprint and saves the result. Writing is fire-and-forget:
 * the UI already reflects the change, and a failed write is reported rather than rolled back,
 * since undoing a drag the user just watched land would be worse than telling them.
 *
 * @param label What the back button should say it will undo. `null` for a change that is not
 *   an operation — the tag filter is stored on the sprint only so it survives a restart, and
 *   going back a step should not alter what the user is looking at.
 */
function mutate(transform: (sprint: Sprint) => Sprint, label: string | null): void {
  const { sprint, undoStack } = useApp.getState()
  if (!sprint) return
  const next = transform(sprint)
  if (next === sprint) return
  useApp.setState({
    sprint: next,
    undoStack:
      label === null ? undoStack : [...undoStack, { sprint, label }].slice(-UNDO_DEPTH)
  })
  void persistSprint()
}

/** Plain-language account of what a refresh changed. */
function describe(summary: RefreshSummary): string {
  const parts: string[] = []
  if (summary.updated) parts.push(`${summary.updated} updated`)
  if (summary.completed) parts.push(`${summary.completed} finished`)
  if (summary.added) parts.push(`${summary.added} new`)
  if (summary.missing) parts.push(`${summary.missing} no longer in the query`)
  return parts.length === 0 ? 'Up to date' : parts.join(', ')
}

/**
 * For components that only ever render once a sprint is loaded, so they can read it without
 * a null check on every access.
 */
export function useSprint(): Sprint {
  const sprint = useApp((s) => s.sprint)
  if (!sprint) throw new Error('useSprint was called with no sprint loaded')
  return sprint
}

/** Writes the current sprint to disk. Sample sprints are deliberately not persisted. */
export async function persistSprint(): Promise<void> {
  const { sprint, isSample } = useApp.getState()
  if (!sprint || isSample) return
  const result = await window.api.saveSprint(sprint)
  useApp.setState({ saveError: result.ok ? null : result.message })
  scheduleBaseline()
}

let baselineTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Keeps the automatic "Sprint start" snapshot up to date — see `baseline.ts` for when that
 * means anything at all. Every save lands here, and a drag or a burst of Shift+arrow presses is
 * many saves, so it waits for the changes to stop before writing a whole snapshot to disk.
 */
function scheduleBaseline(): void {
  if (baselineTimer) clearTimeout(baselineTimer)
  baselineTimer = setTimeout(() => {
    const { sprint, isSample, today } = useApp.getState()
    if (!sprint || isSample || !window.api?.ensureBaseline) return
    void window.api.ensureBaseline(sprint, today)
  }, 1500)
}
