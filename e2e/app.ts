import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { AppSettings } from '../src/shared/settings'
import type { Sprint } from '../src/shared/types'
import { startFakeTfs, type FakeTfs } from './fakeTfs'

/**
 * The fixtures every end-to-end test gets:
 *
 * - `dataDir`: a fresh, empty folder the app uses instead of `%APPDATA%\SprintViewer`, so a test
 *   never sees — or touches — anyone's real sprints. Removed afterwards.
 * - `tfs`: a fake TFS server on localhost (`fakeTfs.ts`).
 * - `seed`: writes settings and sprint files into `dataDir` before the app starts.
 * - `launch`: starts the built app (`out/`) on `dataDir`. It can be called again after
 *   `close()` to test what survives a restart. Every window's console errors and uncaught
 *   exceptions are collected, and any of them fails the test.
 */

export interface Launched {
  app: ElectronApplication
  /** The main window, loaded. Named `page` so it does not shadow `window` in `evaluate`. */
  page: Page
  close(): Promise<void>
}

/** Stored settings: the public ones, minus what is derived from the token. */
export type SeedSettings = Partial<Omit<AppSettings, 'hasPat' | 'patHint'>>

interface Fixtures {
  dataDir: string
  tfs: FakeTfs
  seed(data: { settings?: SeedSettings; sprints?: Sprint[] }): Promise<void>
  launch(): Promise<Launched>
  /** Console errors and page errors from every window so far. */
  errors: string[]
}

const MAIN = resolve(__dirname, '../out/main/index.js')

export const test = base.extend<Fixtures>({
  // Playwright requires the first argument to be destructured, even when it is empty.
  // eslint-disable-next-line no-empty-pattern
  dataDir: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'sprint-viewer-e2e-'))
    await use(dir)
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  },

  // eslint-disable-next-line no-empty-pattern
  tfs: async ({}, use) => {
    const tfs = await startFakeTfs()
    await use(tfs)
    await tfs.close()
  },

  // eslint-disable-next-line no-empty-pattern
  errors: async ({}, use) => {
    await use([])
  },

  seed: async ({ dataDir }, use) => {
    await use(async ({ settings, sprints = [] }) => {
      if (settings) {
        const stored = {
          authMode: 'pat',
          trustedHosts: [],
          members: [],
          hoursPerDay: 8,
          ...settings
        }
        await writeFile(join(dataDir, 'settings.json'), JSON.stringify(stored, null, 2))
      }
      if (sprints.length > 0) await mkdir(join(dataDir, 'sprints'), { recursive: true })
      for (const sprint of sprints) {
        await writeFile(join(dataDir, 'sprints', `${sprint.id}.json`), JSON.stringify(sprint))
      }
    })
  },

  launch: async ({ dataDir, errors }, use) => {
    const running: ElectronApplication[] = []

    await use(async () => {
      const app = await electron.launch({
        args: [MAIN, `--user-data-dir=${dataDir}`],
        // A packaged-like run: no dev server URL, so the built renderer in out/ is loaded.
        env: { ...process.env, ELECTRON_RENDERER_URL: '', NODE_ENV: 'production' }
      })
      running.push(app)

      // The first window can arrive both from `firstWindow()` and as a `window` event.
      const watched = new WeakSet<Page>()
      const watch = (page: Page): void => {
        if (watched.has(page)) return
        watched.add(page)
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`)
        })
        page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`))
      }
      app.on('window', watch)
      const page = await app.firstWindow()
      watch(page)
      await page.waitForLoadState('domcontentloaded')

      return {
        app,
        page,
        close: async () => {
          await app.close()
          running.splice(running.indexOf(app), 1)
        }
      }
    })

    for (const app of running) await app.close()
    expect(errors, 'console errors in the app').toEqual([])
  }
})

export { expect }
