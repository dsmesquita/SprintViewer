import { beforeAll, describe, expect, it } from 'vitest'
import { registerIpc } from '../ipc'
import { TfsClient } from '../tfs/client'
import { parseTfsUrl } from '../tfs/url'
import { invoke, json, requests, setServer, userData } from '../../../test/electron'

/**
 * Finding a REST API version the server accepts. Old on-prem servers reject new versions, and
 * some say which range they do accept — the client should jump there rather than walk down.
 */

const target = parseTfsUrl(
  'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
)
const versionsTried = () =>
  requests
    .filter((r) => r.url.includes('connectionData'))
    .map((r) => new URL(r.url).searchParams.get('api-version'))

/** A server that accepts exactly `accepted`, answering anything else with `reject(version)`. */
function server(accepted: string, reject: (version: string) => string) {
  setServer((call) => {
    const version = new URL(call.url).searchParams.get('api-version')!
    if (version === accepted)
      return json(200, { authenticatedUser: { providerDisplayName: 'Diogo' } })
    return json(400, { message: reject(version) })
  })
}

describe('connect: negotiating the API version', () => {
  it('jumps straight to the highest version the server says it supports', async () => {
    server(
      '4.1',
      (v) =>
        `The requested REST API version of ${v} is out of range for this server. The latest REST API version this server supports is 4.1.`
    )
    const client = new TfsClient(target, { mode: 'windows' })
    expect(await client.connect()).toEqual({ user: 'Diogo', apiVersion: '4.1' })
    expect(versionsTried()).toEqual(['7.0', '4.1'])
  })

  it('picks the top of a range the server names', async () => {
    server(
      '5.0',
      (v) => `API version ${v} is not supported. Supported versions are between 1.0 and 5.0.`
    )
    await new TfsClient(target, { mode: 'windows' }).connect()
    expect(versionsTried()).toEqual(['7.0', '5.0'])
  })

  it('without a hint, walks down one version at a time', async () => {
    server('5.0', () => 'Unsupported REST API version.')
    await new TfsClient(target, { mode: 'windows' }).connect()
    expect(versionsTried()).toEqual(['7.0', '6.0', '5.0'])
  })

  it('a version pinned in Settings is tried first', async () => {
    server('3.2', () => 'Unsupported REST API version.')
    await new TfsClient(target, { mode: 'windows' }, '3.2').connect()
    expect(versionsTried()).toEqual(['3.2'])
  })

  it('when nothing is accepted, says what was tried and what to do', async () => {
    server('99.0', () => 'Unsupported REST API version.')
    await expect(new TfsClient(target, { mode: 'windows' }).connect()).rejects.toThrow(
      /tried 7\.0, 6\.0, 5\.0, 4\.1, 3\.2, 3\.0, 2\.0, 1\.0[\s\S]*Settings under API version/
    )
  })

  it('a sign-in failure stops at once instead of trying every version', async () => {
    setServer(() => json(401, {}))
    await expect(new TfsClient(target, { mode: 'windows' }).connect()).rejects.toThrow(/401/)
    expect(versionsTried()).toEqual(['7.0'])
  })
})

describe('app:storagePath', () => {
  beforeAll(() => registerIpc())
  it('tells Settings where the files are kept', async () => {
    expect(await invoke('app:storagePath')).toBe(userData)
  })
})
