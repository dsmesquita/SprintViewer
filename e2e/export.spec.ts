import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './app'
import { settingsFor, sprintFor } from './data'

/**
 * Exporting people's calendars: right-click a name, or Ctrl/Shift+click several first. Save and
 * folder dialogs are native, so they are answered inside the main process.
 */

async function answerSaveWith(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath
    })) as unknown as typeof dialog.showSaveDialog
  }, filePath)
}
async function answerFolderWith(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [folder]
    })) as unknown as typeof dialog.showOpenDialog
  }, folder)
}
const name = (page: Page, who: string) =>
  page.locator('.row-name', { has: page.locator('.who', { hasText: who }) })

test.beforeEach(async ({ seed, tfs }) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
})

test('right-click a name: that person’s calendar, saved as Markdown', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const target = join(dataDir, 'diogo.md')
  await answerSaveWith(app, target)

  await name(page, 'Diogo').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Export calendar…' }).click()
  const dialog = page.getByRole('dialog', { name: "Export Diogo's calendar" })
  await expect(dialog.locator('.export-board')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Export as Markdown' }).click()
  await expect(dialog.locator('.message.is-ok')).toBeVisible()

  const markdown = await readFile(target, 'utf8')
  expect(markdown.split('\n').slice(0, 6)).toEqual([
    '# Diogo',
    '',
    expect.stringMatching(/^Sprint E2E · /),
    '',
    '| Day | Tasks |',
    '| --- | --- |'
  ])
  // DEV is on Diogo's calendar: it is on the board.
  expect(markdown).toContain('#101 (DEV)')
})

test('Ctrl+click picks several people; right-click exports a PNG for each', async ({
  launch,
  dataDir
}) => {
  const { app, page } = await launch()
  const folder = join(dataDir, 'exports')
  await mkdir(folder)
  await answerFolderWith(app, folder)

  await name(page, 'Diogo').click()
  await name(page, 'Sofia').click({ modifiers: ['Control'] })
  // Both look selected — the one change you can see.
  await expect(name(page, 'Diogo')).toHaveClass(/is-selected/)
  await expect(name(page, 'Sofia')).toHaveClass(/is-selected/)

  await name(page, 'Sofia').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Export calendars… (2 people)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export 2 calendars' })
  await expect(dialog.locator('.export-board h3')).toHaveText(['Diogo', 'Sofia'])
  await dialog.getByRole('button', { name: 'Export as PNG' }).click()
  await expect(dialog.locator('.message.is-ok')).toContainText('Saved 2 files')

  expect((await readdir(folder)).sort()).toEqual([
    'Sprint E2E - Diogo.png',
    'Sprint E2E - Sofia.png'
  ])
  const image = await readFile(join(folder, 'Sprint E2E - Diogo.png'))
  expect([...image.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // A real picture of the board, not an empty canvas.
  expect(image.length).toBeGreaterThan(5000)
})

test('a plain click on a name starts the selection again', async ({ launch }) => {
  const { page } = await launch()
  await name(page, 'Diogo').click()
  await name(page, 'Sofia').click({ modifiers: ['Shift'] })
  await expect(page.locator('.row-name.is-selected')).toHaveCount(2)
  await name(page, 'Sofia').click()
  await expect(page.locator('.row-name.is-selected')).toHaveCount(1)
  await name(page, 'Sofia').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Export calendar…' })).toBeVisible()
})
