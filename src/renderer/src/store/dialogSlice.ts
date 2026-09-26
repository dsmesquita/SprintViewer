import type { StateCreator } from 'zustand'
import type { AppState, DialogSlice } from './types'

/** Which dialog is open, and what it is acting on. One at a time. */
export const createDialogSlice: StateCreator<AppState, [], [], DialogSlice> = (set) => ({
  dialog: 'none',
  startDateSeed: null,
  splitTarget: null,
  noteTarget: null,
  hoursTarget: null,
  createTasksParent: null,

  openDialog: (dialog, startDateSeed) => set({ dialog, startDateSeed: startDateSeed ?? null }),
  openSplit: (blockId) => set({ dialog: 'split', splitTarget: blockId }),
  openNote: (noteTarget) => set({ dialog: 'note', noteTarget }),
  openHours: (hoursTarget) => set({ dialog: 'hours', hoursTarget }),
  openCreateTasks: (createTasksParent) => set({ dialog: 'create-tasks', createTasksParent }),
  closeDialog: () =>
    set({
      dialog: 'none',
      startDateSeed: null,
      splitTarget: null,
      noteTarget: null,
      hoursTarget: null,
      createTasksParent: null
    })
})
