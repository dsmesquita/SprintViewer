import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { baselineAction, baselineName } from '@shared/baseline'
import { DEFAULT_SETTINGS, type AppSettings, type SprintSummary } from '@shared/settings'
import type { Snapshot, SnapshotMeta } from '@shared/snapshots'
import type { Sprint } from '@shared/types'

/**
 * On-disk state. Everything lives in `%APPDATA%\SprintViewer` as plain JSON — no database
 * engine, nothing to install alongside the app, and a backup is a folder copy.
 *
 * The one thing that is not plain text is the PAT: it is sealed with `safeStorage`, which on
 * Windows is DPAPI scoped to the logged-in user, so the ciphertext is useless elsewhere.
 */

interface StoredSettings {
  authMode: AppSettings['authMode']
  /** Base64 DPAPI blob. Never leaves the main process. */
  patCipher?: string
  /** Last four characters of the token, kept in the clear so the UI can show a hint. */
  patTail?: string
  lastQueryUrl?: string
  apiVersion?: string
  trustedHosts: string[]
  members: AppSettings['members']
  hoursPerDay: number
  activeSprintId?: string
  businessOrderField?: string
  docOwner?: string
  qaOwner?: string
  taskTemplates?: AppSettings['taskTemplates']
  childQueryMode?: AppSettings['childQueryMode']
}

const DEFAULT_STORED: StoredSettings = {
  authMode: 'pat',
  trustedHosts: [],
  members: [],
  hoursPerDay: 8
}

function root(): string {
  return app.getPath('userData')
}

function settingsPath(): string {
  return join(root(), 'settings.json')
}

function sprintsDir(): string {
  return join(root(), 'sprints')
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`${path} could not be read: ${(error as Error).message}`)
  }
}

/** Write to a sibling temp file first, so a crash mid-write cannot truncate the real one. */
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, path)
}

let cache: StoredSettings | null = null

async function stored(): Promise<StoredSettings> {
  if (!cache) cache = { ...DEFAULT_STORED, ...((await readJson<StoredSettings>(settingsPath())) ?? {}) }
  return cache
}

async function persist(next: StoredSettings): Promise<void> {
  cache = next
  await writeJson(settingsPath(), next)
}

function toPublic(settings: StoredSettings): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    authMode: settings.authMode,
    hasPat: Boolean(settings.patCipher),
    patHint: settings.patTail ? `${'•'.repeat(8)}${settings.patTail}` : undefined,
    lastQueryUrl: settings.lastQueryUrl,
    apiVersion: settings.apiVersion,
    trustedHosts: settings.trustedHosts,
    members: settings.members,
    hoursPerDay: settings.hoursPerDay,
    activeSprintId: settings.activeSprintId,
    businessOrderField: settings.businessOrderField,
    docOwner: settings.docOwner,
    qaOwner: settings.qaOwner,
    taskTemplates: settings.taskTemplates,
    childQueryMode: settings.childQueryMode
  }
}

export async function getSettings(): Promise<AppSettings> {
  return toPublic(await stored())
}

/** Loads settings into memory at startup so the synchronous accessors below have data. */
export async function primeSettings(): Promise<void> {
  await stored()
}

/**
 * Certificate verification runs on a synchronous callback, so it cannot await the settings
 * file. This reads the already-loaded cache instead, and returns nothing until primed —
 * failing closed, which is the right way round for a trust decision.
 */
export function trustedHostsSync(): string[] {
  return cache?.trustedHosts ?? []
}

/** Applies the subset of settings the renderer may change. */
export async function updateSettings(patch: Partial<StoredSettings>): Promise<AppSettings> {
  const next = { ...(await stored()), ...patch }
  await persist(next)
  return toPublic(next)
}

export async function setPat(token: string): Promise<AppSettings> {
  const trimmed = token.trim()
  if (!trimmed) return clearPat()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Windows did not make its encryption service available, so the token cannot be stored ' +
        'safely. The app will not save it in plain text.'
    )
  }
  return updateSettings({
    patCipher: safeStorage.encryptString(trimmed).toString('base64'),
    patTail: trimmed.slice(-4)
  })
}

export async function clearPat(): Promise<AppSettings> {
  return updateSettings({ patCipher: undefined, patTail: undefined })
}

/**
 * Decrypts the stored token. Main process only — the renderer has no IPC route to this, by
 * design, so a compromised renderer cannot read the secret out of the app.
 */
export async function readPat(): Promise<string | undefined> {
  const settings = await stored()
  if (!settings.patCipher) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(settings.patCipher, 'base64'))
  } catch {
    throw new Error(
      'The stored token could not be decrypted. It was encrypted for a different Windows ' +
        'user or machine — open Settings and enter it again.'
    )
  }
}

export function newSprintId(): string {
  return randomUUID()
}

export async function saveSprint(sprint: Sprint): Promise<void> {
  await mkdir(sprintsDir(), { recursive: true })
  await writeJson(join(sprintsDir(), `${sprint.id}.json`), sprint)
}

/**
 * Snapshots live beside the sprints, one folder per sprint, so deleting a sprint's folder
 * takes its history with it and nothing is orphaned.
 */
function snapshotsDir(sprintId: string): string {
  return join(root(), 'snapshots', sprintId)
}

export async function takeSnapshot(sprint: Sprint, name: string): Promise<SnapshotMeta> {
  const snapshot: Snapshot = {
    id: randomUUID(),
    sprintId: sprint.id,
    name: name.trim() || new Date().toLocaleString(),
    takenAt: new Date().toISOString(),
    sprint
  }
  await mkdir(snapshotsDir(sprint.id), { recursive: true })
  await writeJson(join(snapshotsDir(sprint.id), `${snapshot.id}.json`), snapshot)
  const { sprint: _sprint, ...meta } = snapshot
  return meta
}

/**
 * Takes or refreshes the sprint's automatic "Sprint start" snapshot, when `baseline.ts` says it
 * is time to. A refresh overwrites the same file, so there is only ever one, and it keeps its id.
 * Returns what it did, and the snapshot when it did anything.
 */
export async function ensureBaseline(
  sprint: Sprint,
  today: string
): Promise<{ action: 'none' | 'take' | 'replace'; meta?: SnapshotMeta }> {
  const existing = (await listSnapshots(sprint.id)).find((meta) => meta.kind === 'baseline')
  const action = baselineAction(sprint, today, existing)
  if (action === 'none') return { action }

  const snapshot: Snapshot = {
    id: existing?.id ?? randomUUID(),
    sprintId: sprint.id,
    name: existing?.name ?? baselineName(sprint, today),
    takenAt: new Date().toISOString(),
    kind: 'baseline',
    sprint
  }
  await mkdir(snapshotsDir(sprint.id), { recursive: true })
  await writeJson(join(snapshotsDir(sprint.id), `${snapshot.id}.json`), snapshot)
  const { sprint: _sprint, ...meta } = snapshot
  return { action, meta }
}

/** Newest first, which is the order anybody reads a list of these in. */
export async function listSnapshots(sprintId: string): Promise<SnapshotMeta[]> {
  let files: string[]
  try {
    files = await readdir(snapshotsDir(sprintId))
  } catch {
    return []
  }
  const metas: SnapshotMeta[] = []
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const snapshot = await readJson<Snapshot>(join(snapshotsDir(sprintId), file))
    if (snapshot) {
      const { sprint: _sprint, ...meta } = snapshot
      metas.push(meta)
    }
  }
  return metas.sort((a, b) => b.takenAt.localeCompare(a.takenAt))
}

export async function loadSnapshot(sprintId: string, id: string): Promise<Snapshot | null> {
  return readJson<Snapshot>(join(snapshotsDir(sprintId), `${id}.json`))
}

export async function deleteSnapshot(sprintId: string, id: string): Promise<void> {
  await rm(join(snapshotsDir(sprintId), `${id}.json`), { force: true })
}

export async function loadSprint(id: string): Promise<Sprint | null> {
  return readJson<Sprint>(join(sprintsDir(), `${id}.json`))
}

export async function listSprints(): Promise<SprintSummary[]> {
  let files: string[]
  try {
    files = await readdir(sprintsDir())
  } catch {
    return []
  }

  const summaries: SprintSummary[] = []
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const sprint = await readJson<Sprint>(join(sprintsDir(), file))
    if (!sprint) continue
    summaries.push({
      id: sprint.id,
      name: sprint.name,
      startDate: sprint.days[0]?.date ?? '',
      endDate: sprint.days[sprint.days.length - 1]?.date ?? ''
    })
  }
  return summaries.sort((a, b) => b.startDate.localeCompare(a.startDate))
}

export function storageRoot(): string {
  return root()
}
