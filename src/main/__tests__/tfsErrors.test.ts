import { describe, expect, it } from 'vitest'
import { TfsClient } from '../tfs/client'
import { html, json, setHandler } from '../../../test/electron'

/**
 * What a failed request tells the user. The status comes first: a query that is gone answers
 * 404 whether the server sends its error as data or as a web page, and only a web page that
 * arrives with a 200 means "not signed in".
 */

const target = {
  host: 'tfs.example',
  collectionBase: 'https://tfs.example/tfs/Coll',
  projectBase: 'https://tfs.example/tfs/Coll/Proj',
  project: 'Proj',
  source: { kind: 'query', queryId: 'q' }
} as never

/** Runs the query against a server that answers the query itself with `answer`. */
async function failure(answer: () => Response): Promise<string> {
  setHandler((call: { url: string }) =>
    call.url.includes('/wiql/') ? answer() : json(200, { value: [] })
  )
  const client = new TfsClient(target, { mode: 'windows' }, '7.0')
  return client.fetchWorkItems().then(
    () => 'resolved',
    (error: Error) => error.message
  )
}

const page = (status: number, statusText = '') =>
  new Response('<html>error</html>', {
    status,
    statusText,
    headers: { 'content-type': 'text/html' }
  })

describe('a refused request says why', () => {
  it('a query that is gone, answered as a web page: not found, not "not signed in"', async () => {
    const message = await failure(() => page(404, 'Not Found'))
    expect(message).toMatch(/^TFS could not find what this URL points at \(404\)/)
    expect(message).toMatch(/deleted or moved/)
    expect(message).not.toMatch(/authenticated/)
  })

  it('TFS’s own message, when it sends one, is what the user reads', async () => {
    const message = await failure(() =>
      json(404, { message: 'TF401243: The query q does not exist, or you do not have permission.' })
    )
    expect(message).toBe('TF401243: The query q does not exist, or you do not have permission.')
  })

  it('a query using @CurrentIteration gets told what to do instead', async () => {
    const message = await failure(() =>
      json(400, { message: 'The macro @CurrentIteration requires a team context.' })
    )
    expect(message).toMatch(/^The macro @CurrentIteration requires a team context\./)
    expect(message).toMatch(/taskboard address instead/)
  })

  it('a server error says it is the server’s, with the status', async () => {
    expect(await failure(() => page(500, 'Internal Server Error'))).toMatch(
      /^tfs\.example had an error of its own \(500 Internal Server Error\)/
    )
    expect(await failure(() => json(503, {}))).toMatch(/\(503\)/)
  })

  it('any other status is named', async () => {
    expect(await failure(() => page(418))).toBe('TFS returned 418.')
  })

  it('only a web page that arrives with a 200 is a sign-in page', async () => {
    expect(await failure(() => html(200))).toMatch(/answered with a web page instead of data/)
  })
})
