import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sprint } from '../src/shared/types'
import { expect, test } from './app'
import { DEV, settingsFor, sprintFor, STORY, storyWithTasks, VAL } from './data'

/** A sprint's life against TFS: importing it, reopening it, refreshing it, adding tasks to it. */

async function savedSprints(dataDir: string): Promise<Sprint[]> {
  const dir = join(dataDir, 'sprints')
  const files = await readdir(dir).catch(() => [] as string[])
  return Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => JSON.parse(await readFile(join(dir, file), 'utf8')) as Sprint)
  )
}

const savedSprint = async (dataDir: string, id: string): Promise<Sprint | undefined> =>
  (await savedSprints(dataDir)).find((sprint) => sprint.id === id)

test('a sprint imported from a TFS query is drawn and saved, and reopens after a restart', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  storyWithTasks(tfs)
  await seed({ settings: settingsFor(tfs) })
  const first = await launch()
  let { page } = first

  await page.getByRole('button', { name: 'Start sprint…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Start sprint' })
  await dialog.getByLabel('Name').fill('Sprint 1')
  await expect(dialog.getByLabel('Query or sprint URL')).toHaveValue(tfs.queryUrl)
  await dialog.getByRole('button', { name: 'Start sprint' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.locator('.toolbar .title')).toHaveText('Sprint 1')
  await expect(page.locator('.row-name .who')).toHaveText(['Diogo', 'Sofia'])
  // The tasks wait in the backlog, under their story.
  const group = page.locator('.group', { hasText: 'Export service' })
  await expect(group.locator('.task-title')).toHaveText([
    'DEV:: Export service',
    'VAL:: Export service'
  ])

  await expect.poll(async () => (await savedSprints(dataDir)).length).toBe(1)
  const [saved] = await savedSprints(dataDir)
  expect(saved.name).toBe('Sprint 1')
  expect(Object.keys(saved.workItems).map(Number).sort()).toEqual([STORY, DEV, VAL])
  expect(saved.backlog.map((block) => [block.workItemId, block.hours])).toEqual([
    [DEV, 6],
    [VAL, 3]
  ])

  await first.close()
  ;({ page } = await launch())
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint 1')
  await expect(
    page.locator('.group', { hasText: 'Export service' }).locator('.task-title')
  ).toHaveCount(2)
})

test('Refresh reads the new figures from TFS', async ({ launch, seed, tfs, dataDir }) => {
  storyWithTasks(tfs)
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { page } = await launch()
  await expect(page.locator('.toolbar .title')).toHaveText('Sprint E2E')

  // Three more hours worked on DEV since the import.
  tfs.update(DEV, {
    'Microsoft.VSTS.Scheduling.RemainingWork': 3,
    'Microsoft.VSTS.Scheduling.CompletedWork': 5
  })
  await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(
    page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true })
  ).toBeEnabled()
  await expect(page.locator('.toolbar')).not.toContainText('refresh failed')

  await expect
    .poll(async () => (await savedSprint(dataDir, sprint.id))?.workItems[DEV])
    .toMatchObject({ remainingWork: 3, completedWork: 5 })
  expect(tfs.requests.some((r) => r.path.endsWith(`/_apis/wit/wiql/${tfsQueryId(tfs)}`))).toBe(true)
})

test('a new query URL saved in Settings is the one Refresh reads', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  storyWithTasks(tfs)
  // Started from a query TFS no longer has.
  const gone = tfs.queryUrl.replace(/query\/.*$/, 'query/00000000-0000-0000-0000-000000000000')
  const sprint = sprintFor(tfs, { queryUrl: gone })
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { page } = await launch()
  const refresh = page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true })

  await refresh.click()
  await expect(page.locator('.toolbar')).toContainText('refresh failed')

  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByLabel('Query or sprint URL')).toHaveValue(gone)
  await settings.getByLabel('Query or sprint URL').fill(tfs.queryUrl)
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()

  tfs.update(DEV, { 'Microsoft.VSTS.Scheduling.RemainingWork': 1 })
  await refresh.click()
  await expect(refresh).toBeEnabled()
  await expect(page.locator('.toolbar')).not.toContainText('refresh failed')
  await expect
    .poll(async () => (await savedSprint(dataDir, sprint.id))?.workItems[DEV]?.remainingWork)
    .toBe(1)
  expect((await savedSprint(dataDir, sprint.id))?.queryUrl).toBe(tfs.queryUrl)
})

test('a refresh that disagrees with hours set by hand asks first', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  storyWithTasks(tfs)
  // DEV was set to 10h by hand; TFS says 6 remaining + 2 completed = 8.
  const sprint = sprintFor(tfs, { customHours: { [DEV]: 10 } })
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { page } = await launch()

  await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Your hours, or the ones from TFS?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.conflict')).toHaveCount(1)

  await dialog.getByRole('button', { name: 'Keep mine' }).click()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(async () => (await savedSprint(dataDir, sprint.id))?.customHours)
    .toEqual({ [DEV]: 10 })
})

test('Create tasks writes one Task under the story in TFS, and adds it to the backlog', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  storyWithTasks(tfs)
  const sprint = sprintFor(tfs)
  await seed({ settings: { ...settingsFor(tfs), activeSprintId: sprint.id }, sprints: [sprint] })
  const { page } = await launch()

  await page.locator('.group-head', { hasText: 'Export service' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Create tasks…' }).click()
  const dialog = page.getByRole('dialog', { name: `Create tasks under #${STORY}` })
  await dialog.getByRole('button', { name: /^Create \d+ tasks?$/ }).click()
  await expect(dialog).toBeHidden()

  const posts = tfs.requests.filter((r) => r.path.endsWith('/_apis/wit/workitems/$Task'))
  expect(posts).toHaveLength(1)
  const fields = Object.fromEntries(
    (posts[0].body as Array<{ path: string; value: unknown }>).map((op) => [op.path, op.value])
  )
  expect(fields).toMatchObject({
    '/fields/System.Title': 'Export service',
    '/fields/System.AssignedTo': 'Diogo Mesquita',
    '/fields/System.IterationPath': 'Proj\\Sprint 1',
    '/relations/-': {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: expect.stringMatching(new RegExp(`/_apis/wit/workItems/${STORY}$`))
    }
  })

  // The new task is in the backlog, and saved there.
  await expect
    .poll(async () => (await savedSprint(dataDir, sprint.id))?.backlog.map((b) => b.workItemId))
    .toContain(9000)
})

const tfsQueryId = (tfs: { queryUrl: string }) => tfs.queryUrl.split('/').at(-1)
