import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './app'
import { DIOGO, settingsFor, SOFIA } from './data'

/** Settings as they reach the disk: the sealed token, the roster, and what survives a restart. */

const onDisk = async (dataDir: string) =>
  JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')) as Record<string, unknown>

// Made up for this test; the fake TFS accepts anything.
const TOKEN = 'e2e-fake-token-7f3a'

test('a token is stored sealed, shown only as a hint, and still works after a restart', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  await seed({ settings: { ...settingsFor(tfs), authMode: 'pat' } })
  const first = await launch()
  let { page } = first

  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.locator('#pat').fill(TOKEN)
  await settings.getByRole('button', { name: 'Save token' }).click()
  await expect(settings.locator('#pat')).toHaveValue(/7f3a$/)
  await expect(settings.locator('#pat')).not.toHaveValue(TOKEN)

  const raw = await readFile(join(dataDir, 'settings.json'), 'utf8')
  expect(raw).not.toContain(TOKEN)
  expect(JSON.parse(raw).patCipher).toEqual(expect.any(String))
  expect(await page.evaluate(() => window.api.getSettings())).not.toHaveProperty('patCipher')

  // The token is what TFS receives.
  await page.evaluate((url) => window.api.testConnection(url), tfs.queryUrl)
  const basic = 'Basic ' + Buffer.from(`:${TOKEN}`).toString('base64')
  expect(tfs.requests.at(-1)?.authorization).toBe(basic)

  await first.close()
  ;({ page } = await launch())
  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' }).locator('#pat')).toHaveValue(/7f3a$/)
})

test('settings saved in the dialog are on disk and back after a restart', async ({
  launch,
  seed,
  tfs,
  dataDir
}) => {
  await seed({ settings: settingsFor(tfs) })
  const first = await launch()
  let { page } = first

  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  await page.locator('#hours').fill('7')
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  await expect.poll(async () => (await onDisk(dataDir)).hoursPerDay).toBe(7)

  await first.close()
  ;({ page } = await launch())
  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('#hours')).toHaveValue('7')
})

test('the roster syncs from a TFS team', async ({ launch, seed, tfs, dataDir }) => {
  tfs.teams = [
    { id: 'other', name: 'Another team', members: [] },
    {
      id: 'squad',
      name: 'Proj Team',
      members: [
        { id: 'u1', displayName: 'Diogo Mesquita', uniqueName: 'CMF\\dmesquita' },
        { id: 'u2', displayName: 'Sofia Marques', uniqueName: 'CMF\\smarques' },
        { id: 'u3', displayName: 'Bruno Rocha', uniqueName: 'CMF\\bsrocha' }
      ]
    }
  ]
  await seed({ settings: settingsFor(tfs) })
  const { page } = await launch()

  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('button', { name: 'Sync with TFS team…' }).click()

  // The team the project is named after is picked on its own.
  await expect(settings.locator('#sync-team')).toHaveValue('squad')
  const newcomers = settings.locator('.sync-section', {
    hasText: 'On Proj Team, not on the roster'
  })
  await expect(newcomers).toContainText('Bruno Rocha')

  await settings.getByRole('button', { name: 'Apply to roster' }).click()
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()

  await expect
    .poll(async () => ((await onDisk(dataDir)).members as Array<{ tfsIdentity?: string }>).length)
    .toBe(3)
  const members = (await onDisk(dataDir)).members as Array<{ name: string; tfsIdentity?: string }>
  expect(members.map((m) => m.name)).toEqual([DIOGO.name, SOFIA.name, expect.any(String)])
  expect(members[2].tfsIdentity).toContain('Bruno Rocha')
  expect(tfs.requests.map((r) => r.path)).toContain(
    '/tfs/Coll/_apis/projects/Proj/teams/squad/members'
  )
})
