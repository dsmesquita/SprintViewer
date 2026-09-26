import type { StateCreator } from 'zustand'
import { applyCustomChoices, customConflicts } from '@shared/customHours'
import { applyRefresh, type RefreshSummary } from '@shared/refresh'
import { anchorFor } from '@shared/scheduling'
import { anchorOf, persistSprint, UNDO_DEPTH } from './persistence'
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
      refreshStatus: { ok: true, text: describe(summary) }
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
      refreshStatus: { ok: true, text: pendingRefresh.text }
    }))
    void persistSprint(store)
  },

  // Abandoning it leaves the board exactly as it was. Nothing half-applied.
  cancelRefresh: () =>
    set({ pendingRefresh: null, refreshStatus: { ok: true, text: 'Refresh cancelled' } })
})

/** Plain-language account of what a refresh changed. */
function describe(summary: RefreshSummary): string {
  const parts: string[] = []
  if (summary.updated) parts.push(`${summary.updated} updated`)
  if (summary.completed) parts.push(`${summary.completed} finished`)
  if (summary.added) parts.push(`${summary.added} new`)
  if (summary.missing) parts.push(`${summary.missing} no longer in the query`)
  return parts.length === 0 ? 'Up to date' : parts.join(', ')
}
