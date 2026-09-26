import { expect, test } from './app'
import { settingsFor } from './data'
import { startFakeTfs, type FakeTfs } from './fakeTfs'

/**
 * "Trust certificates from": an on-prem TFS behind an internal CA presents a certificate
 * Chromium does not trust. The app refuses it like a browser would, unless the user named that
 * host in Settings — and then only that host.
 *
 * The fake TFS here serves HTTPS with a self-signed certificate nobody trusts (`certs/`).
 */

let secure: FakeTfs
test.beforeEach(async () => {
  secure = await startFakeTfs({ https: true })
})
test.afterEach(async () => {
  await secure.close()
})

const connect = (page: import('@playwright/test').Page) =>
  page.evaluate((url) => window.api.testConnection(url), secure.queryUrl)

test('a server with an untrusted certificate is refused', async ({ launch, seed }) => {
  await seed({ settings: { ...settingsFor(secure), trustedHosts: [] } })
  const { page } = await launch()

  const result = await connect(page)
  expect(result.ok).toBe(false)
  expect(result.message).toContain('Could not reach 127.0.0.1')
  // Refused during the handshake: nothing reached the server.
  expect(secure.requests).toEqual([])
})

test('a host named in Settings is trusted', async ({ launch, seed }) => {
  await seed({ settings: { ...settingsFor(secure), trustedHosts: ['127.0.0.1'] } })
  const { page } = await launch()

  expect(await connect(page)).toMatchObject({ ok: true, user: 'Test User' })
  expect(secure.requests.map((r) => r.path)).toContain('/tfs/Coll/_apis/connectionData')
})

test('trusting another host does not trust this one', async ({ launch, seed }) => {
  await seed({ settings: { ...settingsFor(secure), trustedHosts: ['tfs.example', 'localhost'] } })
  const { page } = await launch()

  expect((await connect(page)).ok).toBe(false)
  expect(secure.requests).toEqual([])
})

test('adding the host in the Settings dialog takes effect without a restart', async ({
  launch,
  seed
}) => {
  await seed({ settings: settingsFor(secure) })
  const { page } = await launch()

  await page.locator('.toolbar').getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.locator('#trusted').fill('127.0.0.1')
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()

  expect(await connect(page)).toMatchObject({ ok: true, user: 'Test User' })
})
