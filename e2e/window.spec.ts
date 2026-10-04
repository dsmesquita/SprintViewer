import type { ElectronApplication, Page } from '@playwright/test'
import { buildSprintDays } from '../src/shared/dates'
import { expect, test } from './app'
import { DEV, settingsFor, sprintFor, VAL } from './data'

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
      'exportCalendar',
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
      'onFullScreen',
      'openExternal',
      'openSnapshot',
      'refreshSprint',
      'saveSprint',
      'saveSummary',
      'setFullScreen',
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

/**
 * Stands in for the real browser inside the main process, so a test can open links without
 * opening one. Returns a reader for what was "opened".
 */
async function stubBrowser(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  return () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])
}

test('a work item link opens in the browser', async ({ launch, seed, tfs }) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  const opened = await stubBrowser(app)

  await page
    .locator('.task-card', { hasText: 'VAL:: Export service' })
    .locator('.task-link')
    .click()
  await expect.poll(opened).toEqual([sprint.workItems[VAL].url])
  expect(app.windows()).toHaveLength(1)
})

test('a link that asks for a new window opens in the browser, never in the app', async ({
  launch
}) => {
  const { app, page } = await launch()
  const opened = await stubBrowser(app)

  await page.evaluate(() => window.open('https://tfs.example/tfs/Coll/Proj/_workitems/edit/7'))

  await expect.poll(opened).toEqual(['https://tfs.example/tfs/Coll/Proj/_workitems/edit/7'])
  expect(app.windows()).toHaveLength(1)
  await expect(page).toHaveURL(/index\.html$/)
})

test('only web addresses are opened: files and other schemes are refused', async ({ launch }) => {
  const { app, page } = await launch()
  const opened = await stubBrowser(app)

  await page.evaluate(async () => {
    await window.api.openExternal('file:///C:/Windows/System32/calc.exe')
    await window.api.openExternal('ms-settings:privacy')
    window.open('file:///C:/Windows/System32/calc.exe')
    // A web link last: once it is through, anything refused before it has been handled too.
    await window.api.openExternal('https://tfs.example/ok')
  })

  await expect.poll(opened).toEqual(['https://tfs.example/ok'])
  expect(app.windows()).toHaveLength(1)
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

test('a snapshot opened later shows exactly what was on screen when it was taken', async ({
  launch,
  seed,
  tfs
}) => {
  // Taken on Wednesday 16 Sep, mid-sprint; opened a week later. Laid out again from that day,
  // the plan would move: the days in between would become the past.
  const base = sprintFor(tfs)
  const sprint = {
    ...base,
    days: buildSprintDays('2026-09-14', 2, 8),
    workItems: {
      ...base.workItems,
      [DEV]: { ...base.workItems[DEV], remainingWork: 12, completedWork: 2 }
    },
    queues: {
      diogo: [{ id: 'dev', workItemId: DEV, hours: 12 }],
      sofia: [{ id: 'val', workItemId: VAL, hours: 3 }]
    },
    backlog: []
  }
  await seed({ settings: settingsFor(tfs), sprints: [sprint] })
  const { app, page } = await launch({ today: '2026-09-16', open: sprint.id, hourWidth: 20 })
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')

  // Every block as drawn — whose row, where, how wide — and where the Today line is.
  const picture = (window: Page) =>
    window.evaluate(() => ({
      blocks: [...document.querySelectorAll<HTMLElement>('.row-track[data-member] .seg')].map(
        (seg) =>
          `${seg.closest<HTMLElement>('.row-track')!.dataset.member} ${seg.style.left} ${seg.style.width} ${seg.textContent}`
      ),
      today: document.querySelector<HTMLElement>('.today-marker')?.style.left
    }))
  const seen = await picture(page)
  expect(seen.blocks.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Snapshot' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Snapshot name').fill('Wednesday')
  await dialog.getByRole('button', { name: 'Take snapshot' }).click()
  // A week passes. The clock is the whole app's, so the snapshot window lives in it too.
  await page.clock.setSystemTime(new Date('2026-09-23T09:00:00'))
  const opening = app.waitForEvent('window')
  await dialog
    .locator('.snapshot', { hasText: 'Wednesday' })
    .getByRole('button', { name: 'Open' })
    .click()
  const snapshot = await opening
  await expect(snapshot.locator('.seg').first()).toBeVisible()

  expect(await picture(snapshot)).toEqual(seen)
  await snapshot.close()
})

test('full screen: the window fills the screen and only the calendar shows', async ({
  launch,
  seed,
  tfs
}) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')
  const windowFull = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
  const onlyTheCalendar = async (on: boolean) => {
    await expect.poll(windowFull).toBe(on)
    await expect(page.locator('.toolbar')).toBeVisible({ visible: !on })
    await expect(page.locator('.body > .panel')).toBeVisible({ visible: !on })
    await expect(page.locator('.row-track').first()).toBeVisible()
  }

  // The corner button, and Esc to leave.
  await page.getByRole('button', { name: 'Full screen' }).click()
  await onlyTheCalendar(true)
  await page.keyboard.press('Escape')
  await onlyTheCalendar(false)

  // F11, which the window itself answers, both ways. Pressed through Electron's own input, as
  // a real key is: Playwright's keyboard goes straight to the page, past the window.
  const pressF11 = () =>
    app.evaluate(({ BrowserWindow }) => {
      const { webContents } = BrowserWindow.getAllWindows()[0]
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' })
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F11' })
    })
  await pressF11()
  await onlyTheCalendar(true)
  await pressF11()
  await onlyTheCalendar(false)
})

test('the ⓘ in the corner explains the keys and marks; Shift+wheel scrolls sideways', async ({
  launch,
  seed,
  tfs
}) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { page } = await launch()

  await page.getByRole('button', { name: 'Keys and marks' }).hover()
  const key = page.getByRole('tooltip')
  await expect(key).toBeVisible()
  await expect(key).toContainText('Scroll the calendar sideways')
  // Above the calendar, not clipped by it.
  const box = (await key.boundingBox())!
  expect(box.height).toBeGreaterThan(150)

  // What the key promises: Shift + mouse wheel scrolls the calendar sideways.
  const calendar = page.locator('.cal-scroll')
  const area = (await calendar.boundingBox())!
  await page.mouse.move(area.x + area.width / 2, area.y + 150)
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, 300)
  await page.keyboard.up('Shift')
  await expect.poll(() => calendar.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
})

test('the Read me keeps one size; long sections and the contents scroll inside it', async ({
  launch
}) => {
  const { app, page } = await launch()
  await page.getByRole('button', { name: 'Read me' }).click()
  const dialog = page.getByRole('dialog', { name: 'Read me — Sprint Viewer' })
  const body = dialog.locator('.help-body')
  const size = async () => {
    const box = (await dialog.boundingBox())!
    return [Math.round(box.width), Math.round(box.height)]
  }

  const first = await size()
  const sections = dialog.locator('.help-toc-item')
  let scrolls = 0
  for (let index = 0; index < (await sections.count()); index++) {
    await sections.nth(index).click()
    expect(await size()).toEqual(first)
    if (await body.evaluate((el) => el.scrollHeight > el.clientHeight)) scrolls++
  }
  // Some sections are longer than the dialog: those scroll inside it.
  expect(scrolls).toBeGreaterThan(0)

  // In a small window the dialog shrinks to fit, and the contents list scrolls on its own.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 640))
  await expect.poll(async () => (await size())[1]).toBeLessThan(first[1])
  const box = (await dialog.boundingBox())!
  const viewport = await page.evaluate(() => window.innerHeight)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport)
  const toc = dialog.locator('.help-toc')
  expect(await toc.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await toc.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect(sections.last()).toBeInViewport()
})
