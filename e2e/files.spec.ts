import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './app'
import { DEV, settingsFor, sprintFor } from './data'

/**
 * Saving out of the app. The Save dialog is native and cannot be clicked, so it is replaced
 * inside the main process by one that answers with a path in the test's folder — or cancels.
 */

async function answerSaveDialogWith(app: ElectronApplication, filePath: string | null) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () =>
      filePath === null
        ? { canceled: true, filePath: undefined }
        : { canceled: false, filePath }) as unknown as typeof dialog.showSaveDialog
  }, filePath)
}

const note = {
  id: 'n1',
  memberId: 'diogo',
  text: 'Paired with Sofia on the export format',
  taskIds: [DEV],
  createdAt: '2026-09-15T10:00:00.000Z',
  updatedAt: '2026-09-15T10:00:00.000Z'
}

test('the sprint summary is saved as Markdown where the user chose', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  const sprint = sprintFor(tfs, { notes: [note] })
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  const target = join(dataDir, 'summary.md')
  await answerSaveDialogWith(app, target)

  await page.locator('.toolbar').getByRole('button', { name: 'Summary' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sprint summary' })
  await dialog.getByRole('button', { name: 'Save summary…' }).click()
  await expect(dialog.locator('.message.is-ok')).toBeVisible()

  const markdown = await readFile(target, 'utf8')
  expect(markdown).toContain('Sprint E2E')
  expect(markdown).toContain('DEV:: Export service')
  expect(markdown).toContain(note.text)
})

test('notes are exported as Markdown, and a cancelled Save writes nothing', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  const sprint = sprintFor(tfs, { notes: [note] })
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  const notes = page.locator('.toolbar').getByRole('button', { name: 'Notes' })

  await answerSaveDialogWith(app, null)
  expect(await page.evaluate((id) => window.api.exportNotes(id), sprint.id)).toEqual({
    ok: true,
    value: null
  })

  const target = join(dataDir, 'notes.md')
  await answerSaveDialogWith(app, target)
  await notes.click()
  await expect.poll(() => readFile(target, 'utf8').catch(() => '')).toContain(note.text)
  expect(await readFile(target, 'utf8')).toContain('Diogo')
})

test('a snapshot is exported as the JSON it is kept in', async ({ launch, seed, tfs, dataDir }) => {
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { app, page } = await launch()
  const target = join(dataDir, 'snapshot.json')
  await answerSaveDialogWith(app, target)

  await page.locator('.toolbar').getByRole('button', { name: 'Snapshot' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Snapshot name').fill('Before review')
  await dialog.getByRole('button', { name: 'Take snapshot' }).click()
  await dialog
    .locator('.snapshot', { hasText: 'Before review' })
    .getByRole('button', { name: 'Export' })
    .click()

  await expect.poll(() => readFile(target, 'utf8').catch(() => '')).toContain('Before review')
  const exported = JSON.parse(await readFile(target, 'utf8'))
  expect(exported).toMatchObject({ name: 'Before review', sprint: { id: sprint.id } })
})
