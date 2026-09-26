import { create } from 'zustand'
import type { Sprint } from '@shared/types'
import { createBoardSlice } from './boardSlice'
import { createDialogSlice } from './dialogSlice'
import { persistSprint as persistSprintIn } from './persistence'
import { createRefreshSlice } from './refreshSlice'
import { createSprintSlice } from './sprintSlice'
import type { AppState } from './types'
import { createViewSlice } from './viewSlice'

/**
 * The app's state, in one zustand store made of slices:
 *
 *   sprintSlice   the open sprint, settings, loading, switching sprints
 *   boardSlice    every change to the board, undo, creating tasks
 *   refreshSlice  re-reading from TFS and settling manual-hour conflicts
 *   viewSlice     selection, panel, zoom, backlog filter — not part of the plan
 *   dialogSlice   which dialog is open and what it acts on
 *
 * Board changes are pure transforms from `@shared` run through `mutate` in `persistence.ts`,
 * which is what makes them undoable and saved.
 */
export const useApp = create<AppState>()((...args) => ({
  ...createSprintSlice(...args),
  ...createBoardSlice(...args),
  ...createRefreshSlice(...args),
  ...createViewSlice(...args),
  ...createDialogSlice(...args)
}))

export type { DialogKind, NoteTarget, PanelTab } from './types'

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
export function persistSprint(): Promise<void> {
  return persistSprintIn(useApp)
}
