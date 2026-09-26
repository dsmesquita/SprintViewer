import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RefreshHoursDialog from '../RefreshHoursDialog'
import { useApp } from '../../store'
import { sprint } from '../../../../../test/fixtures'

/** When a refresh disagrees with hours set by hand, the user decides task by task. */

const resolve = vi.fn()
const cancel = vi.fn()

beforeEach(() => {
  resolve.mockReset()
  cancel.mockReset()
  useApp.setState({
    resolveRefresh: resolve,
    cancelRefresh: cancel,
    pendingRefresh: {
      sprint: sprint(),
      text: '2 updated',
      conflicts: [
        { workItemId: 1, title: 'Export', yours: 10, theirs: 6 },
        { workItemId: 2, title: 'Import', yours: 4, theirs: 8 }
      ]
    }
  })
})

const choicesPassed = () => Object.fromEntries(resolve.mock.calls[0][0] as Map<number, unknown>)

describe('RefreshHoursDialog', () => {
  it('nothing chosen keeps every manual time', async () => {
    const user = userEvent.setup()
    render(<RefreshHoursDialog />)
    expect(screen.getByText(/2 tasks have/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(choicesPassed()).toEqual({})
  })

  it('one choice per task: keep, take TFS, or type a number', async () => {
    const user = userEvent.setup()
    render(<RefreshHoursDialog />)
    await user.click(screen.getByRole('button', { name: /^Use 6/ }))
    const field = screen.getByLabelText('Hours for 2')
    await user.clear(field)
    await user.type(field, '5.5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(choicesPassed()).toEqual({ 1: { kind: 'theirs' }, 2: { kind: 'set', hours: 5.5 } })
  })

  it('apply to all', async () => {
    const user = userEvent.setup()
    render(<RefreshHoursDialog />)
    await user.click(screen.getByRole('button', { name: 'Use TFS' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(choicesPassed()).toEqual({ 1: { kind: 'theirs' }, 2: { kind: 'theirs' } })
  })

  it('cancelling abandons the whole refresh', async () => {
    const user = userEvent.setup()
    render(<RefreshHoursDialog />)
    await user.click(screen.getByRole('button', { name: 'Cancel the refresh' }))
    expect(cancel).toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('renders nothing when no refresh is waiting', () => {
    useApp.setState({ pendingRefresh: null })
    const { container } = render(<RefreshHoursDialog />)
    expect(container).toBeEmptyDOMElement()
  })
})
