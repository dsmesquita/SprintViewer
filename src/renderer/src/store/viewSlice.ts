import type { StateCreator } from 'zustand'
import { todayISO } from '@shared/dates'
import { DEFAULT_HOUR_W, HOUR_W_STEPS, stepZoom } from '../grid'
import type { AppState, ViewSlice } from './types'

/** What is being looked at, and how. None of it is part of the plan or undoable. */
export const createViewSlice: StateCreator<AppState, [], [], ViewSlice> = (set, get) => ({
  today: todayISO(),
  selectedMemberId: null,
  pickedMembers: [],
  pickAnchor: null,
  selectedWorkItemId: null,
  selectedBlockId: null,
  panelCollapsed: false,
  panelTab: 'backlog',
  highlightedWorkItemId: null,
  hourWidth: storedHourWidth(),
  backlogSearch: '',
  collapsedGroups: [],
  showHiddenBacklog: false,

  selectMember: (memberId) =>
    set({ selectedMemberId: memberId, panelTab: 'person', panelCollapsed: false }),
  pickMember: (memberId, mode) => {
    const { pickedMembers, pickAnchor, selectedMemberId, sprint } = get()
    if (mode === 'only') {
      set({ pickedMembers: [], pickAnchor: memberId })
      return
    }
    // The name whose panel is open counts as picked: Ctrl+click on a second name picks both.
    const current =
      pickedMembers.length === 0 && selectedMemberId ? [selectedMemberId] : pickedMembers
    if (mode === 'toggle') {
      set({
        pickedMembers: current.includes(memberId)
          ? current.filter((id) => id !== memberId)
          : [...current, memberId],
        pickAnchor: memberId
      })
      return
    }
    const order = (sprint?.members ?? []).map((member) => member.id)
    const from = order.indexOf(pickAnchor ?? selectedMemberId ?? memberId)
    const to = order.indexOf(memberId)
    if (from < 0 || to < 0) return
    set({ pickedMembers: order.slice(Math.min(from, to), Math.max(from, to) + 1) })
  },
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
  setShowHiddenBacklog: (showHiddenBacklog) => set({ showHiddenBacklog }),
  toggleGroup: (key) =>
    set((state) => ({
      collapsedGroups: state.collapsedGroups.includes(key)
        ? state.collapsedGroups.filter((other) => other !== key)
        : [...state.collapsedGroups, key]
    })),
  setCollapsedGroups: (collapsedGroups) => set({ collapsedGroups })
})

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
