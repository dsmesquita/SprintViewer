/**
 * Why a request to TFS failed, in full: what was asked, of which server, at which step, and
 * what came back. The message says it for a person; these are the facts behind it, for the
 * details dialog and for pasting into a ticket. Never holds the token: it travels in a header,
 * and nothing here reads headers.
 */
export interface FailureDetail {
  /** The query or sprint URL the sprint reads from. */
  url: string
  /** Which part of reading the sprint failed. */
  step: FailureStep
  /** The last request made — the one that failed. */
  request?: { method: string; url: string }
  status?: number
  statusText?: string
  /** The start of what the server sent back, as text. */
  response?: string
  /** The error underneath, when the request never got an answer (the network, a certificate). */
  cause?: string
  apiVersion?: string
  authMode: string
  childQueryMode?: string
  /** When it failed, as an ISO timestamp. */
  at: string
}

export type FailureStep = 'connect' | 'query' | 'items' | 'children'

const STEPS: Record<FailureStep, string> = {
  connect: 'Connecting to the server',
  query: 'Running the query',
  items: 'Reading the work items',
  children: 'Reading the child tasks'
}

/** How much of the server's answer to keep: enough to read its error, not a whole page. */
export const RESPONSE_EXCERPT = 2000

export function excerpt(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > RESPONSE_EXCERPT ? `${trimmed.slice(0, RESPONSE_EXCERPT)}…` : trimmed
}

/** The details as labelled lines, in the order a person reads them. Blank facts are left out. */
export function failureLines(detail: FailureDetail): Array<[string, string]> {
  const lines: Array<[string, string | undefined]> = [
    ['Step', STEPS[detail.step]],
    ['Sprint URL', detail.url],
    ['Request', detail.request && `${detail.request.method} ${detail.request.url}`],
    [
      'Status',
      detail.status !== undefined
        ? `${detail.status}${detail.statusText ? ` ${detail.statusText}` : ''}`
        : undefined
    ],
    ['Cause', detail.cause],
    ['API version', detail.apiVersion],
    ['Sign-in', detail.authMode === 'windows' ? 'Windows account' : 'Personal access token'],
    ['Child tasks', detail.childQueryMode],
    ['When', new Date(detail.at).toLocaleString()]
  ]
  return lines.filter((line): line is [string, string] => Boolean(line[1]))
}

/** Everything, as plain text to copy: the message, the details, and the server's answer. */
export function failureReport(message: string, detail: FailureDetail | undefined): string {
  const parts = ['Refresh failed', '', message]
  if (detail) {
    parts.push('', ...failureLines(detail).map(([label, value]) => `${label}: ${value}`))
    if (detail.response) parts.push('', 'Response:', detail.response)
  }
  return parts.join('\n')
}
