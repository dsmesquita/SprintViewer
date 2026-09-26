import type { StoreApi } from 'zustand'
import { alignReportedOnly } from '@shared/refresh'
import { anchorFor, recordPast } from '@shared/scheduling'
import type { ISODate, Sprint } from '@shared/types'
import type { AppState } from './types'

/**
 * What every change to the board goes through: undo, saving to disk, and the automatic
 * "Sprint start" snapshot. Each takes the store it acts on, so the slices can use them without
 * importing the store they are part of.
 */

export type Store = StoreApi<AppState>

/** How many steps back the button can go before the oldest is forgotten. */
export const UNDO_DEPTH = 50

/**
 * Applies a transform to the current sprint and saves the result. Writing is fire-and-forget:
 * the UI already reflects the change, and a failed write is reported rather than rolled back,
 * since undoing a drag the user just watched land would be worse than telling them.
 *
 * @param label What the back button should say it will undo. `null` for a change that is not
 *   an operation — the tag filter is stored on the sprint only so it survives a restart, and
 *   going back a step should not alter what the user is looking at.
 */
export function mutate(
  store: Store,
  transform: (sprint: Sprint) => Sprint,
  label: string | null
): void {
  const { sprint, undoStack } = store.getState()
  if (!sprint) return
  const next = transform(sprint)
  if (next === sprint) return
  store.setState({
    sprint: next,
    undoStack: label === null ? undoStack : [...undoStack, { sprint, label }].slice(-UNDO_DEPTH)
  })
  void persistSprint(store)
}

/** Writes the current sprint to disk. Sample sprints are deliberately not persisted. */
export async function persistSprint(store: Store): Promise<void> {
  const { sprint, isSample } = store.getState()
  if (!sprint || isSample) return
  const result = await window.api.saveSprint(sprint)
  store.setState({ saveError: result.ok ? null : result.message })
  scheduleBaseline(store)
}

let baselineTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Keeps the automatic "Sprint start" snapshot up to date — see `baseline.ts` for when that
 * means anything at all. Every save lands here, and a drag or a burst of Shift+arrow presses is
 * many saves, so it waits for the changes to stop before writing a whole snapshot to disk.
 */
export function scheduleBaseline(store: Store): void {
  if (baselineTimer) clearTimeout(baselineTimer)
  baselineTimer = setTimeout(() => {
    const { sprint, isSample, today } = store.getState()
    if (!sprint || isSample || !window.api?.ensureBaseline) return
    void window.api.ensureBaseline(sprint, today)
  }, 1500)
}

/**
 * A sprint as it opens. Boards built before reported-only tasks lost their blocks still carry
 * them, and they would be drawn twice; this brings them into line the moment the sprint is
 * loaded rather than waiting for a refresh.
 */
export function opened(store: Store, sprint: Sprint | null): Sprint | null {
  if (!sprint) return sprint
  const anchor = anchorFor(sprint, store.getState().today)
  let { sprint: aligned } = alignReportedOnly(sprint, anchor)
  // A sprint refreshed before past days became a fixed record starts one from exactly what it
  // shows now, so upgrading moves nothing and the next refresh only adds to it.
  if (!aligned.pastRecord && aligned.lastRefreshedAt) {
    aligned = { ...aligned, pastRecord: recordPast(aligned, anchor) }
  }
  if (aligned !== sprint) queueMicrotask(() => void persistSprint(store))
  return aligned
}

/** The day scheduling resumes from, for transforms that need it. */
export function anchorOf(store: Store, sprint: Sprint): ISODate {
  return anchorFor(sprint, store.getState().today)
}
