import { vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings'
import type { Sprint } from '../src/shared/types'

/**
 * A stand-in for `window.api` (the preload bridge) in renderer tests. Every method is a `vi.fn`
 * with a sensible default, so a test only overrides what it cares about and can assert on the
 * calls. Sprints "saved" through it are kept in `saved`.
 */
export function fakeApi(overrides: Record<string, unknown> = {}) {
  const saved = new Map<string, Sprint>()
  let settings: AppSettings = { ...DEFAULT_SETTINGS }
  const ok = <T>(value: T) => ({ ok: true as const, value })

  const defaults = {
    openExternal: vi.fn(async () => {}),
    getAppVersion: vi.fn(async () => 'test'),
    getStoragePath: vi.fn(async () => 'C:\\test'),
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    }),
    setPat: vi.fn(async () => ok(settings)),
    clearPat: vi.fn(async () => settings),
    testConnection: vi.fn(async () => ({ ok: true, message: 'Connected' })),
    createTasks: vi.fn(async () => ok({ created: [], failures: [] })),
    listTeams: vi.fn(async () => ok({ teams: [] })),
    teamMembers: vi.fn(async () => ok([])),
    startSprint: vi.fn(async () => ({ ok: false, message: 'not set up in this test' })),
    refreshSprint: vi.fn(async () => ok([])),
    saveSprint: vi.fn(async (sprint: Sprint) => {
      saved.set(sprint.id, sprint)
      return ok(undefined)
    }),
    loadSprint: vi.fn(async (id: string) => saved.get(id) ?? null),
    listSprints: vi.fn(async () => []),
    switchSprint: vi.fn(async (id: string) =>
      saved.has(id) ? ok(saved.get(id)!) : { ok: false as const, message: 'Sprint not found.' }
    ),
    saveSummary: vi.fn(async () => ok(null)),
    exportNotes: vi.fn(async () => ok(null)),
    takeSnapshot: vi.fn(async () => ok({ id: 's', sprintId: '', name: '', takenAt: '' })),
    ensureBaseline: vi.fn(async () => ok({ action: 'none' })),
    listSnapshots: vi.fn(async () => []),
    loadSnapshot: vi.fn(async () => null),
    deleteSnapshot: vi.fn(async () => ok(undefined)),
    openSnapshot: vi.fn(async () => {}),
    exportSnapshot: vi.fn(async () => ok(null))
  }
  const api = { ...defaults, ...overrides } as typeof defaults

  return {
    /** The mocks themselves, so tests can stub answers and inspect calls. */
    api,
    saved,
    setSettings: (next: Partial<AppSettings>) => {
      settings = { ...settings, ...next }
    }
  }
}

/** Installs a fake bridge on `window` and returns it. */
export function installFakeApi(overrides?: Parameters<typeof fakeApi>[0]) {
  const fake = fakeApi(overrides)
  ;(window as unknown as { api: unknown }).api = fake.api
  return fake
}
