import { app, ipcMain } from 'electron'
import type {
  AppSettings,
  SprintSummary,
  StartSprintRequest,
  WritableSettings
} from '@shared/settings'
import type { TaskDraft } from '@shared/taskCreation'
import type { Sprint } from '@shared/types'
import { exportNotes, exportSnapshot, saveSummary } from './handlers/files'
import { startSprint, switchSprint } from './handlers/sprint'
import {
  createTasks,
  fetchSprintItems,
  listTeams,
  teamMembers,
  testConnection
} from './handlers/tfs'
import { openSnapshotWindow } from './index'
import { guard } from './result'
import {
  clearPat,
  deleteSnapshot,
  ensureBaseline,
  getSettings,
  listSnapshots,
  listSprints,
  loadSnapshot,
  loadSprint,
  saveSprint,
  setPat,
  storageRoot,
  takeSnapshot,
  updateSettings
} from './storage'
import { sanitiseDrafts, writable } from './validate'

/**
 * Everything the renderer can ask the main process to do — one line per route. What each one
 * does lives in `handlers/` and `storage.ts`; what the renderer may send is checked in
 * `validate.ts`. Routes that can fail answer with a `Result` (see `result.ts`).
 */
export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:storagePath', () => storageRoot())

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_event, patch: WritableSettings) =>
    updateSettings(writable(patch))
  )
  ipcMain.handle('settings:setPat', (_event, token: string) => guard(() => setPat(token)))
  ipcMain.handle('settings:clearPat', () => clearPat())

  ipcMain.handle('tfs:test', (_event, url: string) => testConnection(url))
  ipcMain.handle('tfs:createTasks', (_event, url: string, parentId: number, drafts: TaskDraft[]) =>
    guard(() => createTasks(url, Number(parentId), sanitiseDrafts(drafts)))
  )
  ipcMain.handle('tfs:listTeams', (_event, url: string) => guard(() => listTeams(url)))
  ipcMain.handle('tfs:teamMembers', (_event, url: string, teamId: string) =>
    guard(() => teamMembers(url, String(teamId)))
  )

  ipcMain.handle('sprint:start', (_event, request: StartSprintRequest) =>
    guard(() => startSprint(request))
  )
  ipcMain.handle('sprint:refresh', (_event, url: string) => guard(() => fetchSprintItems(url)))
  ipcMain.handle('sprint:save', (_event, sprint: Sprint) => guard(() => saveSprint(sprint)))
  ipcMain.handle('sprint:load', (_event, id: string) => loadSprint(id))
  ipcMain.handle('sprint:list', (): Promise<SprintSummary[]> => listSprints())
  ipcMain.handle('sprint:switch', (_event, id: string) => guard(() => switchSprint(id)))
  ipcMain.handle('sprint:saveSummary', (_event, sprintName: string, markdown: string) =>
    guard(() => saveSummary(sprintName, markdown))
  )
  ipcMain.handle('sprint:exportNotes', (_event, sprintId: string) =>
    guard(() => exportNotes(sprintId))
  )

  ipcMain.handle('snapshot:take', (_event, sprint: Sprint, name: string) =>
    guard(() => takeSnapshot(sprint, name))
  )
  ipcMain.handle('snapshot:baseline', (_event, sprint: Sprint, today: string) =>
    guard(() => ensureBaseline(sprint, String(today)))
  )
  ipcMain.handle('snapshot:list', (_event, sprintId: string) => listSnapshots(sprintId))
  ipcMain.handle('snapshot:load', (_event, sprintId: string, id: string) =>
    loadSnapshot(sprintId, id)
  )
  ipcMain.handle('snapshot:delete', (_event, sprintId: string, id: string) =>
    guard(() => deleteSnapshot(sprintId, id))
  )
  ipcMain.handle('snapshot:open', (_event, sprintId: string, id: string) => {
    openSnapshotWindow(sprintId, id)
  })
  ipcMain.handle('snapshot:export', (_event, sprintId: string, id: string) =>
    guard(() => exportSnapshot(sprintId, id))
  )
}

export type { AppSettings }
