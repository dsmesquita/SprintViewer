import { describe, expect, it } from 'vitest'
import {
  excerpt,
  failureLines,
  failureReport,
  RESPONSE_EXCERPT,
  type FailureDetail
} from '@shared/failure'

/** The details of a failed refresh, as the dialog lists them and as Copy details writes them. */

const detail: FailureDetail = {
  url: 'https://tfs.example/tfs/Coll/Proj/_queries/query/q',
  step: 'query',
  request: {
    method: 'GET',
    url: 'https://tfs.example/tfs/Coll/Proj/_apis/wit/wiql/q?api-version=7.0'
  },
  status: 404,
  statusText: 'Not Found',
  response: '{"message":"TF401243: The query does not exist."}',
  apiVersion: '7.0',
  authMode: 'pat',
  childQueryMode: 'auto',
  at: '2026-09-28T09:30:00.000Z'
}

describe('the details of a failed refresh', () => {
  it('are listed in reading order, and blank facts are left out', () => {
    expect(failureLines(detail).map(([label]) => label)).toEqual([
      'Step',
      'Sprint URL',
      'Request',
      'Status',
      'API version',
      'Sign-in',
      'Child tasks',
      'When'
    ])
    const lines = Object.fromEntries(failureLines(detail))
    expect(lines).toMatchObject({
      Step: 'Running the query',
      Request: 'GET https://tfs.example/tfs/Coll/Proj/_apis/wit/wiql/q?api-version=7.0',
      Status: '404 Not Found',
      'Sign-in': 'Personal access token'
    })
  })

  it('a request that got no answer names the cause instead of a status', () => {
    const lines = Object.fromEntries(
      failureLines({
        ...detail,
        step: 'connect',
        status: undefined,
        statusText: undefined,
        cause: 'net::ERR_CERT_AUTHORITY_INVALID',
        authMode: 'windows'
      })
    )
    expect(lines.Status).toBeUndefined()
    expect(lines).toMatchObject({
      Step: 'Connecting to the server',
      Cause: 'net::ERR_CERT_AUTHORITY_INVALID',
      'Sign-in': 'Windows account'
    })
  })

  it('Copy details writes the message, every fact and the server’s answer', () => {
    const report = failureReport('TF401243: The query does not exist.', detail)
    expect(report.split('\n').slice(0, 5)).toEqual([
      'Refresh failed',
      '',
      'TF401243: The query does not exist.',
      '',
      'Step: Running the query'
    ])
    expect(report).toContain('Status: 404 Not Found')
    expect(report.endsWith('Response:\n{"message":"TF401243: The query does not exist."}')).toBe(
      true
    )
    // With nothing more known, just the message.
    expect(failureReport('Offline.', undefined)).toBe('Refresh failed\n\nOffline.')
  })

  it('only the start of a long answer is kept', () => {
    const page = 'x'.repeat(RESPONSE_EXCERPT + 500)
    expect(excerpt(page)).toHaveLength(RESPONSE_EXCERPT + 1)
    expect(excerpt(page).endsWith('…')).toBe(true)
    expect(excerpt('  short  ')).toBe('short')
  })
})
