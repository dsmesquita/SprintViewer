import type { StateCreator } from 'zustand'
import { applyCustomChoices, customConflicts } from '@shared/customHours'
import { doneToDecide, keepDoneInBacklog, placeDone } from '@shared/doneHours'
import { applyRefresh, type RefreshSummary } from '@shared/refresh'
import { anchorFor } from '@shared/scheduling'
import { anchorOf, mutate, persistSprint, UNDO_DEPTH } from './persistence'
import type { Sprint } from '@shared/types'
import type { AppState, RefreshSlice } from './types'

/** Re-reading the sprint from TFS, and settling any disagreement with hours set by hand. */
export const createRefreshSlice: StateCreator<AppState, [], [], RefreshSlice> = (
  set,
  get,
  store
) => ({
  refreshing: false,
  refreshStatus: null,
  pendingRefresh: null,
  doneQuestion: null,

  answerDoneQuestion: (place) => {
    const ids = get().doneQuestion ?? []
    set({ doneQuestion: null })
    mutate(store, (sprint) => (place ? placeDone : keepDoneInBacklog)(sprint, ids), 'done hours')
  },

  // Not answering is not an answer: nothing is recorded, and the next refresh asks again.
  dismissDoneQuestion: () => set({ doneQuestion: null }),

  refresh: async () => {
    const { sprint, today } = get()
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
      refreshStatus: { ok: true, text: describe(summary) },
      doneQuestion: askAbout(next)
    }))
    void persistSprint(store)
  },

  resolveRefresh: (choices) => {
    const { sprint, pendingRefresh } = get()
    if (!sprint || !pendingRefresh) return
    const resolved = applyCustomChoices(
      pendingRefresh.sprint,
      choices,
      anchorOf(store, pendingRefresh.sprint),
      () => crypto.randomUUID()
    )
    set((state) => ({
      sprint: resolved,
      undoStack: [...state.undoStack, { sprint, label: 'refresh' }].slice(-UNDO_DEPTH),
      pendingRefresh: null,
      refreshStatus: { ok: true, text: pendingRefresh.text },
      doneQuestion: askAbout(resolved)
    }))
    void persistSprint(store)
  },

  // Abandoning it leaves the board exactly as it was. Nothing half-applied.
  cancelRefresh: () =>
    set({ pendingRefresh: null, refreshStatus: { ok: true, text: 'Refresh cancelled' } })
})

/** The done hours to ask about after a refresh or an import, or nothing to ask. */
export function askAbout(sprint: Sprint): number[] | null {
  const ids = doneToDecide(sprint)
  return ids.length > 0 ? ids : null
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
