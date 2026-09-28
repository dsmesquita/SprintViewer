import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import SettingsDialog from '../SettingsDialog'
import SquadSync from '../SquadSync'
import { useApp } from '../../store'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { DIOGO, SOFIA, sprint } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

const QUERY =
  'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
let fake: ReturnType<typeof installFakeApi>

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState({
    sprint: sprint(),
    isSample: false,
    dialog: 'settings',
    settings: {
      ...DEFAULT_SETTINGS,
      lastQueryUrl: QUERY,
      members: [DIOGO, SOFIA],
      docOwner: 'CMF\\bsrocha',
      qaOwner: 'sofia'
    }
  })
})

const saved = () => fake.api.updateSettings.mock.calls.at(-1)![0]
const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save' }))

describe('SettingsDialog', () => {
  it('shows a saved outside owner as "Someone else…" with the account', () => {
    render(<SettingsDialog />)
    expect(screen.getByLabelText('DOC tasks go to')).toHaveValue('__other__')
    expect(screen.getByLabelText('DOC tasks go to — TFS account')).toHaveValue('CMF\\bsrocha')
    expect(screen.getByLabelText('QA tasks go to')).toHaveValue('sofia')
  })

  it('saves an outside owner normalised, and says what it will save as', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await user.selectOptions(screen.getByLabelText('QA tasks go to'), '__other__')
    const field = screen.getByLabelText('QA tasks go to — TFS account')
    await user.type(field, '<cmf\\jdoe>')
    expect(screen.getByText('Saved as CMF\\jdoe')).toBeInTheDocument()
    await save(user)
    expect(saved()).toMatchObject({ docOwner: 'CMF\\bsrocha', qaOwner: 'CMF\\jdoe' })
  })

  it('an owner who is removed from the roster is cleared on save', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    const rows = screen.getAllByRole('button', { name: 'Remove' })
    await user.click(rows[1]) // Sofia
    await save(user)
    expect(saved()).toMatchObject({ qaOwner: '' })
    expect(saved().members?.map((m) => m.name)).toEqual(['Diogo'])
  })

  it('templates are split into prefixes; unnamed ones are dropped', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await user.click(screen.getByRole('button', { name: 'Add template' }))
    const names = screen.getAllByLabelText('Template name')
    const prefixes = screen.getAllByLabelText('Template prefixes')
    await user.type(names[1], 'Docs')
    await user.type(prefixes[1], 'DOC, , QA ')
    await user.click(screen.getByRole('button', { name: 'Add template' })) // left blank
    await save(user)
    expect(saved().taskTemplates).toEqual([
      { name: 'DEV + VAL', prefixes: ['DEV', 'VAL'] },
      { name: 'Docs', prefixes: ['DOC', 'QA'] }
    ])
  })

  it('a new working-day length rescales the open sprint too', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    // Set directly: clearing the field snaps it back to 8, so typing would give "86".
    fireEvent.change(screen.getByLabelText('Hours in a working day'), { target: { value: '6' } })
    await save(user)
    expect(saved().hoursPerDay).toBe(6)
    expect(useApp.getState().sprint!.hoursPerDay).toBe(6)
  })

  it('the URL is the open sprint’s: changing it and saving is what Refresh reads next', async () => {
    const OLD = QUERY.replace('5555', '0000')
    const NEW = QUERY
    useApp.setState({ sprint: sprint({ queryUrl: OLD }), settings: { ...DEFAULT_SETTINGS } })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    const field = screen.getByLabelText('Query or sprint URL')
    // It shows the sprint's URL, not whatever the last new sprint started from.
    expect(field).toHaveValue(OLD)
    expect(screen.getByText(/Refresh reads “Test sprint” from this URL/)).toBeInTheDocument()

    fireEvent.change(field, { target: { value: ` ${NEW} ` } })
    await save(user)
    expect(useApp.getState().sprint!.queryUrl).toBe(NEW)
    expect(saved().lastQueryUrl).toBe(NEW)

    await useApp.getState().refresh()
    expect(fake.api.refreshSprint).toHaveBeenLastCalledWith(NEW)
  })

  it('with no sprint open, the URL is only where new sprints start from', async () => {
    useApp.setState({ sprint: null })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    expect(screen.getByLabelText('Query or sprint URL')).toHaveValue(QUERY)
    expect(screen.getByText('New sprints start from this URL.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Query or sprint URL'), {
      target: { value: 'https://tfs.example/other' }
    })
    await save(user)
    expect(saved().lastQueryUrl).toBe('https://tfs.example/other')
  })

  it('Read me opens in place of Settings, and closing it comes back with edits intact', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    fireEvent.change(screen.getByLabelText('Hours in a working day'), { target: { value: '7' } })
    await user.click(screen.getByRole('button', { name: 'Read me' }))
    expect(screen.getByRole('dialog', { name: /Read me/ })).toBeInTheDocument()
    await user.click(screen.getByText('Close', { selector: 'button' }))
    expect(screen.getByLabelText('Hours in a working day')).toHaveValue(7)
  })
})

describe('SquadSync', () => {
  const people = [
    { id: 'p1', displayName: 'Diogo Mesquita', uniqueName: 'CMF\\dmesquita' },
    { id: 'p2', displayName: 'Nuno Reis', uniqueName: 'CMF\\nreis' }
  ]
  const roster = [
    { id: 'a', name: 'Diogo Mesquita', order: 0 },
    { id: 'b', name: 'Ana Lopes', order: 1 },
    { id: 'c', name: 'Rui Costa', order: 2 }
  ]

  beforeEach(() => {
    fake.api.listTeams.mockResolvedValue({
      ok: true,
      value: { teams: [{ id: 't', name: 'Squad A' }], suggested: 't' }
    } as never)
    fake.api.teamMembers.mockResolvedValue({ ok: true, value: people } as never)
  })

  it('proposes links, additions and removals, and Unselect all marks every outsider for removal', async () => {
    const user = userEvent.setup()
    let applied: unknown = null
    render(
      <SquadSync
        url={QUERY}
        roster={roster}
        onApply={(next) => (applied = next)}
        onClose={() => {}}
      />
    )
    await screen.findByText('On the roster, not on this team — untick to remove')
    // Linking Diogo and adding Nuno are ticked by default; keeping people is not a change.
    expect(screen.getByText('2 changes')).toBeInTheDocument()

    const outsiders = screen.getByText(/not on this team/).closest('.sync-section') as HTMLElement
    await user.click(within(outsiders).getByRole('button', { name: 'Unselect all' }))
    expect(
      within(outsiders)
        .getAllByRole('checkbox')
        .every((c) => !(c as HTMLInputElement).checked)
    ).toBe(true)
    expect(screen.getByText('4 changes')).toBeInTheDocument()
    expect(within(outsiders).getByRole('button', { name: 'Select all' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply to roster' }))
    const names = (applied as Array<{ name: string }>).map((m) => m.name)
    expect(names).toContain('Diogo Mesquita')
    expect(names).toContain('Nuno Reis')
    expect(names).not.toContain('Ana Lopes')
    expect(names).not.toContain('Rui Costa')
  })

  it('says what is wrong when there is no URL to read the project from', async () => {
    render(<SquadSync url="" roster={roster} onApply={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/Enter a query or sprint URL/)).toBeInTheDocument())
  })
})
