import { askAbout } from './refreshSlice'
import type { StateCreator } from 'zustand'
import { createMockSprint } from '@shared/mock'
import { opened, scheduleBaseline } from './persistence'
import type { AppState, SprintSlice } from './types'

/** The open sprint, where it came from, and moving between sprints. */
export const createSprintSlice: StateCreator<AppState, [], [], SprintSlice> = (
  set,
  _get,
  store
) => ({
  sprint: null,
  isSample: false,
  settings: null,
  loading: true,
  saveError: null,
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
    set({
      settings,
      sprint: opened(store, sprint, settings),
      sprintList,
      isSample: false,
      loading: false,
      undoStack: []
    })
    scheduleBaseline(store)
  },

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
      settings: await window.api.getSettings(),
      doneQuestion: askAbout(result.value)
    })
    return null
  },

  loadSample: () =>
    set({
      sprint: createMockSprint(),
      isSample: true,
      dialog: 'none',
      loading: false,
      undoStack: []
    }),

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
      sprint: opened(store, result.value),
      isSample: false,
      selectedMemberId: null,
      panelTab: 'backlog',
      dialog: 'none',
      undoStack: [],
      sprintList,
      settings: await window.api.getSettings()
    })
    scheduleBaseline(store)
  }
})
