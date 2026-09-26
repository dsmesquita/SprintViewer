import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, dialog, ipcMain, session } from 'electron'
import { buildSprintDays } from '@shared/dates'
import { schedulableItems } from '@shared/grouping'
import { plannedHours } from '@shared/sizing'
import { fail, ok, type Result } from '@shared/ipc'
import type {
  AppSettings,
  ConnectionResult,
  SprintSummary,
  StartSprintRequest,
  WritableSettings
} from '@shared/settings'
import { parseTags, type TaskDraft } from '@shared/taskCreation'
import type { Block, Note, Sprint, WorkItem } from '@shared/types'
import { openSnapshotWindow } from './index'
import {
  clearPat,
  deleteSnapshot,
  ensureBaseline,
  getSettings,
  listSnapshots,
  listSprints,
  loadSnapshot,
  loadSprint,
  newSprintId,
  readPat,
  takeSnapshot,
  saveSprint,
  setPat,
  storageRoot,
  updateSettings
} from './storage'
import { TfsClient, TfsError, type TfsCredentials } from './tfs/client'
import { parseTfsUrl, TfsUrlError, type ParsedTfsUrl } from './tfs/url'

/** Everything the renderer can ask the main process to do. */
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
  ipcMain.handle('sprint:start', (_event, request: StartSprintRequest) =>
    guard(() => startSprint(request))
  )
  // Refresh only fetches. The reconciliation runs in the renderer, where the sprint lives,
  // so the main process never has to hold a second copy of it.
  ipcMain.handle('sprint:refresh', (_event, queryUrl: string) =>
    guard(async () => {
      const { client } = await clientFor(queryUrl)
      const items = await client.fetchSprintItems((await getSettings()).childQueryMode ?? 'auto')
      await rememberBusinessOrderField(client)
      return items
    })
  )
  // The one route that writes to TFS. It needs the sprint's own URL only to know which server
  // and project to talk to; the parent is named by id and read afresh there.
  ipcMain.handle('tfs:createTasks', (_event, queryUrl: string, parentId: number, drafts: TaskDraft[]) =>
    guard(async () => {
      const { client } = await clientFor(queryUrl)
      return client.createTasks(Number(parentId), sanitiseDrafts(drafts))
    })
  )
  // Reading the team for the roster sync. Keyed by whatever URL Settings has, since the project
  // is all that is needed from it.
  ipcMain.handle('tfs:listTeams', (_event, url: string) =>
    guard(async () => {
      const { client, target } = await clientFor(url)
      const teams = await client.listTeams()
      // The team a board or sprint URL names, else the one TFS creates with every project.
      const wanted = [target.team, target.project && `${target.project} Team`]
        .filter((name): name is string => Boolean(name))
        .map((name) => name.toLowerCase())
      const suggested = wanted
        .map((name) => teams.find((team) => team.name.toLowerCase() === name))
        .find(Boolean)?.id
      return { teams, suggested }
    })
  )
  ipcMain.handle('tfs:teamMembers', (_event, url: string, teamId: string) =>
    guard(async () => (await clientFor(url)).client.teamMembers(String(teamId)))
  )
  ipcMain.handle('sprint:save', (_event, sprint: Sprint) => guard(() => saveSprint(sprint)))
  ipcMain.handle('sprint:load', (_event, id: string) => loadSprint(id))
  ipcMain.handle('sprint:list', (): Promise<SprintSummary[]> => listSprints())
  ipcMain.handle('sprint:switch', (_event, id: string) =>
    guard(async () => {
      const sprint = await loadSprint(id)
      if (!sprint) throw new Error('Sprint not found.')
      await updateSettings({ activeSprintId: id })
      return sprint
    })
  )
  // The summary is written in the renderer, which holds the live sprint; this only saves it.
  ipcMain.handle('sprint:saveSummary', (_event, sprintName: string, markdown: string) =>
    guard(async () => {
      const suggested = `${String(sprintName).replace(/[^\w -]+/g, '')} summary.md`
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: suggested,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, String(markdown), 'utf8')
      return filePath
    })
  )
  ipcMain.handle('sprint:exportNotes', (_event, sprintId: string) =>
    guard(async () => {
      const sprint = await loadSprint(sprintId)
      if (!sprint) throw new Error('Sprint not found.')
      const md = buildNotesMarkdown(sprint)
      const suggested = `${sprint.name.replace(/[^\w -]+/g, '')} notes.md`
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: suggested,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, md, 'utf8')
      return path.basename(filePath)
    })
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
    guard(async () => {
      const snapshot = await loadSnapshot(sprintId, id)
      if (!snapshot) throw new Error('That snapshot is no longer on disk.')
      const suggested = `${snapshot.name.replace(/[^\w -]+/g, '')} snapshot.json`
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: suggested,
        filters: [{ name: 'Snapshot', extensions: ['json'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8')
      return filePath
    })
  )
}

/**
 * Whitelists the settings the renderer may write. Without this an `Object.assign` of the
 * incoming patch could overwrite the encrypted token with an attacker-chosen value.
 */
function writable(patch: WritableSettings): WritableSettings {
  const allowed: WritableSettings = {}
  if (patch.authMode === 'pat' || patch.authMode === 'windows') allowed.authMode = patch.authMode
  if (typeof patch.lastQueryUrl === 'string') allowed.lastQueryUrl = patch.lastQueryUrl
  if (Array.isArray(patch.trustedHosts)) allowed.trustedHosts = patch.trustedHosts.map(String)
  if (Array.isArray(patch.members)) allowed.members = patch.members
  if (typeof patch.hoursPerDay === 'number') allowed.hoursPerDay = patch.hoursPerDay
  if (typeof patch.activeSprintId === 'string') allowed.activeSprintId = patch.activeSprintId
  // An empty string clears the pin and puts negotiation back in charge.
  if (typeof patch.apiVersion === 'string') allowed.apiVersion = patch.apiVersion || undefined
  if (typeof patch.businessOrderField === 'string') {
    allowed.businessOrderField = patch.businessOrderField || undefined
  }
  if (patch.childQueryMode === 'auto' || patch.childQueryMode === 'always' || patch.childQueryMode === 'never') {
    allowed.childQueryMode = patch.childQueryMode
  }
  // An empty string clears the owner, so the tasks are created unassigned.
  if (typeof patch.docOwner === 'string') allowed.docOwner = patch.docOwner || undefined
  if (typeof patch.qaOwner === 'string') allowed.qaOwner = patch.qaOwner || undefined
  if (Array.isArray(patch.taskTemplates)) {
    allowed.taskTemplates = patch.taskTemplates
      .filter((template) => template && typeof template.name === 'string')
      .map((template) => ({
        name: String(template.name),
        prefixes: Array.isArray(template.prefixes) ? template.prefixes.map(String) : []
      }))
  }
  return allowed
}

/**
 * Only the fields a draft may carry, in the types the client expects. Nothing is dropped:
 * failures are reported by position, so the list has to keep the renderer's order. A blank
 * title is refused by TFS and comes back as a failure like any other.
 */
function sanitiseDrafts(drafts: TaskDraft[]): TaskDraft[] {
  if (!Array.isArray(drafts)) return []
  return drafts.map((draft) => ({
    title: String(draft?.title ?? '').trim(),
    assignedTo:
      typeof draft?.assignedTo === 'string' && draft.assignedTo.trim()
        ? draft.assignedTo.trim()
        : undefined,
    estimate: Number.isFinite(Number(draft?.estimate)) ? Math.max(0, Number(draft.estimate)) : 0,
    tags: Array.isArray(draft?.tags)
      ? parseTags(draft.tags.map((tag) => String(tag)).join(';'))
      : undefined
  }))
}

async function guard<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await action())
  } catch (error) {
    return fail(messageFor(error))
  }
}

function messageFor(error: unknown): string {
  if (error instanceof TfsError || error instanceof TfsUrlError) return error.message
  return error instanceof Error ? error.message : String(error)
}

/** Builds a client for `url`, applying the credentials and network settings the user chose. */
/**
 * Keeps the Business Order field the client discovered, so later imports ask for it by name
 * instead of hunting for it again.
 */
async function rememberBusinessOrderField(client: TfsClient): Promise<void> {
  const field = client.businessOrderField
  const settings = await getSettings()
  if (field && field !== settings.businessOrderField) await updateSettings({ businessOrderField: field })
}

async function clientFor(url: string): Promise<{ client: TfsClient; target: ParsedTfsUrl }> {
  const target = parseTfsUrl(url)
  const settings = await getSettings()
  const credentials: TfsCredentials = { mode: settings.authMode }

  if (settings.authMode === 'pat') credentials.pat = await readPat()
  else session.defaultSession.allowNTLMCredentialsForDomains(target.host)

  return {
    client: new TfsClient(target, credentials, settings.apiVersion, settings.businessOrderField),
    target
  }
}

async function testConnection(url: string): Promise<ConnectionResult> {
  try {
    const { client } = await clientFor(url)
    const { user, apiVersion } = await client.connect()
    await updateSettings({ apiVersion })
    return {
      ok: true,
      message: `Connected as ${user}, using REST API version ${apiVersion}.`,
      user,
      apiVersion
    }
  } catch (error) {
    return { ok: false, message: messageFor(error) }
  }
}

async function startSprint(request: StartSprintRequest): Promise<Sprint> {
  const settings = await getSettings()
  if (settings.members.length === 0) {
    throw new Error('Add the team members in Settings first — they are the rows of the calendar.')
  }

  const { client } = await clientFor(request.queryUrl)
  const items = await client.fetchSprintItems(settings.childQueryMode ?? 'auto')
  await rememberBusinessOrderField(client)

  const workItems: Record<number, WorkItem> = {}
  for (const item of items) workItems[item.id] = item

  // A story or bug is a heading in the panel, not something you can drag onto a calendar, so
  // only the leaves become blocks — sized by the estimate until somebody reports against it.
  const backlog: Block[] = schedulableItems(items).map((item) => ({
    id: `${item.id}-1`,
    workItemId: item.id,
    hours: plannedHours(item)
  }))

  const sprint: Sprint = {
    id: newSprintId(),
    name: request.name.trim() || 'Sprint',
    days: buildSprintDays(
      request.startDate,
      request.weeks,
      settings.hoursPerDay,
      request.includeWeekends
    ),
    hoursPerDay: settings.hoursPerDay,
    members: settings.members,
    capacityOverrides: {},
    queues: Object.fromEntries(settings.members.map((member) => [member.id, []])),
    backlog,
    workItems,
    notes: [],
    queryUrl: request.queryUrl,
    lastRefreshedAt: new Date().toISOString(),
    history: {}
  }

  await saveSprint(sprint)
  await updateSettings({ activeSprintId: sprint.id, lastQueryUrl: request.queryUrl })
  return sprint
}

function buildNotesMarkdown(sprint: Sprint): string {
  const lines: string[] = [`# ${sprint.name} — Notes\n`]
  for (const member of sprint.members) {
    const memberNotes = sprint.notes.filter((note: Note) => note.memberId === member.id)
    if (memberNotes.length === 0) continue
    lines.push(`## ${member.name}\n`)
    for (const note of memberNotes) {
      const taskRefs = note.taskIds.map((id) => {
        const item = sprint.workItems[id]
        return item ? `[#${id} ${item.title}](${item.url})` : `#${id}`
      })
      if (note.category) lines.push(`**Category:** ${note.category}  `)
      if (taskRefs.length > 0) lines.push(`**Tasks:** ${taskRefs.join(', ')}  `)
      lines.push(note.text)
      lines.push('')
    }
  }
  return lines.join('\n')
}

export type { AppSettings }
