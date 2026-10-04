import { contextBridge, ipcRenderer } from 'electron'
import type { ExportFile } from '@shared/calendarExport'
import type { Result } from '@shared/ipc'
import type {
  AppSettings,
  ChildQueryMode,
  ConnectionResult,
  SprintSummary,
  StartSprintRequest,
  WritableSettings
} from '@shared/settings'
import type { Snapshot, SnapshotMeta } from '@shared/snapshots'
import type { TfsPerson, TfsTeam } from '@shared/squad'
import type { CreateTasksResult, TaskDraft } from '@shared/taskCreation'
import type { Sprint, WorkItem } from '@shared/types'

/**
 * The only bridge between the renderer and the main process. Kept deliberately narrow: there
 * is no route that returns a decrypted PAT, no file handle, and no raw `ipcRenderer`.
 */
const api = {
  // Opened by the main process, which only lets web addresses through.
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getStoragePath: (): Promise<string> => ipcRenderer.invoke('app:storagePath'),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: WritableSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  setPat: (token: string): Promise<Result<AppSettings>> =>
    ipcRenderer.invoke('settings:setPat', token),
  clearPat: (): Promise<AppSettings> => ipcRenderer.invoke('settings:clearPat'),

  testConnection: (url: string): Promise<ConnectionResult> => ipcRenderer.invoke('tfs:test', url),

  createTasks: (
    queryUrl: string,
    parentId: number,
    drafts: TaskDraft[]
  ): Promise<Result<CreateTasksResult>> =>
    ipcRenderer.invoke('tfs:createTasks', queryUrl, parentId, drafts),

  listTeams: (url: string): Promise<Result<{ teams: TfsTeam[]; suggested?: string }>> =>
    ipcRenderer.invoke('tfs:listTeams', url),
  teamMembers: (url: string, teamId: string): Promise<Result<TfsPerson[]>> =>
    ipcRenderer.invoke('tfs:teamMembers', url, teamId),

  startSprint: (request: StartSprintRequest): Promise<Result<Sprint>> =>
    ipcRenderer.invoke('sprint:start', request),
  refreshSprint: (queryUrl: string, childQueryMode?: ChildQueryMode): Promise<Result<WorkItem[]>> =>
    ipcRenderer.invoke('sprint:refresh', queryUrl, childQueryMode),
  saveSprint: (sprint: Sprint): Promise<Result<void>> => ipcRenderer.invoke('sprint:save', sprint),
  loadSprint: (id: string): Promise<Sprint | null> => ipcRenderer.invoke('sprint:load', id),
  listSprints: (): Promise<SprintSummary[]> => ipcRenderer.invoke('sprint:list'),
  switchSprint: (id: string): Promise<Result<Sprint>> => ipcRenderer.invoke('sprint:switch', id),
  saveSummary: (sprintName: string, markdown: string): Promise<Result<string | null>> =>
    ipcRenderer.invoke('sprint:saveSummary', sprintName, markdown),
  exportNotes: (sprintId: string): Promise<Result<string | null>> =>
    ipcRenderer.invoke('sprint:exportNotes', sprintId),
  /** Saves calendar exports: one file where the user picks, several into a folder they pick. */
  exportCalendar: (files: ExportFile[]): Promise<Result<string[] | null>> =>
    ipcRenderer.invoke('sprint:exportCalendar', files),

  /** Keeps the board, and the calendar exactly as it is drawn on `today`. */
  takeSnapshot: (sprint: Sprint, name: string, today: string): Promise<Result<SnapshotMeta>> =>
    ipcRenderer.invoke('snapshot:take', sprint, name, today),
  ensureBaseline: (
    sprint: Sprint,
    today: string
  ): Promise<Result<{ action: 'none' | 'take' | 'replace'; meta?: SnapshotMeta }>> =>
    ipcRenderer.invoke('snapshot:baseline', sprint, today),
  listSnapshots: (sprintId: string): Promise<SnapshotMeta[]> =>
    ipcRenderer.invoke('snapshot:list', sprintId),
  loadSnapshot: (sprintId: string, id: string): Promise<Snapshot | null> =>
    ipcRenderer.invoke('snapshot:load', sprintId, id),
  deleteSnapshot: (sprintId: string, id: string): Promise<Result<void>> =>
    ipcRenderer.invoke('snapshot:delete', sprintId, id),
  openSnapshot: (sprintId: string, id: string): Promise<void> =>
    ipcRenderer.invoke('snapshot:open', sprintId, id),
  exportSnapshot: (sprintId: string, id: string): Promise<Result<string | null>> =>
    ipcRenderer.invoke('snapshot:export', sprintId, id)
}

export type SprintViewerApi = typeof api

contextBridge.exposeInMainWorld('api', api)
