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
 *
 * The rule under test: a task lands on the hour it is dropped on — from today on — and stays
 * there; reported hours go on the past days or today; nothing goes on a locked day or a day off.
 */

const MON = '2026-09-14'
const TUE = '2026-09-15'
const WED = '2026-09-16'
const THU = '2026-09-17'
const FRI = '2026-09-18'
const MON2 = '2026-09-21'
const TUE2 = '2026-09-22'
const DAYS = buildSprintDays(MON, 2, 8).map((day) => day.date)
const DOC = 103
const MEETING = 104

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

/**
 * Everything in the backlog, ready for auto-assign: Sofia's meetings (6h), Diogo's DEV, and a
 * VAL for Sofia that auto-assign chains after it. Meetings and chained VALs come out pinned.
 */
function unassignedSprint(tfs: FakeTfs): Sprint {
  const base = dragSprint(tfs)
  return {
    ...base,
    workItems: {
      ...base.workItems,
      [DEV]: { ...base.workItems[DEV], completedWork: 0 },
      [VAL]: { ...base.workItems[VAL], assignedTo: 'Sofia Marques' },
      [MEETING]: {
        ...base.workItems[VAL],
        id: MEETING,
        title: 'Meetings:: Tech talk + Others',
        parentId: undefined,
        remainingWork: 6,
        assignedTo: 'Sofia Marques'
      }
    },
    queues: { diogo: [], sofia: [] },
    backlog: [
      { id: 'meet', workItemId: MEETING, hours: 6 },
      { id: 'dev', workItemId: DEV, hours: 12 },
      { id: 'val', workItemId: VAL, hours: 3 }
    ]
  }
}

async function openBoard(
  launch: (o: object) => Promise<{ page: Page }>,
  seed: (data: { settings?: object; sprints?: Sprint[] }) => Promise<void>,
  tfs: FakeTfs,
  { sprint = dragSprint(tfs), hourWidth = 20 }: { sprint?: Sprint; hourWidth?: number } = {}
) {
  // No activeSprintId: the sprint is opened by `launch` once the clock is fixed.
  await seed({ settings: settingsFor(tfs), sprints: [sprint] })
  const { page } = await launch({ today: WED, open: 'e2e-sprint', hourWidth })
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')
  return page
}

const saved = async (dataDir: string): Promise<Sprint> =>
  JSON.parse(await readFile(join(dataDir, 'sprints', 'e2e-sprint.json'), 'utf8'))
const pinOf = async (dataDir: string, blockId: string) => {
  const sprint = await saved(dataDir)
  return Object.values(sprint.queues)
    .flat()
    .find((b) => b.id === blockId)?.pin
}

const row = (page: Page, name: string) =>
  page.locator('.cal-row', { has: page.locator('.row-name .who', { hasText: name }) })
const cell = (page: Page, name: string, date: string, hour: number) =>
  row(page, name).locator('.day-block').nth(DAYS.indexOf(date)).locator('.hour-slot').nth(hour)

/** The middle of one hour on someone's row. */
async function slot(page: Page, name: string, date: string, hour: number) {
  const box = (await cell(page, name, date, hour).boundingBox())!
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

/** The calendar draws the task starting on exactly this hour of this person's row. */
async function expectDrawnFrom(page: Page, name: string, id: number, date: string, hour: number) {
  const first = row(page, name)
    .locator('.seg:not(.is-done)', { has: page.locator('.seg-id', { hasText: `#${id}` }) })
    .first()
  await expect(first).toBeVisible()
  const [piece, hourCell] = await Promise.all([
    first.boundingBox(),
    cell(page, name, date, hour).boundingBox()
  ])
  expect(Math.abs(piece!.x - hourCell!.x)).toBeLessThanOrEqual(2)
}

/**
 * Presses on `from`, `into` pixels in from its left edge, and moves just far enough to start a
 * drag (dnd-kit waits for 4px) — without releasing. Returns where the pointer went down.
 */
async function pickUp(page: Page, from: Locator, into = 4) {
  const box = (await from.boundingBox())!
  const pressed = { x: box.x + into, y: box.y + box.height / 2 }
  await page.mouse.move(pressed.x, pressed.y)
  await page.mouse.down()
  await page.mouse.move(pressed.x + 6, pressed.y, { steps: 3 })
  await page.mouse.move(pressed.x, pressed.y, { steps: 2 })
  return pressed
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
async function toBacklog(page: Page, from: Locator) {
  const backlog = (await page.locator('.backlog-drop').boundingBox())!
  await drag(page, from, { x: backlog.x + backlog.width / 2, y: backlog.y + 60 })
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

test.describe('a task lands on the hour it is dropped on', () => {
  test('what the preview shows while dragging is exactly where the drop lands', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await pickUp(page, card(page, 'DOC:: Export service'))
    await moveTo(page, await slot(page, 'Diogo', FRI, 2))
    await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(1)
    // Friday is the last day in view. Hovering there must not scroll the calendar away from
    // under the pointer, or the drop lands hours later than aimed.
    await page.waitForTimeout(600)
    expect(await page.locator('.cal-scroll').evaluate((el) => el.scrollLeft)).toBe(0)
    const preview = await drawnBoard(page)

    await release(page)
    await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(0)
    expect(await drawnBoard(page)).toEqual(preview)
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: FRI, startHour: 2 })
    await expectDrawnFrom(page, 'Diogo', DOC, FRI, 2)
  })

  test('on today, and on any later day, at the hour dropped', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', WED, 5))
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: WED, startHour: 5 })
    await expect(block(page, DOC)).toHaveClass(/is-pinned/)
    await expectDrawnFrom(page, 'Sofia', DOC, WED, 5)

    // Now on the calendar, picked up by its first hour and dropped on Friday: there it goes.
    await drag(page, block(page, DOC), await slot(page, 'Sofia', FRI, 0))
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: FRI, startHour: 0 })
    await expectDrawnFrom(page, 'Sofia', DOC, FRI, 0)
  })

  test('after auto-assign, meetings and VALs go where they are dropped', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs, { sprint: unassignedSprint(tfs) })
    await page.locator('.toolbar').getByRole('button', { name: 'Auto-assign' }).click()
    await page.getByRole('dialog').locator('button.primary').click()
    await expect.poll(async () => (await saved(dataDir)).backlog).toEqual([])
    // Auto-assign pinned them — the case that used to send a dragged task back to today.
    expect(await pinOf(dataDir, 'meet')).toBeDefined()
    expect(await pinOf(dataDir, 'val')).toBeDefined()

    await drag(page, block(page, MEETING), await slot(page, 'Sofia', FRI, 5))
    await expect.poll(() => pinOf(dataDir, 'meet')).toEqual({ date: FRI, startHour: 5 })
    await expect(
      row(page, 'Sofia').locator('.seg', { has: page.locator('.seg-id', { hasText: '#104' }) })
    ).toHaveCount(3)

    await drag(page, block(page, VAL), await slot(page, 'Sofia', FRI, 2))
    await expect.poll(() => pinOf(dataDir, 'val')).toEqual({ date: FRI, startHour: 2 })
    await expectDrawnFrom(page, 'Sofia', VAL, FRI, 2)
  })

  test('a drag to the second week scrolls the calendar and lands on the hour', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    const scroller = page.locator('.cal-scroll')
    const edge = (await scroller.boundingBox())!
    await pickUp(page, block(page, VAL))
    // Held near the right edge, the calendar scrolls towards the second week.
    await moveTo(page, { x: edge.x + edge.width - 8, y: (await slot(page, 'Sofia', WED, 0)).y })
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200)
    // Away from the edge, the scrolling stops and the target holds still.
    await moveTo(page, { x: edge.x + edge.width / 2, y: (await slot(page, 'Sofia', WED, 0)).y })
    await page.waitForTimeout(300)
    await moveTo(page, await slot(page, 'Sofia', TUE2, 2))
    await release(page)

    await expect.poll(() => pinOf(dataDir, 'val')).toEqual({ date: TUE2, startHour: 2 })
    await expectDrawnFrom(page, 'Sofia', VAL, TUE2, 2)
  })
})

test.describe('moving a task between cells', () => {
  test('held by the middle, one cell on moves it one hour; one day on, one day', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    const hour = (await cell(page, 'Diogo', WED, 1).boundingBox())!.width
    // DEV fills Wednesday; pick it up by its fourth hour.
    const pressed = await pickUp(page, block(page, DEV), hour * 3.5)
    await moveTo(page, { x: pressed.x + hour, y: pressed.y })
    await release(page)
    await expect.poll(() => pinOf(dataDir, 'dev')).toEqual({ date: WED, startHour: 1 })
    await expectDrawnFrom(page, 'Diogo', DEV, WED, 1)

    // Its Thursday part, picked up and moved a whole day on: DEV starts a day later.
    const thursday = row(page, 'Diogo')
      .locator('.seg:not(.is-done)', { has: page.locator('.seg-id', { hasText: `#${DEV}` }) })
      .nth(1)
    const again = await pickUp(page, thursday, hour * 1.5)
    await moveTo(page, { x: again.x + hour * 8, y: again.y })
    await release(page)
    await expect.poll(() => pinOf(dataDir, 'dev')).toEqual({ date: THU, startHour: 1 })

    // And one cell back.
    const back = await pickUp(page, block(page, DEV), hour * 2.5)
    await moveTo(page, { x: back.x - hour, y: back.y })
    await release(page)
    await expect.poll(() => pinOf(dataDir, 'dev')).toEqual({ date: THU, startHour: 0 })
  })

  test('the drop follows the row under the cursor, however often it changed', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
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
    expect(await pinOf(dataDir, 'doc')).toEqual({ date: FRI, startHour: 1 })
    expect((await saved(dataDir)).queues.diogo.map((b) => b.id)).toEqual(['dev'])
  })

  test('after zooming, a drop still lands on the hour under the cursor', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', THU, 6))
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: THU, startHour: 6 })
  })
})

test.describe('where a task cannot go', () => {
  test('a day that has passed: marked as refused while dragging, and nothing changes', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    const before = await saved(dataDir)
    await pickUp(page, card(page, 'DOC:: Export service'))
    const tuesday = await slot(page, 'Sofia', TUE, 3)
    await moveTo(page, tuesday)
    await expect(page.locator('.drag-ghost.is-refused')).toBeVisible()
    await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(0)
    // The ghost is as long as the task (2h at 20px an hour) and level with the pointer — not
    // the size of the backlog card it was picked up from.
    const ghost = (await page.locator('.drag-ghost').boundingBox())!
    expect(ghost.width).toBeCloseTo(38, -1)
    expect(Math.abs(ghost.y + ghost.height / 2 - tuesday.y)).toBeLessThanOrEqual(4)
    // Onto a day it may go on, the preview comes back.
    await moveTo(page, await slot(page, 'Sofia', THU, 3))
    await expect(page.locator('.row-track .seg.is-preview')).toHaveCount(1)
    await expect(page.locator('.drag-ghost.is-refused')).toHaveCount(0)
    await moveTo(page, await slot(page, 'Sofia', MON, 3))
    await release(page)

    await expect(card(page, 'DOC:: Export service')).toBeVisible()
    expect(await saved(dataDir)).toEqual(before)
  })

  test('a locked day: locking leaves the board alone, and the day refuses drops', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    const before = await saved(dataDir)
    // Nothing runs into Friday: DEV ends on Thursday, so locking it cuts nothing.
    await page.locator('.cal-head .day-lock').nth(DAYS.indexOf(FRI)).click({ force: true })
    await expect.poll(async () => (await saved(dataDir)).lockedDays).toEqual([FRI])
    expect(await saved(dataDir)).toEqual({ ...before, lockedDays: [FRI] })

    await drag(page, card(page, 'DOC:: Export service'), await slot(page, 'Sofia', FRI, 3))
    await expect(card(page, 'DOC:: Export service')).toBeVisible()
    expect(await saved(dataDir)).toEqual({ ...before, lockedDays: [FRI] })
  })

  test('a day off for that person, without asking whose task it is', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const sprint = { ...dragSprint(tfs), capacityOverrides: { sofia: { [MON2]: 0 } } }
    const page = await openBoard(launch, seed, tfs, { sprint })
    // DEV belongs to Diogo in TFS: a drop on Sofia's row would ask — but not on her day off.
    await drag(page, block(page, DEV), await slot(page, 'Sofia', MON2, 2))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await pinOf(dataDir, 'dev')).toBeUndefined()
    expect((await saved(dataDir)).queues.diogo.map((b) => b.id)).toEqual(['dev'])
  })
})

test.describe('dropping on another task', () => {
  test('a drop on someone else’s row asks first', async ({ launch, seed, tfs, dataDir }) => {
    const page = await openBoard(launch, seed, tfs)
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
    expect(await pinOf(dataDir, 'dev')).toEqual({ date: FRI, startHour: 0 })
    expect((await saved(dataDir)).queues.diogo).toEqual([])
  })

  test('a drop inside another task asks how to make room', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    const question = page.getByRole('dialog', { name: `#${DEV} is already here` })
    // Thursday hour 1 is 9 hours into DEV.
    const inside = await slot(page, 'Diogo', THU, 1)

    await drag(page, card(page, 'DOC:: Export service'), inside)
    await question.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toBeHidden()
    expect((await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])

    // Split: DOC takes the hour, and DEV is drawn either side of it.
    await drag(page, card(page, 'DOC:: Export service'), inside)
    await question.getByRole('button', { name: /Split it here/ }).click()
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: THU, startHour: 1 })
    await expect(
      row(page, 'Diogo').locator('.seg:not(.is-done)', {
        has: page.locator('.seg-id', { hasText: `#${DEV}` })
      })
    ).toHaveCount(3)

    // Kept whole: DOC goes where DEV ends.
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await saved(dataDir)).backlog.map((b) => b.id)).toEqual(['doc'])
    await drag(page, card(page, 'DOC:: Export service'), inside)
    await question.getByRole('button', { name: /Keep it before/ }).click()
    await expect.poll(() => pinOf(dataDir, 'doc')).toEqual({ date: THU, startHour: 4 })
  })
})

test.describe('reported hours', () => {
  test('dragged to when they were really worked, and handed back', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await expect(reported(page, DEV)).toBeVisible()

    await drag(page, reported(page, DEV), await slot(page, 'Diogo', TUE, 4))
    await expect
      .poll(async () => (await saved(dataDir)).reportedPins?.[DEV])
      .toEqual({ memberId: 'diogo', date: TUE, startHour: 4 })
    await expect(reported(page, DEV)).toHaveClass(/is-pinned/)

    await toBacklog(page, reported(page, DEV))
    await expect.poll(async () => (await saved(dataDir)).reportedPins?.[DEV]).toBeUndefined()
  })

  test('onto today: drawn from its start, with today’s plan after them', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await drag(page, reported(page, DEV), await slot(page, 'Diogo', WED, 5))
    await expect
      .poll(async () => (await saved(dataDir)).reportedPins?.[DEV])
      .toEqual({ memberId: 'diogo', date: WED, startHour: 5 })
    const done = (await reported(page, DEV).boundingBox())!
    const wednesday = (await cell(page, 'Diogo', WED, 0).boundingBox())!
    expect(Math.abs(done.x - wednesday.x)).toBeLessThanOrEqual(2)
    await expectDrawnFrom(page, 'Diogo', DEV, WED, 2)
  })

  test('never onto a later day', async ({ launch, seed, tfs, dataDir }) => {
    const page = await openBoard(launch, seed, tfs)
    await drag(page, reported(page, DEV), await slot(page, 'Diogo', THU, 5))
    await page.waitForTimeout(300)
    expect((await saved(dataDir)).reportedPins?.[DEV]).toBeUndefined()
  })
})

test.describe('around the drag', () => {
  test('a block dragged onto the backlog leaves the calendar', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await toBacklog(page, block(page, VAL))
    await expect(card(page, 'VAL:: Export service')).toBeVisible()
    await expect(block(page, VAL)).toHaveCount(0)
    await expect.poll(async () => (await saved(dataDir)).queues.sofia).toEqual([])
  })

  test('clicking and right-clicking a block still work: dragging does not swallow them', async ({
    launch,
    seed,
    tfs
  }) => {
    const page = await openBoard(launch, seed, tfs)
    await block(page, DEV).click()
    await expect(block(page, DEV)).toHaveClass(/is-selected/)
    await expect(page.locator('.panel')).toContainText('DEV:: Export service')

    await block(page, VAL).click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('Escape cancels a drag, and Ctrl+Z undoes a drop', async ({
    launch,
    seed,
    tfs,
    dataDir
  }) => {
    const page = await openBoard(launch, seed, tfs)
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
})
