import { expect, test } from './app'
import { settingsFor, sprintFor } from './data'

/** The windows themselves: what opens, what the page can reach, and what it cannot. */

test('opens on the empty screen when there is no sprint yet', async ({ launch }) => {
  const { page } = await launch()
  await expect(page).toHaveTitle('Sprint Viewer')
  await expect(page.getByRole('heading', { name: 'No sprint yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start sprint…' })).toBeVisible()
})

test('the page gets window.api and nothing else from Node or Electron', async ({ launch }) => {
  const { page } = await launch()
  const reach = await page.evaluate(() => ({
    api: Object.keys(window.api).sort(),
    allFunctions: Object.values(window.api).every((value) => typeof value === 'function'),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    ipcRenderer: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    electron: typeof (window as unknown as { electron?: unknown }).electron
  }))

  expect(reach).toEqual({
    api: [
      'clearPat',
      'createTasks',
      'deleteSnapshot',
      'ensureBaseline',
      'exportNotes',
      'exportSnapshot',
      'getAppVersion',
      'getSettings',
      'getStoragePath',
      'listSnapshots',
      'listSprints',
      'listTeams',
      'loadSnapshot',
      'loadSprint',
      'openExternal',
      'openSnapshot',
      'refreshSprint',
      'saveSprint',
      'saveSummary',
      'setPat',
      'startSprint',
      'switchSprint',
      'takeSnapshot',
      'teamMembers',
      'testConnection',
      'updateSettings'
    ].sort(),
    allFunctions: true,
    require: 'undefined',
    process: 'undefined',
    ipcRenderer: 'undefined',
    electron: 'undefined'
  })
})

test('a link that asks for a new window opens in the browser, never in the app', async ({
  launch
}) => {
  const { app, page } = await launch()
  // Stand in for the real browser, so the test does not open one.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })

  await page.evaluate(() => window.open('https://tfs.example/tfs/Coll/Proj/_workitems/edit/7'))

  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['https://tfs.example/tfs/Coll/Proj/_workitems/edit/7'])
  expect(app.windows()).toHaveLength(1)
  await expect(page).toHaveURL(/index\.html$/)
})

test('a snapshot opens in its own read-only window, beside the board', async ({
  launch,
  seed,
  tfs
}) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')

  await page.getByRole('button', { name: 'Snapshot' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Snapshot name').fill('Planning done')
  await dialog.getByRole('button', { name: 'Take snapshot' }).click()
  await expect(dialog.locator('.snapshot-name', { hasText: 'Planning done' })).toBeVisible()

  const opening = app.waitForEvent('window')
  await dialog
    .locator('.snapshot', { hasText: 'Planning done' })
    .getByRole('button', { name: 'Open' })
    .click()
  const snapshot = await opening
  await snapshot.waitForLoadState('domcontentloaded')

  await expect(snapshot.locator('.toolbar .title')).toHaveText('Planning done')
  await expect(snapshot.locator('.sample-banner')).toHaveText('Read-only')
  // The board is there, and none of it can be dragged.
  await expect(snapshot.locator('.seg').first()).toBeVisible()
  await expect(snapshot.locator('.seg.is-draggable')).toHaveCount(0)
  await expect(page.locator('.seg.is-draggable').first()).toBeVisible()

  await snapshot.close()
  expect(app.windows()).toHaveLength(1)
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')
})
