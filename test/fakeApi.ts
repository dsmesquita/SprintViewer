import { vi } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings'
import type { Sprint } from '../src/shared/types'

type Api = Window['api']

/**
 * A stand-in for `window.api` (the preload bridge) in renderer tests. Every method is a `vi.fn`
 * with a sensible default, so a test only overrides what it cares about and can assert on the
 * calls. Sprints "saved" through it are kept in `saved`.
 */
export function fakeApi(overrides: Record<string, unknown> = {}) {
  const saved = new Map<string, Sprint>()
  let settings: AppSettings = { ...DEFAULT_SETTINGS }
  const ok = <T>(value: T) => ({ ok: true as const, value })
  // The window's full screen: setFullScreen changes it and tells every listener, as main does.
  const fullScreenListeners = new Set<(on: boolean) => void>()
  const tellFullScreen = (on: boolean): void => fullScreenListeners.forEach((listen) => listen(on))

  const defaults = {
    openExternal: vi.fn<Api['openExternal']>(async () => {}),
    setFullScreen: vi.fn<Api['setFullScreen']>(async (on: boolean) => tellFullScreen(on)),
    onFullScreen: vi.fn<Api['onFullScreen']>((listener: (on: boolean) => void) => {
      fullScreenListeners.add(listener)
      return () => fullScreenListeners.delete(listener)
    }),
    getAppVersion: vi.fn<Api['getAppVersion']>(async () => 'test'),
    getStoragePath: vi.fn<Api['getStoragePath']>(async () => 'C:\\test'),
    getSettings: vi.fn<Api['getSettings']>(async () => settings),
    updateSettings: vi.fn<Api['updateSettings']>(async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    }),
    setPat: vi.fn<Api['setPat']>(async () => ok(settings)),
    clearPat: vi.fn<Api['clearPat']>(async () => settings),
    testConnection: vi.fn<Api['testConnection']>(async () => ({ ok: true, message: 'Connected' })),
    createTasks: vi.fn<Api['createTasks']>(async () => ok({ created: [], failures: [] })),
    listTeams: vi.fn<Api['listTeams']>(async () => ok({ teams: [] })),
    teamMembers: vi.fn<Api['teamMembers']>(async () => ok([])),
    startSprint: vi.fn<Api['startSprint']>(async () => ({
      ok: false,
      message: 'not set up in this test'
    })),
    refreshSprint: vi.fn<Api['refreshSprint']>(async () => ok([])),
    saveSprint: vi.fn<Api['saveSprint']>(async (sprint: Sprint) => {
      saved.set(sprint.id, sprint)
      return ok(undefined)
    }),
    loadSprint: vi.fn<Api['loadSprint']>(async (id: string) => saved.get(id) ?? null),
    listSprints: vi.fn<Api['listSprints']>(async () => []),
    switchSprint: vi.fn<Api['switchSprint']>(async (id: string) =>
      saved.has(id) ? ok(saved.get(id)!) : { ok: false as const, message: 'Sprint not found.' }
    ),
    saveSummary: vi.fn<Api['saveSummary']>(async () => ok(null)),
    exportNotes: vi.fn<Api['exportNotes']>(async () => ok(null)),
    exportCalendar: vi.fn<Api['exportCalendar']>(async () => ok(null)),
    takeSnapshot: vi.fn<Api['takeSnapshot']>(async () =>
      ok({ id: 's', sprintId: '', name: '', takenAt: '' })
    ),
    ensureBaseline: vi.fn<Api['ensureBaseline']>(async () => ok({ action: 'none' })),
    listSnapshots: vi.fn<Api['listSnapshots']>(async () => []),
    loadSnapshot: vi.fn<Api['loadSnapshot']>(async () => null),
    deleteSnapshot: vi.fn<Api['deleteSnapshot']>(async () => ok(undefined)),
    openSnapshot: vi.fn<Api['openSnapshot']>(async () => {}),
    exportSnapshot: vi.fn<Api['exportSnapshot']>(async () => ok(null))
  }
  const api = { ...defaults, ...overrides } as typeof defaults

  return {
    /** The mocks themselves, so tests can stub answers and inspect calls. */
    api,
    saved,
    /** The window entering or leaving full screen by itself — F11, or Windows. */
    tellFullScreen,
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
