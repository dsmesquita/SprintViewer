import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import DoneHoursDialog from '../DoneHoursDialog'
import { useApp } from '../../store'
import { block, item, MON, sprint } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** The question after a refresh: where do the done hours of backlog tasks go? */

const initial = useApp.getState()

beforeEach(() => {
  installFakeApi()
  useApp.setState(
    {
      ...initial,
      loading: false,
      today: MON,
      sprint: sprint({
        items: [
          item(7, {
            title: 'Export',
            remainingWork: 2,
            completedWork: 3,
            assignedTo: 'Diogo Mesquita'
          }),
          item(8, {
            title: 'Import',
            remainingWork: 1,
            completedWork: 2,
            assignedTo: 'Sofia Marques'
          })
        ],
        backlog: [block('a', 7, 2), block('b', 8, 1)]
      }),
      doneQuestion: [7, 8]
    },
    true
  )
})

describe('DoneHoursDialog', () => {
  it('lists the tasks with their done hours and owners', () => {
    render(<DoneHoursDialog ids={[7, 8]} />)
    expect(screen.getByText(/2 tasks in the backlog/)).toBeInTheDocument()
    expect(screen.getByText('5h')).toBeInTheDocument()
    expect(screen.getByText(/#7 Export — 3h · Diogo Mesquita/)).toBeInTheDocument()
    expect(screen.getByText(/#8 Import — 2h · Sofia Marques/)).toBeInTheDocument()
  })

  it('Keep in the backlog: both wait there as cards', async () => {
    render(<DoneHoursDialog ids={[7, 8]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Keep in the backlog' }))
    expect(useApp.getState().sprint!.doneInBacklog).toEqual([7, 8])
    expect(useApp.getState().doneQuestion).toBeNull()
  })

  it('Place on the calendar: both are drawn where they were worked', async () => {
    render(<DoneHoursDialog ids={[7, 8]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Place on the calendar' }))
    expect(useApp.getState().sprint!.doneInBacklog).toEqual([])
    expect(useApp.getState().sprint!.doneDecided).toEqual([7, 8])
  })

  it('closed without answering: nothing is decided', async () => {
    render(<DoneHoursDialog ids={[7, 8]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(useApp.getState().doneQuestion).toBeNull()
    expect(useApp.getState().sprint!.doneDecided).toBeUndefined()
  })
})
