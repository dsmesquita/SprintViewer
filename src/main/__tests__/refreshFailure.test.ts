import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerIpc } from '../ipc'
import { html, invoke, json, setEncryptionAvailable, setServer } from '../../../test/electron'
import type { Result } from '@shared/ipc'
import type { WorkItem } from '@shared/types'

/**
 * A refresh that fails brings its details with it: the step, the request that failed, what the
 * server answered — and never the token.
 */

const ID = '11111111-2222-3333-4444-555555555555'
const QUERY = `https://tfs.example/tfs/Coll/Proj/_queries/query/${ID}`
const TOKEN = 'secret-token-abc123'
const connected = () => json(200, { authenticatedUser: { providerDisplayName: 'T' } })

const refresh = (mode?: string) => invoke<Result<WorkItem[]>>('sprint:refresh', QUERY, mode)
const failed = async (mode?: string) => {
  const result = await refresh(mode)
  if (result.ok) throw new Error('the refresh was expected to fail')
  return result
}

beforeAll(async () => {
  registerIpc()
  setEncryptionAvailable(true)
  await invoke('settings:update', { authMode: 'pat', apiVersion: '7.0' })
  await invoke('settings:setPat', TOKEN)
})
afterAll(() => setEncryptionAvailable(false))

describe('a failed refresh says where, and what came back', () => {
  it('a query that is gone: the query step, the request, the status and the page', async () => {
    setServer((call) =>
      call.url.includes('/connectionData')
        ? connected()
        : call.url.includes('/wiql/')
          ? html(404)
          : json(200, { value: [] })
    )
    const result = await failed('never')
    expect(result.message).toMatch(/could not find what this URL points at \(404\)/)
    expect(result.detail).toMatchObject({
      url: QUERY,
      step: 'query',
      request: {
        method: 'GET',
        url: `https://tfs.example/tfs/Coll/Proj/_apis/wit/wiql/${ID}?api-version=7.0`
      },
      status: 404,
      response: '<html>nope</html>',
      apiVersion: '7.0',
      authMode: 'pat',
      childQueryMode: 'never'
    })
    expect(Date.parse(result.detail!.at)).not.toBeNaN()
  })

  it('reading the work items: that step, and TFS’s own answer', async () => {
    setServer((call) =>
      call.url.includes('/wiql/')
        ? json(200, { workItems: [{ id: 1 }] })
        : call.url.includes('workitems?ids=')
          ? json(500, { message: 'Database timeout.' })
          : connected()
    )
    const result = await failed()
    expect(result.message).toBe('Database timeout.')
    expect(result.detail).toMatchObject({
      step: 'items',
      status: 500,
      response: '{"message":"Database timeout."}',
      childQueryMode: 'auto'
    })
  })

  it('no answer at all: the cause underneath, and no status', async () => {
    setServer(() => {
      throw new TypeError('net::ERR_CONNECTION_REFUSED')
    })
    const result = await failed()
    expect(result.detail?.cause).toBe('net::ERR_CONNECTION_REFUSED')
    expect(result.detail?.status).toBeUndefined()
  })

  it('a URL that is not a TFS address fails before any request', async () => {
    const result = await invoke<Result<WorkItem[]>>('sprint:refresh', 'not a url')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.detail).toMatchObject({ step: 'connect', url: 'not a url' })
    expect(!result.ok && result.detail?.request).toBeUndefined()
  })

  it('the token is nowhere in the details, plain or encoded', async () => {
    setServer((call) => (call.url.includes('/wiql/') ? html(404) : connected()))
    const result = await failed()
    const text = JSON.stringify(result)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(Buffer.from(`:${TOKEN}`).toString('base64'))
  })
})
