import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import SettingsDialog from '../SettingsDialog'
import SquadSync from '../SquadSync'
import { useApp } from '../../store'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { block, DIOGO, item, MON, SOFIA, sprint } from '../../../../../test/fixtures'
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

const appTab = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('tab', { name: 'App & new sprints' }))

describe('Settings: the app and new sprints', () => {
  it('opens on the sprint when one is open; on the app, with no tabs, when none is', () => {
    const first = render(<SettingsDialog />)
    expect(screen.getByRole('tab', { name: 'This sprint' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    first.unmount()
    useApp.setState({ sprint: null })
    render(<SettingsDialog />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('Start sprint begins from this URL.')).toBeInTheDocument()
    expect(screen.getByLabelText('Query or sprint URL')).toHaveValue(QUERY)
  })

  it('sample data has no settings of its own: only the app tab', () => {
    useApp.setState({ isSample: true })
    render(<SettingsDialog />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('Authentication')).toBeInTheDocument()
  })

  it('shows a saved outside owner as "Someone else…" with the account', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
    expect(screen.getByLabelText('DOC tasks go to')).toHaveValue('__other__')
    expect(screen.getByLabelText('DOC tasks go to — TFS account')).toHaveValue('CMF\\bsrocha')
    expect(screen.getByLabelText('QA tasks go to')).toHaveValue('sofia')
  })

  it('saves an outside owner normalised, and says what it will save as', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
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
    await appTab(user)
    const rows = screen.getAllByRole('button', { name: 'Remove' })
    await user.click(rows[1]) // Sofia
    await save(user)
    expect(saved()).toMatchObject({ qaOwner: '' })
    expect(saved().members?.map((m) => m.name)).toEqual(['Diogo'])
    // The roster is only the default: the open sprint keeps its rows.
    expect(useApp.getState().sprint!.members.map((m) => m.name)).toEqual(['Diogo', 'Sofia'])
  })

  it('templates are split into prefixes; unnamed ones are dropped', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
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

  it('the default working day is for new sprints: the open one keeps its own', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
    expect(screen.getByText('New sprints start with this many hours a day.')).toBeInTheDocument()
    // Set directly: clearing the field snaps it back to 8, so typing would give "86".
    fireEvent.change(screen.getByLabelText('Hours in a working day'), { target: { value: '6' } })
    await save(user)
    expect(saved().hoursPerDay).toBe(6)
    expect(useApp.getState().sprint!.hoursPerDay).toBe(8)
  })

  it('the URL is where Start sprint begins; saving it leaves the open sprint alone', async () => {
    useApp.setState({ sprint: sprint({ queryUrl: QUERY }) })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
    fireEvent.change(screen.getByLabelText('Query or sprint URL'), {
      target: { value: 'https://tfs.example/other' }
    })
    await save(user)
    expect(saved().lastQueryUrl).toBe('https://tfs.example/other')
    expect(useApp.getState().sprint!.queryUrl).toBe(QUERY)
  })

  it('"Use this sprint’s settings as defaults" fills the app tab from the sprint', async () => {
    useApp.setState({
      sprint: {
        ...sprint({ queryUrl: 'https://tfs.example/sprint', hoursPerDay: 6, members: [DIOGO] }),
        childQueryMode: 'never',
        docOwner: 'diogo',
        qaOwner: '',
        taskTemplates: [{ name: 'Solo', prefixes: ['DEV'] }]
      }
    })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await appTab(user)
    await user.click(screen.getByRole('button', { name: 'Use this sprint’s settings as defaults' }))
    expect(screen.getByText(/Filled in from Test sprint/)).toBeInTheDocument()
    await save(user)
    expect(saved()).toMatchObject({
      lastQueryUrl: 'https://tfs.example/sprint',
      hoursPerDay: 6,
      childQueryMode: 'never',
      docOwner: 'diogo',
      qaOwner: '',
      taskTemplates: [{ name: 'Solo', prefixes: ['DEV'] }]
    })
    expect(saved().members?.map((m) => m.name)).toEqual(['Diogo'])
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

describe('Settings: this sprint', () => {
  const OLD = QUERY.replace('5555', '0000')
  const NEW = QUERY.replace('5555', '9999')

  it('starts from the sprint’s own settings; an old sprint borrows the app’s it lacks', () => {
    useApp.setState({ sprint: sprint({ queryUrl: OLD, hoursPerDay: 6 }) })
    render(<SettingsDialog />)
    expect(screen.getByLabelText('Sprint name')).toHaveValue('Test sprint')
    expect(screen.getByLabelText('Query or sprint URL')).toHaveValue(OLD)
    expect(screen.getByLabelText('Hours in a working day')).toHaveValue(6)
    // Nothing of its own for owners yet: the app's.
    expect(screen.getByLabelText('QA tasks go to')).toHaveValue('sofia')
  })

  it('a new URL is what Refresh reads next; the app default is untouched', async () => {
    useApp.setState({ sprint: sprint({ queryUrl: OLD }) })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    expect(screen.getByText(/Refresh reads this sprint from here/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Query or sprint URL'), {
      target: { value: ` ${NEW} ` }
    })
    await save(user)
    expect(useApp.getState().sprint!.queryUrl).toBe(NEW)
    expect(saved().lastQueryUrl).toBe(QUERY)

    await useApp.getState().refresh()
    expect(fake.api.refreshSprint).toHaveBeenLastCalledWith(NEW, 'auto')
  })

  it('renames it, rescales its day, and keeps its own owners, templates and child mode', async () => {
    const user = userEvent.setup()
    render(<SettingsDialog />)
    fireEvent.change(screen.getByLabelText('Sprint name'), { target: { value: 'Sprint 42' } })
    fireEvent.change(screen.getByLabelText('Hours in a working day'), { target: { value: '6' } })
    expect(screen.getByText(/Saving rescales/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('QA tasks go to'), 'diogo')
    await user.selectOptions(screen.getByLabelText('Fetch child tasks'), 'always')
    await user.click(screen.getByRole('button', { name: 'Remove template' }))
    await save(user)

    expect(useApp.getState().sprint!).toMatchObject({
      name: 'Sprint 42',
      hoursPerDay: 6,
      qaOwner: 'diogo',
      docOwner: 'CMF\\bsrocha',
      childQueryMode: 'always',
      taskTemplates: []
    })
    // The app's defaults are as they were.
    expect(saved()).toMatchObject({ hoursPerDay: 8, qaOwner: 'sofia', childQueryMode: 'auto' })
    // All of it is one step back.
    expect(useApp.getState().undoStack.at(-1)?.label).toBe('sprint settings')
  })

  it('taking someone off with work asks first; their tasks go to the backlog', async () => {
    useApp.setState({
      sprint: sprint({
        items: [item(1, { remainingWork: 4 }), item(2, { remainingWork: 2 })],
        queues: { sofia: [block('a', 1, 4, { date: MON, startHour: 0 }), block('b', 2, 2)] }
      })
    })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1]) // Sofia
    await save(user)
    expect(screen.getByText(/Saving takes Sofia \(2 tasks\) off this sprint/)).toBeInTheDocument()
    expect(fake.api.updateSettings).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Keep them' }))
    expect(screen.queryByText(/Saving takes Sofia/)).not.toBeInTheDocument()
    await save(user)
    await user.click(screen.getByRole('button', { name: 'Remove and save' }))

    const s = useApp.getState().sprint!
    expect(s.members.map((m) => m.name)).toEqual(['Diogo'])
    expect(s.queues.sofia).toBeUndefined()
    expect(s.backlog.map((b) => b.id)).toEqual(['a', 'b'])
    expect(s.backlog[0].pin).toBeUndefined()
    useApp.getState().undo()
    expect(useApp.getState().sprint!.queues.sofia).toHaveLength(2)
  })

  it('"Apply app settings to this sprint" fills the sprint tab from the app’s', async () => {
    useApp.setState({ sprint: sprint({ queryUrl: OLD, hoursPerDay: 6, members: [DIOGO] }) })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await user.click(screen.getByRole('button', { name: 'Apply app settings to this sprint' }))
    expect(screen.getByLabelText('Query or sprint URL')).toHaveValue(QUERY)
    expect(screen.getByLabelText('Hours in a working day')).toHaveValue(8)
    expect(screen.getByLabelText('Sprint name')).toHaveValue('Test sprint')
    await save(user)
    const s = useApp.getState().sprint!
    expect(s.members.map((m) => m.name)).toEqual(['Diogo', 'Sofia'])
    expect(s.queues.sofia).toEqual([])
    expect(s).toMatchObject({ queryUrl: QUERY, hoursPerDay: 8, qaOwner: 'sofia' })
  })

  it('Test connects, then runs the query, and says what it found', async () => {
    useApp.setState({ sprint: sprint({ queryUrl: QUERY }) })
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: true, value: [item(1), item(2)] })
    const user = userEvent.setup()
    render(<SettingsDialog />)
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Connected The query returns 2 work items.')).toBeInTheDocument()
    expect(fake.api.refreshSprint).toHaveBeenLastCalledWith(QUERY, 'auto')

    // Connecting is not enough: a query that no longer runs fails the test.
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: false, message: 'Query not found.' })
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(
      await screen.findByText('Connected But the query failed: Query not found.')
    ).toBeInTheDocument()
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
