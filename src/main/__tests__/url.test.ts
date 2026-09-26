import { describe, expect, it } from 'vitest'
import { parseTfsUrl, TfsUrlError } from '../tfs/url'

const GUID = '11111111-2222-3333-4444-555555555555'

describe('parseTfsUrl', () => {
  it('an on-prem saved query', () => {
    expect(parseTfsUrl(`https://tfs.example/tfs/Coll/Proj/_queries/query/${GUID}/`)).toEqual({
      collectionBase: 'https://tfs.example/tfs/Coll',
      projectBase: 'https://tfs.example/tfs/Coll/Proj',
      collection: 'Coll',
      project: 'Proj',
      team: undefined,
      host: 'tfs.example',
      source: { kind: 'query', queryId: GUID }
    })
  })

  it('a hosted query, and a query id given as ?id=', () => {
    const hosted = parseTfsUrl(`https://dev.azure.com/org/Proj/_queries/query-edit/${GUID}`)
    expect(hosted).toMatchObject({
      collectionBase: 'https://dev.azure.com/org',
      collection: 'org',
      project: 'Proj'
    })
    expect(parseTfsUrl(`https://tfs.example/tfs/Coll/Proj/_queries?id=${GUID}`).source).toEqual({
      kind: 'query',
      queryId: GUID
    })
  })

  it('project names with spaces are decoded, and re-encoded in the base', () => {
    const parsed = parseTfsUrl(`https://tfs.example/tfs/Coll/My%20Project/_queries/query/${GUID}`)
    expect(parsed.project).toBe('My Project')
    expect(parsed.projectBase).toBe('https://tfs.example/tfs/Coll/My%20Project')
  })

  it('a sprint taskboard gives the team and the iteration path', () => {
    const parsed = parseTfsUrl(
      'https://tfs.example/tfs/Coll/Proj/_sprints/taskboard/Squad%20A/Proj/Release/Sprint%2024.09'
    )
    expect(parsed.team).toBe('Squad A')
    expect(parsed.source).toEqual({
      kind: 'iteration',
      iterationPath: 'Proj\\Release\\Sprint 24.09'
    })
  })

  it('boards and backlogs name the team; other pages point at the project', () => {
    expect(
      parseTfsUrl('https://tfs.example/tfs/Coll/Proj/_boards/board/t/Squad%20B/Stories').team
    ).toBe('Squad B')
    expect(
      parseTfsUrl('https://tfs.example/tfs/Coll/Proj/_backlogs/backlog/Squad%20C/Stories').team
    ).toBe('Squad C')
    expect(parseTfsUrl('https://tfs.example/tfs/Coll/Proj/_workitems').source).toEqual({
      kind: 'project'
    })
    expect(parseTfsUrl('https://tfs.example/tfs/Coll/Proj').source).toEqual({ kind: 'project' })
  })

  it('a collection-only URL has no project', () => {
    const parsed = parseTfsUrl('https://tfs.example/Coll')
    expect(parsed).toMatchObject({
      collection: 'Coll',
      project: undefined,
      projectBase: 'https://tfs.example/Coll'
    })
  })

  it('refuses garbage with a message a person can act on', () => {
    expect(() => parseTfsUrl('not a url')).toThrow(TfsUrlError)
    expect(() => parseTfsUrl('ftp://tfs.example/tfs/Coll/Proj')).toThrow(/http/)
    expect(() => parseTfsUrl('https://tfs.example/')).toThrow(/collection and project/)
    expect(() =>
      parseTfsUrl('https://tfs.example/tfs/Coll/Proj/_queries/query/not-a-guid')
    ).toThrow(/query id/)
  })
})
