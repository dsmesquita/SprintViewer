import type { StateCreator } from 'zustand'
import { clearCustomHours, setCustomHours } from '@shared/customHours'
import {
  clearCalendar,
  lockDay,
  moveBlock,
  pinBlockAt,
  pinReportedAt,
  setDayCapacity,
  setHoursPerDay,
  setMemberCapacity,
  setQueryUrl,
  splitAndReturn,
  splitIntoN,
  unlockDay,
  unpinBlock,
  unpinReported
} from '@shared/mutations'
import { addNote, deleteNote, updateNote } from '@shared/notes'
import { returnDoneToBacklog } from '@shared/doneHours'
import { hideInBacklog, unhideInBacklog } from '@shared/hiddenBacklog'
import { nudgeBlock, nudgeReported } from '@shared/nudge'
import { syncSprintMembers } from '@shared/squad'
import { applySprintSettings } from '@shared/sprintSettings'
import { showAllTags, toggleTag } from '@shared/tags'
import { addCreatedTasks } from '@shared/taskCreation'
import { anchorOf, mutate, persistSprint } from './persistence'
import type { AppState, BoardSlice } from './types'

const newId = (): string => crypto.randomUUID()

/**
 * Every change to the board. Each is a pure transform from `@shared` run through `mutate`,
 * which is what makes it undoable and saved.
 */
export const createBoardSlice: StateCreator<AppState, [], [], BoardSlice> = (set, get, store) => {
  const change = (transform: Parameters<typeof mutate>[1], label: string | null): void =>
    mutate(store, transform, label)
  const anchor = (sprint: Parameters<typeof anchorOf>[1]) => anchorOf(store, sprint)

  return {
    undoStack: [],

    undo: () =>
      set((state) => {
        const previous = state.undoStack[state.undoStack.length - 1]
        if (!previous || !state.sprint) return state
        // The tag filter is a view preference rather than an operation, so going back a step
        // must not change what the user is looking at.
        const sprint = { ...previous.sprint, hiddenTags: state.sprint.hiddenTags }
        queueMicrotask(() => void persistSprint(store))
        return { ...state, sprint, undoStack: state.undoStack.slice(0, -1) }
      }),

    // The tag filter is part of the plan rather than a view preference, so unlike the search
    // box it lives on the sprint and is written to disk.
    toggleTag: (tag) => change((sprint) => toggleTag(sprint, tag), null),
    showAllTags: () => change((sprint) => showAllTags(sprint), null),
    hideInBacklog: (workItemId) =>
      change((sprint) => hideInBacklog(sprint, workItemId), 'hide from backlog'),
    unhideInBacklog: (workItemId) =>
      change((sprint) => unhideInBacklog(sprint, workItemId), 'unhide'),

    saveNote: (draft, noteId) =>
      change(
        (sprint) => (noteId ? updateNote(sprint, noteId, draft) : addNote(sprint, draft, newId)),
        noteId ? 'note edit' : 'note'
      ),
    removeNote: (noteId) => change((sprint) => deleteNote(sprint, noteId), 'note removal'),

    moveBlock: (blockId, to, index) =>
      change((sprint) => moveBlock(sprint, blockId, to, index), 'move'),
    pinBlock: (blockId, memberId, date, startHour) =>
      change((sprint) => pinBlockAt(sprint, blockId, memberId, date, startHour), 'move'),
    unpinBlock: (blockId) => change((sprint) => unpinBlock(sprint, blockId), 'unpin'),
    pinReported: (workItemId, memberId, date, startHour) =>
      change(
        (sprint) => pinReportedAt(sprint, workItemId, memberId, date, startHour),
        'reported hours'
      ),
    nudge: (direction) => {
      const blockId = get().selectedBlockId
      if (!blockId) return
      const reported = blockId.startsWith('done:') ? Number(blockId.slice('done:'.length)) : null
      change(
        (sprint) =>
          reported === null
            ? nudgeBlock(sprint, blockId, direction, anchor(sprint))
            : nudgeReported(sprint, reported, direction, anchor(sprint), get().today),
        'nudge'
      )
    },
    unpinReported: (workItemId) =>
      change((sprint) => unpinReported(sprint, workItemId), 'reported hours'),
    returnDoneToBacklog: (workItemId) =>
      change((sprint) => returnDoneToBacklog(sprint, workItemId), 'done hours'),
    setHoursPerDay: (hoursPerDay) =>
      change((sprint) => setHoursPerDay(sprint, hoursPerDay), 'hours in a day'),
    syncSprintMembers: (roster) =>
      change((sprint) => syncSprintMembers(sprint, roster), 'team sync'),
    setCustomHours: (workItemId, hours) =>
      change(
        (sprint) => setCustomHours(sprint, workItemId, hours, anchor(sprint), newId),
        'manual hours'
      ),
    clearCustomHours: (workItemId) =>
      change(
        (sprint) => clearCustomHours(sprint, workItemId, anchor(sprint), newId),
        'manual hours'
      ),
    clearSprint: () => change(clearCalendar, 'clear sprint'),
    setQueryUrl: (url) => change((sprint) => setQueryUrl(sprint, url), 'query URL'),
    applySprintSettings: (next) =>
      change((sprint) => applySprintSettings(sprint, next), 'sprint settings'),
    applySprint: (next, label = 'change') => change(() => next, label),
    splitBlock: (blockId, keepHours) =>
      change((sprint) => splitAndReturn(sprint, blockId, keepHours, newId), 'split'),
    splitIntoN: (blockId, parts) =>
      change((sprint) => splitIntoN(sprint, blockId, parts, newId), 'split'),
    setDayCapacity: (date, capacity, label) =>
      change((sprint) => setDayCapacity(sprint, date, capacity, label), 'day capacity'),
    setMemberCapacity: (memberId, date, capacity) =>
      change((sprint) => setMemberCapacity(sprint, memberId, date, capacity), 'capacity'),
    lockDay: (date) => change((sprint) => lockDay(sprint, date, anchor(sprint), newId), 'lock day'),
    unlockDay: (date) => change((sprint) => unlockDay(sprint, date), 'unlock day'),

    createTasks: async (parentId, drafts) => {
      const { sprint } = get()
      if (!sprint?.queryUrl) return 'Only a sprint imported from TFS can have tasks created in it.'
      if (!window.api) return 'Creating tasks needs the desktop app.'
      const result = await window.api.createTasks(sprint.queryUrl, parentId, drafts)
      if (!result.ok) return result.message
      // Applied to the sprint as it is *now*, not as it was when the request went out: the
      // requests take a while, and the user may have kept planning in the meantime.
      change((current) => addCreatedTasks(current, result.value.created, newId), 'create tasks')
      return result.value
    }
  }
}
