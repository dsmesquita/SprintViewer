import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import CalendarExportDialog from '../CalendarExportDialog'
import { useApp } from '../../store'
import { block, item, sprint, WED } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** Exporting one or more people's calendars as plain boards. */

const initial = useApp.getState()
let fake: ReturnType<typeof installFakeApi>

const open = (memberIds: string[]) => {
  useApp.setState({ dialog: 'export-calendar', exportMembers: memberIds })
  return render(<CalendarExportDialog />)
}

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState(
    {
      ...initial,
      loading: false,
      today: WED,
      sprint: sprint({
        name: 'Sprint 24.09',
        items: [
          item(1, { title: 'DEV:: Export', remainingWork: 4 }),
          item(2, { title: 'Meetings', remainingWork: 1 }),
          item(3, { title: 'VAL:: Export', remainingWork: 2 })
        ],
        queues: {
          diogo: [block('m', 2, 1, { date: WED, startHour: 0 }), block('a', 1, 4)],
          sofia: [block('v', 3, 2)]
        }
      })
    },
    true
  )
})

describe('CalendarExportDialog', () => {
  it('previews one person\u2019s board: a row per day, meetings left out', () => {
    open(['diogo'])
    expect(screen.getByRole('dialog', { name: "Export Diogo's calendar" })).toBeInTheDocument()
    const wednesday = screen.getByText('Wed 16/09').closest('tr')!
    expect(within(wednesday).getByText('#1 (DEV)')).toBeInTheDocument()
  })

  it('Show meetings puts them in', async () => {
    open(['diogo'])
    await userEvent.setup().click(screen.getByLabelText('Show meetings'))
    const wednesday = screen.getByText('Wed 16/09').closest('tr')!
    expect(within(wednesday).getByText('#2 (Meeting) / #1 (DEV)')).toBeInTheDocument()
  })

  it('several people: a board each, and a file each', async () => {
    open(['diogo', 'sofia'])
    expect(screen.getByRole('dialog', { name: 'Export 2 calendars' })).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(2)

    fake.api.exportCalendar.mockResolvedValueOnce({
      ok: true,
      value: ['C:/out/Sprint 24.09 - Diogo.md', 'C:/out/Sprint 24.09 - Sofia.md']
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export as Markdown' }))
    const files = fake.api.exportCalendar.mock.calls[0][0]
    expect(files.map((f) => [f.name, f.kind])).toEqual([
      ['Sprint 24.09 - Diogo', 'md'],
      ['Sprint 24.09 - Sofia', 'md']
    ])
    expect(files[1].content).toContain('| Wed 16/09 | #3 (VAL) |')
    expect(await screen.findByText('Saved 2 files in C:/out')).toBeInTheDocument()
  })
})
