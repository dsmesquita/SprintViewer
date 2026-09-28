import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useApp } from '../../store'
import { failureReport, type FailureDetail } from '@shared/failure'
import { item, sprint } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** A failed refresh: the ⚠ beside "refresh failed", and the details it opens. */

const initial = useApp.getState()
const QUERY = 'https://tfs.example/tfs/Coll/Proj/_queries/query/q'
const MESSAGE = 'TFS could not find what this URL points at (404).'
const detail: FailureDetail = {
  url: QUERY,
  step: 'query',
  request: { method: 'GET', url: 'https://tfs.example/tfs/Coll/Proj/_apis/wit/wiql/q' },
  status: 404,
  statusText: 'Not Found',
  response: '<html>Page not found</html>',
  apiVersion: '7.0',
  authMode: 'pat',
  childQueryMode: 'auto',
  at: '2026-09-28T09:30:00.000Z'
}

let fake: ReturnType<typeof installFakeApi>

beforeEach(async () => {
  fake = installFakeApi()
  useApp.setState({ ...initial }, true)
  fake.saved.set('test', sprint({ queryUrl: QUERY, items: [item(1)] }))
  fake.setSettings({ activeSprintId: 'test' })
})

const toolbar = () => document.querySelector('.toolbar') as HTMLElement
const refreshButton = () => within(toolbar()).getByRole('button', { name: 'Refresh' })

describe('a refresh that fails', () => {
  it('shows a ⚠ that opens the full details, and Copy details copies them', async () => {
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: false, message: MESSAGE, detail })
    render(<App />)
    await screen.findByText('Diogo')
    const user = userEvent.setup()
    // After setup, which puts a clipboard of its own on the navigator.
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(screen.queryByRole('button', { name: 'Why the refresh failed' })).not.toBeInTheDocument()

    await user.click(refreshButton())
    expect(await within(toolbar()).findByText(/refresh failed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Why the refresh failed' }))

    const dialog = screen.getByRole('dialog', { name: 'Refresh failed' })
    expect(within(dialog).getByText(MESSAGE)).toBeInTheDocument()
    expect(within(dialog).getByText('Running the query')).toBeInTheDocument()
    expect(within(dialog).getByText(QUERY)).toBeInTheDocument()
    expect(within(dialog).getByText('404 Not Found')).toBeInTheDocument()
    expect(within(dialog).getByText('<html>Page not found</html>')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy details' }))
    expect(writeText).toHaveBeenCalledWith(failureReport(MESSAGE, detail))
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied.')
  })

  it('without details, the dialog still gives the message', async () => {
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: false, message: 'Offline.' })
    render(<App />)
    await screen.findByText('Diogo')
    const user = userEvent.setup()
    await user.click(refreshButton())
    await user.click(await screen.findByRole('button', { name: 'Why the refresh failed' }))
    const dialog = screen.getByRole('dialog', { name: 'Refresh failed' })
    expect(within(dialog).getByText('Offline.')).toBeInTheDocument()
    expect(within(dialog).getByText(/no further details/)).toBeInTheDocument()
  })

  it('a refresh that then works takes the ⚠ away', async () => {
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: false, message: 'Offline.' })
    render(<App />)
    await screen.findByText('Diogo')
    const user = userEvent.setup()
    await user.click(refreshButton())
    await screen.findByRole('button', { name: 'Why the refresh failed' })
    await user.click(refreshButton())
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Why the refresh failed' })
      ).not.toBeInTheDocument()
    )
  })
})
