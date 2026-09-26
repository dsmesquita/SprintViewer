import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { buildSprintDays } from '../src/shared/dates'
import type { Sprint } from '../src/shared/types'
import { expect, test } from './app'
import { DEV, settingsFor, sprintFor, VAL } from './data'
import type { FakeTfs } from './fakeTfs'

/**
 * Real drags: the mouse pressed on a block, moved across the calendar, and released — through
 * dnd-kit's real pointer sensor and real layout, which jsdom cannot give the unit tests.
 *
 * The clock is fixed on Wednesday 16 Sep 2026, in a two-week sprint from Monday 14 Sep:
 *
 *   Diogo  DEV #101: 12h left from today (all of Wednesday, Thursday 0–4), 2h reported done
 *   Sofia  VAL #102: 3h from today (Wednesday 0–3)
 *   Backlog DOC #103: 2h, unassigned
 */

const MON = '2026-09-14'
const TUE = '2026-09-15'
const WED = '2026-09-16'
const THU = '2026-09-17'
const FRI = '2026-09-18'
const DAYS = [MON, TUE, WED, THU, FRI]
const DOC = 103

function dragSprint(tfs: FakeTfs): Sprint {
  const base = sprintFor(tfs)
  return {
    ...base,
    days: buildSprintDays(MON, 2, 8),
    workItems: {
      ...base.workItems,
      [DEV]: { ...base.workItems[DEV], remainingWork: 12, completedWork: 2 },
      [DOC]: { ...base.workItems[VAL], id: DOC, title: 'DOC:: Export service', remainingWork: 2 }
    },
    queues: {
      diogo: [{ id: 'dev', workItemId: DEV, hours: 12 }],
      sofia: [{ id: 'val', workItemId: VAL, hours: 3 }]
    },
    backlog: [{ id: 'doc', workItemId: DOC, hours: 2 }]
  }
}

test.beforeEach(async ({ seed, tfs }) => {
  // No activeSprintId: the sprint is opened by `launch` once the clock is fixed.
  await seed({ settings: settingsFor(tfs), sprints: [dragSprint(tfs)] })
})

async function openBoard(launch: (o: object) => Promise<{ page: Page }>, hourWidth = 20) {
  const { page } = await launch({ today: WED, open: 'e2e-sprint', hourWidth })
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')
  return page
}

const saved = async (dataDir: string): Promise<Sprint> =>
  JSON.parse(await readFile(join(dataDir, 'sprints', 'e2e-sprint.json'), 'utf8'))

const row = (page: Page, name: string) =>
  page.locator('.cal-row', { has: page.locator('.row-name .who', { hasText: name }) })

/** The middle of one hour on someone's row. */
async function slot(page: Page, name: string, date: string, hour: number) {
  const cell = row(page, name)
    .locator('.day-block')
    .nth(DAYS.indexOf(date))
    .locator('.hour-slot')
    .nth(hour)
  const box = (await cell.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A task's block on the calendar (its first piece that is still to do). */
const block = (page: Page, id: number) =>
  page
    .locator('.row-track .seg:not(.is-done)', {
      has: page.locator('.seg-id', { hasText: `#${id}` })
    })
    .first()
/** The hours TFS reports done on a task, drawn behind today. */
const reported = (page: Page, id: number) =>
  page
    .locator('.row-track .seg.is-done', { has: page.locator('.seg-id', { hasText: `#${id}` }) })
    .first()
/** A task's card in the backlog. */
const card = (page: Page, title: string) =>
  page.locator('.task-card', { has: page.locator('.task-title', { hasText: title }) })

/** Presses on `from` near its left edge and moves, in steps, to `to` — without releasing. */
async function pickUp(page: Page, from: Locator) {
  const box = (await from.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  // Past the 4px activation distance, so the drag starts.
  await page.mouse.move(box.x + 14, box.y + box.height / 2, { steps: 3 })
}
async function moveTo(page: Page, to: { x: number; y: number }) {
  await page.mouse.move(to.x, to.y, { steps: 8 })
}
/**
 * Releases the mouse. dnd-kit swallows every click for 50ms after a drop, so a drop is never
 * also a click on what is under it; a person cannot click again that fast, but a test can, and
 * its next click (on a dialog the drop opened, say) would silently do nothing.
 */
async function release(page: Page) {
  await page.mouse.up()
  await page.waitForTimeout(100)
}
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  await pickUp(page, from)
  await moveTo(page, to)
  await release(page)
}

/** Where every block on the calendar is drawn: row, task, and its box. */
const drawnBoard = (page: Page) =>
  page.locator('.row-track .seg').evaluateAll((segs) =>
    segs
      .map((seg) => {
        const who = seg.closest('.cal-row')?.querySelector('.who')?.textContent
        const id = seg.querySelector('.seg-id')?.textContent
        const el = seg as HTMLElement
        return `${who} ${id} ${el.style.left} ${el.style.width}${seg.classList.contains('is-done') ? ' done' : ''}`
      })
      .sort()
  )

test('what the preview shows while dragging is exactly where the drop lands', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  await pickUp(page, card(page, 'DOC:: Export service'))
  await moveTo(page, await slot(page, 'Diogo', FRI, 2))
  await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(1)
  const preview = await drawnBoard(page)

  await release(page)
  await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(0)
  expect(await drawnBoard(page)).toEqual(preview)
  // After the end of Diogo's queue: it joins the queue rather than pinning to Friday.
  await expect
    .poll(async () => (await saved(dataDir)).queues.diogo.map((b) => b.id))
    .toEqual(['dev', 'doc'])
  expect((await saved(dataDir)).backlog).toEqual([])
})

test('a drop on today pins to that hour; a drop further on joins the queue', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', WED, 5))
  await expect
    .poll(async () => (await saved(dataDir)).queues.sofia.find((b) => b.id === 'doc')?.pin)
    .toEqual({
      date: WED,
      startHour: 5
    })
  await expect(block(page, DOC)).toHaveClass(/is-pinned/)

  // Back to the backlog, then onto Friday: in the queue, after VAL, and not pinned.
  await drag(
    page,
    block(page, DOC),
    await page
      .locator('.backlog-drop')
      .boundingBox()
      .then((b) => ({ x: b!.x + b!.width / 2, y: b!.y + 60 }))
  )
  await expect.poll(async () => (await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])
  await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', FRI, 0))
  await expect
    .poll(async () => (await saved(dataDir)).queues.sofia)
    .toEqual([
      { id: 'val', workItemId: VAL, hours: 3 },
      { id: 'doc', workItemId: DOC, hours: 2 }
    ])
})

test('a block dragged onto the backlog leaves the calendar', async ({ launch, dataDir }) => {
  const page = await openBoard(launch)
  const backlog = (await page.locator('.backlog-drop').boundingBox())!
  await drag(page, block(page, VAL), { x: backlog.x + backlog.width / 2, y: backlog.y + 60 })

  await expect(card(page, 'VAL:: Export service')).toBeVisible()
  await expect(block(page, VAL)).toHaveCount(0)
  await expect.poll(async () => (await saved(dataDir)).queues.sofia).toEqual([])
})

test('the drop follows the row under the cursor, however often it changed during the drag', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  await pickUp(page, card(page, 'DOC:: Export service'))
  await moveTo(page, await slot(page, 'Sofia', THU, 0))
  await expect(row(page, 'Sofia').locator('.seg.is-preview')).toHaveCount(1)
  await moveTo(page, await slot(page, 'Diogo', FRI, 2))
  await expect(row(page, 'Diogo').locator('.seg.is-preview')).toHaveCount(1)
  await moveTo(page, await slot(page, 'Sofia', FRI, 1))
  await expect(row(page, 'Sofia').locator('.seg.is-preview')).toHaveCount(1)
  await release(page)

  await expect
    .poll(async () => (await saved(dataDir)).queues.sofia.map((b) => b.id))
    .toEqual(['val', 'doc'])
  expect((await saved(dataDir)).queues.diogo.map((b) => b.id)).toEqual(['dev'])
})

test('a drop on the row of someone TFS does not assign it to asks first', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  const question = page.getByRole('dialog', { name: 'Assigned to someone else' })

  await drag(page, block(page, DEV), await slot(page, 'Sofia', FRI, 0))
  await expect(question).toContainText('Diogo Mesquita')
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  expect((await saved(dataDir)).queues.diogo.map((b) => b.id)).toEqual(['dev'])

  await drag(page, block(page, DEV), await slot(page, 'Sofia', FRI, 0))
  await question.getByRole('button', { name: 'Put it there anyway' }).click()
  await expect
    .poll(async () => (await saved(dataDir)).queues.sofia.map((b) => b.id))
    .toEqual(['val', 'dev'])
  expect((await saved(dataDir)).queues.diogo).toEqual([])
})

test('a drop inside another task asks how to make room', async ({ launch, dataDir }) => {
  const page = await openBoard(launch)
  const question = page.getByRole('dialog', { name: `#${DEV} is already here` })
  // Thursday hour 1 is 9 hours into DEV.
  const inside = await slot(page, 'Diogo', THU, 1)

  await drag(page, card(page, 'DOC:: Export service'), inside)
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  expect((await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])

  await drag(page, card(page, 'DOC:: Export service'), inside)
  await question.getByRole('button', { name: /Split it here/ }).click()
  await expect
    .poll(async () => (await saved(dataDir)).queues.diogo.map((b) => [b.workItemId, b.hours]))
    .toEqual([
      [DEV, 9],
      [DOC, 2],
      [DEV, 3]
    ])

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])
  await drag(page, card(page, 'DOC:: Export service'), inside)
  await question.getByRole('button', { name: /Keep it before/ }).click()
  await expect
    .poll(async () => (await saved(dataDir)).queues.diogo.map((b) => [b.workItemId, b.hours]))
    .toEqual([
      [DEV, 12],
      [DOC, 2]
    ])
})

test('reported hours are dragged to when they were really worked, and handed back', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  await expect(reported(page, DEV)).toBeVisible()

  await drag(page, reported(page, DEV), await slot(page, 'Diogo', TUE, 4))
  await expect
    .poll(async () => (await saved(dataDir)).reportedPins?.[DEV])
    .toEqual({ memberId: 'diogo', date: TUE, startHour: 4 })
  await expect(reported(page, DEV)).toHaveClass(/is-pinned/)

  const backlog = (await page.locator('.backlog-drop').boundingBox())!
  await drag(page, reported(page, DEV), { x: backlog.x + backlog.width / 2, y: backlog.y + 60 })
  await expect.poll(async () => (await saved(dataDir)).reportedPins?.[DEV]).toBeUndefined()
})

test('locking a day leaves the board alone, and the day refuses drops', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  const before = await saved(dataDir)
  // Nothing runs into Friday: DEV ends on Thursday, so locking it cuts nothing.
  await page.locator('.cal-head .day-lock').nth(DAYS.indexOf(FRI)).click({ force: true })
  await expect.poll(async () => (await saved(dataDir)).lockedDays).toEqual([FRI])
  expect(await saved(dataDir)).toEqual({ ...before, lockedDays: [FRI] })

  await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', FRI, 3))
  await expect(card(page, 'DOC:: Export service')).toBeVisible()
  expect(await saved(dataDir)).toEqual({ ...before, lockedDays: [FRI] })
})

test('clicking and right-clicking a block still work: dragging does not swallow them', async ({
  launch
}) => {
  const page = await openBoard(launch)
  await block(page, DEV).click()
  await expect(block(page, DEV)).toHaveClass(/is-selected/)
  await expect(page.locator('.panel')).toContainText('DEV:: Export service')

  await block(page, VAL).click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('after zooming, a drop still lands on the hour under the cursor', async ({
  launch,
  dataDir
}) => {
  const page = await openBoard(launch)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', TUE, 6))
  await expect
    .poll(async () => (await saved(dataDir)).queues.sofia.find((b) => b.id === 'doc')?.pin)
    .toEqual({ date: TUE, startHour: 6 })
})

test('Escape cancels a drag, and Ctrl+Z undoes a drop', async ({ launch, dataDir }) => {
  const page = await openBoard(launch)
  await pickUp(page, card(page, 'DOC:: Export service'))
  await moveTo(page, await slot(page, 'Diogo', FRI, 2))
  await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await release(page)
  await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(0)
  await expect(card(page, 'DOC:: Export service')).toBeVisible()
  expect((await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])

  await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Diogo', FRI, 2))
  await expect.poll(async () => (await saved(dataDir)).backlog).toEqual([])
  await page.keyboard.press('Control+z')
  await expect(card(page, 'DOC:: Export service')).toBeVisible()
  await expect.poll(async () => (await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])
})
