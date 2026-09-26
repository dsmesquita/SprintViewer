import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A TFS stand-in on localhost for the end-to-end tests: just enough of the REST API for the
 * app to connect, import a query, refresh it, list a team and create tasks. Its state is plain
 * data the test changes between steps ("TFS now says 6h completed"), and every request it
 * receives is recorded.
 *
 * The paths and JSON shapes are the ones `src/main/tfs/client.ts` uses; the unit tests in
 * `src/main/__tests__/tfsClient.test.ts` hold the stricter checks of that client.
 */

export const QUERY_ID = '11111111-2222-3333-4444-555555555555'

/** A work item as TFS returns it. `fields` uses TFS's reference names. */
export interface RawItem {
  id: number
  fields: Record<string, unknown>
}

export interface Recorded {
  method: string
  path: string
  body?: unknown
  /** The Authorization header, when there was one. */
  authorization?: string
}

export interface TeamMember {
  id: string
  displayName: string
  uniqueName?: string
}

export interface FakeTfs {
  /** A query URL that returns `queried`, for Start sprint and Refresh. */
  queryUrl: string
  /** Every work item the server knows, by id. Change it and the next fetch sees the change. */
  items: Map<number, RawItem>
  /** Which items the query returns. */
  queried: number[]
  teams: Array<{ id: string; name: string; members: TeamMember[] }>
  /** Everything received, oldest first. */
  requests: Recorded[]
  /** Adds (or replaces) a work item; `fields` are merged over a plain active Task. */
  add(id: number, fields?: Record<string, unknown>): RawItem
  /** Changes some fields of an item already there. */
  update(id: number, fields: Record<string, unknown>): void
  close(): Promise<void>
}

const COLLECTION = '/tfs/Coll'
const PROJECT = `${COLLECTION}/Proj`
export const ITERATION = 'Proj\\Sprint 1'

export async function startFakeTfs(): Promise<FakeTfs> {
  const items = new Map<number, RawItem>()
  const requests: Recorded[] = []
  let nextId = 9000

  const state = {
    queried: [] as number[],
    teams: [] as FakeTfs['teams']
  }

  const add = (id: number, fields: Record<string, unknown> = {}): RawItem => {
    const item: RawItem = {
      id,
      fields: {
        'System.Title': `Task ${id}`,
        'System.WorkItemType': 'Task',
        'System.State': 'Active',
        'System.IterationPath': ITERATION,
        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
        ...fields
      }
    }
    items.set(id, item)
    return item
  }

  const answer = (path: string, method: string, url: URL, body: unknown): [number, unknown] => {
    if (method === 'GET' && path === `${COLLECTION}/_apis/connectionData`) {
      return [200, { authenticatedUser: { providerDisplayName: 'Test User' } }]
    }

    if (method === 'GET' && path === `${PROJECT}/_apis/wit/wiql/${QUERY_ID}`) {
      return [200, { workItems: state.queried.map((id) => ({ id })) }]
    }

    // Child tasks: "... [System.Parent] IN (1, 2) AND [System.IterationPath] = '...'".
    if (method === 'POST' && path === `${PROJECT}/_apis/wit/wiql`) {
      const query = String((body as { query?: string })?.query ?? '')
      const parents = /\[System\.Parent\] IN \(([^)]*)\)/.exec(query)?.[1]
      const wanted = new Set((parents ?? '').split(',').map((id) => Number(id.trim())))
      const children = [...items.values()].filter((item) =>
        wanted.has(Number(item.fields['System.Parent']))
      )
      return [200, { workItems: children.map((item) => ({ id: item.id })) }]
    }

    if (method === 'GET' && path === `${COLLECTION}/_apis/wit/workitems`) {
      const ids = (url.searchParams.get('ids') ?? '').split(',').map(Number)
      const value = ids.flatMap((id) => {
        const item = items.get(id)
        return item
          ? [{ ...item, url: `${url.origin}${COLLECTION}/_apis/wit/workItems/${id}` }]
          : []
      })
      return [200, { value }]
    }

    if (
      (method === 'POST' || method === 'PATCH') &&
      path === `${PROJECT}/_apis/wit/workitems/$Task`
    ) {
      const fields: Record<string, unknown> = {}
      for (const op of body as Array<{ path: string; value: unknown }>) {
        if (op.path.startsWith('/fields/')) fields[op.path.slice('/fields/'.length)] = op.value
      }
      const created = add(nextId++, { 'System.State': 'New', ...fields })
      return [200, created]
    }

    const teams = `${COLLECTION}/_apis/projects/Proj/teams`
    if (method === 'GET' && path === teams) {
      return [200, { value: state.teams.map(({ id, name }) => ({ id, name })) }]
    }
    const members = new RegExp(`^${teams}/([^/]+)/members$`).exec(path)
    if (method === 'GET' && members) {
      const team = state.teams.find((t) => t.id === decodeURIComponent(members[1]))
      return team
        ? [200, { value: team.members.map((identity) => ({ identity })) }]
        : [404, { message: 'No such team.' }]
    }

    return [404, { message: `The fake TFS does not know ${method} ${path}.` }]
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      let body: unknown
      try {
        body = raw ? JSON.parse(raw) : undefined
      } catch {
        body = raw
      }
      requests.push({
        method,
        path: url.pathname,
        body,
        authorization: request.headers.authorization
      })
      const [status, json] = answer(url.pathname, method, url, body)
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(json))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    queryUrl: `http://127.0.0.1:${port}${PROJECT}/_queries/query/${QUERY_ID}`,
    items,
    get queried() {
      return state.queried
    },
    set queried(ids) {
      state.queried = ids
    },
    get teams() {
      return state.teams
    },
    set teams(teams) {
      state.teams = teams
    },
    requests,
    add,
    update(id, fields) {
      const item = items.get(id)
      if (!item) throw new Error(`The fake TFS has no work item ${id}.`)
      item.fields = { ...item.fields, ...fields }
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}
