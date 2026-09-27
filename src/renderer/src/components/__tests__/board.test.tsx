import { DndContext } from '@dnd-kit/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import SidePanel from '../panel/SidePanel'
import SprintGrid from '../SprintGrid'
import { useApp } from '../../store'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import { block, item, MON, sprint, WED } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** The calendar and the side panel, rendered from a small sprint. */

const initial = useApp.getState()

const board = (): Sprint =>
  sprint({
    items: [
      item(900, { type: 'User Story', title: 'Export' }),
      item(1, {
        title: 'DEV:: Build',
        parentId: 900,
        remainingWork: 4,
        assignedTo: 'Diogo Mesquita'
      }),
      item(2, {
        title: 'VAL:: Check',
        parentId: 900,
        remainingWork: 2,
        assignedTo: 'Sofia Marques'
      }),
      item(3, { title: 'Nobody’s', parentId: 900, remainingWork: 3 }),
      item(4, { title: 'Outsider’s', parentId: 900, remainingWork: 1, assignedTo: 'Rui Costa' })
    ],
    queues: { diogo: [block('a', 1, 4)] },
    backlog: [block('b', 2, 2), block('c', 3, 3), block('d', 4, 1)]
  })

const inDnd = (node: ReactNode) => render(<DndContext>{node}</DndContext>)

let fake: ReturnType<typeof installFakeApi>

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState({ ...initial, sprint: board(), loading: false, today: MON }, true)
})

describe('SidePanel', () => {
  const panel = () =>
    inDnd(
      <SidePanel
        layouts={layoutSprint(useApp.getState().sprint!, MON)}
        onBlockContextMenu={() => {}}
        onGroupContextMenu={() => {}}
      />
    )

  it('groups the backlog under its story', () => {
    panel()
    expect(screen.getByText('Export')).toBeInTheDocument()
    expect(document.querySelectorAll('.task-card')).toHaveLength(3)
  })

  it('done hours waiting in the backlog are a card of their own, with a red dot', () => {
    // VAL has 2h remaining and 3h done; its done hours were kept in the backlog.
    const s = board()
    useApp.setState({
      sprint: {
        ...s,
        workItems: { ...s.workItems, 2: { ...s.workItems[2], completedWork: 3 } },
        doneInBacklog: [2]
      }
    })
    panel()
    const cards = [...document.querySelectorAll('.task-card')]
    expect(cards).toHaveLength(4)
    const done = document.querySelectorAll('.task-card.is-done-card')
    expect(done).toHaveLength(1)
    expect(done[0].querySelector('.done-dot')).not.toBeNull()
    expect(done[0]).toHaveTextContent('VAL:: Check')
    expect(done[0]).toHaveTextContent('3h done')
    // The remaining hours are still their own, ordinary card.
    const val = cards.filter((c) => c.textContent?.includes('VAL:: Check'))
    expect(val.map((c) => c.classList.contains('is-done-card'))).toEqual([false, true])
  })

  it('cards owned by nobody on the squad are marked, and say why', () => {
    panel()
    const outsiders = [...document.querySelectorAll('.task-card.is-outsider')].map((c) =>
      c.getAttribute('title')
    )
    expect(outsiders).toEqual([
      'Nobody is assigned to it in TFS',
      'Assigned to Rui Costa, who is not on this squad'
    ])
  })

  it('the search box filters the cards', async () => {
    panel()
    await userEvent.setup().type(screen.getByLabelText('Filter the backlog'), 'check')
    expect(document.querySelectorAll('.task-card')).toHaveLength(1)
  })

  it('the Task tab waits for a selection, then describes the task and acts on it', async () => {
    panel()
    expect(screen.getByRole('button', { name: 'Task' })).toBeDisabled()
    useApp.getState().selectTask(1, 'a')
    const user = userEvent.setup()
    expect(await screen.findByText('DEV:: Build')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set hours…' }))
    expect(useApp.getState()).toMatchObject({ dialog: 'hours', hoursTarget: 1 })
    await user.click(screen.getByRole('button', { name: 'Return to backlog' }))
    expect(useApp.getState().sprint!.queues.diogo).toEqual([])
  })
})

describe('SprintGrid', () => {
  const grid = (props: Partial<Parameters<typeof SprintGrid>[0]> = {}) =>
    inDnd(
      <SprintGrid
        layouts={layoutSprint(useApp.getState().sprint!, MON)}
        anchor={MON}
        onDayContextMenu={() => {}}
        onBlockContextMenu={() => {}}
        onMemberContextMenu={() => {}}
        {...props}
      />
    )

  it('a row per person, a column per day, a block per piece of work', () => {
    grid()
    expect(screen.getByText('Diogo')).toBeInTheDocument()
    expect(screen.getByText('Sofia')).toBeInTheDocument()
    expect(screen.getByText('Mon 14/09')).toBeInTheDocument()
    const segs = document.querySelectorAll('.seg')
    expect(segs).toHaveLength(1)
    expect(segs[0].getAttribute('title')).toMatch(/^#1 DEV:: Build — 4h/)
  })

  it('a click (not a drag) selects the task', () => {
    const onSelectTask = vi.fn()
    grid({ onSelectTask })
    const seg = document.querySelector('.seg')!
    fireEvent.pointerDown(seg, { clientX: 10, clientY: 10 })
    fireEvent.click(seg, { clientX: 11, clientY: 10 })
    expect(onSelectTask).toHaveBeenCalledWith(1, 'a')
    fireEvent.pointerDown(seg, { clientX: 10, clientY: 10 })
    fireEvent.click(seg, { clientX: 60, clientY: 10 }) // moved: that was a drag
    expect(onSelectTask).toHaveBeenCalledTimes(1)
  })

  it('a warning is shown on the block and in its tooltip', () => {
    grid({ warnings: new Map([['a', 'Starts before its DEV work ends']]) })
    const seg = document.querySelector('.seg')!
    expect(seg).toHaveClass('has-warning')
    expect(seg.getAttribute('title')).toMatch(/^⚠ Starts before its DEV work ends/)
  })

  it('reported hours are drawn as done', () => {
    useApp.setState({
      sprint: {
        ...board(),
        workItems: {
          ...board().workItems,
          1: item(1, { title: 'DEV:: Build', remainingWork: 4, completedWork: 3 })
        }
      }
    })
    grid({ layouts: layoutSprint(useApp.getState().sprint!, WED), anchor: WED })
    const done = document.querySelectorAll('.seg.is-done')
    expect(done.length).toBeGreaterThan(0)
    expect(done[0].getAttribute('title')).toMatch(/Reported in TFS as done/)
  })

  it('the lock on a day header locks and unlocks it', async () => {
    const onLockDay = vi.fn()
    grid({ onLockDay })
    await userEvent.setup().click(screen.getAllByTitle('Lock day — prevent new drops')[0])
    expect(onLockDay).toHaveBeenCalledWith(MON)
  })

  it('the zoom control steps the hour width and shows the percentage', async () => {
    grid()
    const user = userEvent.setup()
    expect(screen.getByText('100%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})

describe('App', () => {
  it('opens on the empty state, loads the sample, and shows the board', async () => {
    useApp.setState({ ...initial, loading: false }, true)
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Load sample data' }))
    expect(document.querySelectorAll('.seg').length).toBeGreaterThan(0)
    expect(screen.getByText('Sample data')).toBeInTheDocument()
  })

  it('Escape closes a dialog; Ctrl+Z undoes the last change', async () => {
    // The app loads the active sprint on start, so the board has to be the saved one.
    fake.saved.set('test', board())
    fake.setSettings({ activeSprintId: 'test' })
    render(<App />)
    await screen.findByText('Diogo')
    const user = userEvent.setup()
    useApp.getState().openDialog('help')
    expect(await screen.findByRole('dialog', { name: /Read me/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    useApp.getState().moveBlock('b', { kind: 'member', memberId: 'sofia' }, 0)
    expect(useApp.getState().sprint!.queues.sofia).toHaveLength(1)
    await user.keyboard('{Control>}z{/Control}')
    expect(useApp.getState().sprint!.queues.sofia).toHaveLength(0)
  })

  it('the empty state offers the Read me', async () => {
    useApp.setState({ ...initial, loading: false }, true)
    render(<App />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Read me' }))
    expect(
      within(screen.getByRole('dialog')).getByText('What this app is', { selector: 'h3' })
    ).toBeInTheDocument()
  })
})
