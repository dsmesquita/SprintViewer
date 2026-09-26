import { expect, test } from './app'

/**
 * The harness itself: the app runs from `out/` on a throwaway data folder, and talks to the
 * fake TFS. If these fail, every other end-to-end test is suspect.
 */

test('the app starts on the test data folder, not the real one', async ({ launch, dataDir }) => {
  const { app, page } = await launch()
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dataDir)
  await expect(page).toHaveTitle('Sprint Viewer')
  expect(await page.evaluate(() => window.api.getStoragePath())).toBe(dataDir)
})

test('the app reaches the fake TFS with the seeded settings', async ({ launch, seed, tfs }) => {
  await seed({ settings: { authMode: 'windows' } })
  const { page } = await launch()

  const result = await page.evaluate((url) => window.api.testConnection(url), tfs.queryUrl)
  expect(result).toMatchObject({ ok: true, user: 'Test User' })
  expect(tfs.requests.map((r) => r.path)).toContain('/tfs/Coll/_apis/connectionData')
})
