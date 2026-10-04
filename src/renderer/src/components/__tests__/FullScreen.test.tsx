import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../../App'
import { useApp } from '../../store'
import { item, MON, sprint } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** Full screen: the window fills the screen and only the calendar shows. */

const initial = useApp.getState()
let fake: ReturnType<typeof installFakeApi>

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState({ ...initial, today: MON }, true)
  fake.saved.set('test', sprint({ items: [item(1)] }))
  fake.setSettings({ activeSprintId: 'test' })
})

const app = () => document.querySelector('.app') as HTMLElement
const open = async () => {
  render(<App />)
  await screen.findByText('Diogo')
  return userEvent.setup()
}

describe('full screen', () => {
  it('the corner button asks the window, and the calendar view follows it', async () => {
    const user = await open()
    expect(app()).not.toHaveClass('is-full-screen')
    await user.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(fake.api.setFullScreen).toHaveBeenLastCalledWith(true)
    expect(app()).toHaveClass('is-full-screen')

    // The same button, now pressed, leaves.
    await user.click(screen.getByRole('button', { name: 'Leave full screen' }))
    expect(fake.api.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(app()).not.toHaveClass('is-full-screen')
  })

  it('Esc leaves — but a dialog open on top closes first, and full screen stays', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Full screen' }))
    useApp.getState().openDialog('help')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(app()).toHaveClass('is-full-screen')

    await user.keyboard('{Escape}')
    expect(app()).not.toHaveClass('is-full-screen')
  })

  it('the window entering or leaving by itself (F11, Windows) is followed', async () => {
    await open()
    fake.tellFullScreen(true)
    expect(await screen.findByRole('button', { name: 'Leave full screen' })).toBeInTheDocument()
    expect(app()).toHaveClass('is-full-screen')
    fake.tellFullScreen(false)
    expect(await screen.findByRole('button', { name: 'Full screen' })).toBeInTheDocument()
  })

  it('in a browser, with no window to ask, F11 and the button change only the view', async () => {
    ;(window as unknown as { api?: unknown }).api = undefined
    useApp.setState({ sprint: sprint({ items: [item(1)] }), loading: false })
    render(<App />)
    const user = userEvent.setup()
    await user.keyboard('{F11}')
    expect(app()).toHaveClass('is-full-screen')
    await user.keyboard('{F11}')
    expect(app()).not.toHaveClass('is-full-screen')
  })
})
