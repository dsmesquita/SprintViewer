import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Stands in for Electron in a Node test run, wired up by `test/setup.ts`.
 *
 * Settings, sprints and snapshots go to a throwaway folder; IPC handlers are captured in
 * `handlers` so a test can call a route directly; and `net.fetch` is a fake TFS server whose
 * responses each test decides with `setServer`, every request recorded in `requests`.
 */

export interface FakeRequest {
  url: string
  method?: string
  contentType?: string
  body?: any
}

type Server = (request: FakeRequest) => Response | Promise<Response>

const userData = mkdtempSync(join(tmpdir(), 'sprint-viewer-test-'))

// A route answers with whatever that route returns; tests read the fields they expect.
type Handler = (event: unknown, ...args: any[]) => any
export const handlers = new Map<string, Handler>()
export const requests: FakeRequest[] = []
/** The same list as `requests`, under the name the TFS client tests use. */
export const calls = requests

let server: Server = () => json(404, {})

/** Decides how the fake server answers from now on, and forgets earlier requests. */
export function setServer(next: Server): void {
  server = next
  requests.length = 0
}
export const setHandler = setServer

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

export function html(status: number): Response {
  return new Response('<html>nope</html>', { status, headers: { 'content-type': 'text/html' } })
}

export const app = { getPath: () => userData, getVersion: () => 'test' }
export const ipcMain = {
  handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
}

/** Where the next Save dialog "saves" to; `null` means the user cancelled. */
let savePath: string | null = null
export function setSavePath(path: string | null): void {
  savePath = path
}
export const dialog = {
  showSaveDialog: async (options: { defaultPath?: string }) => {
    dialog.lastDefaultPath = options.defaultPath
    return savePath ? { canceled: false, filePath: savePath } : { canceled: true, filePath: '' }
  },
  lastDefaultPath: undefined as string | undefined
}

export const session = { defaultSession: { allowNTLMCredentialsForDomains() {} } }

/**
 * DPAPI stand-in. Off by default, as on a machine where Windows will not provide it; a test
 * turns it on to store a token. The "cipher" is recognisable so a test can prove the clear
 * token never reaches the file.
 */
let encryption = false
export function setEncryptionAvailable(on: boolean): void {
  encryption = on
}
export const safeStorage = {
  isEncryptionAvailable: () => encryption,
  encryptString: (text: string) => Buffer.from(`sealed:${[...text].reverse().join('')}`),
  decryptString: (cipher: Buffer) => {
    const text = cipher.toString()
    if (!text.startsWith('sealed:')) throw new Error('not ours')
    return [...text.slice('sealed:'.length)].reverse().join('')
  }
}
export { userData }
export const shell = {}
export const BrowserWindow = class {}
export const net = {
  fetch: async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const call: FakeRequest = {
      url,
      method: init.method,
      contentType: headers['Content-Type'],
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    }
    requests.push(call)
    return server(call)
  }
}

/** Calls an IPC route the way the renderer would, through the captured handler. */
export function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No IPC handler for ${channel} — call registerIpc() first`)
  return Promise.resolve(handler({}, ...args) as T)
}
