import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import CreateTasksDialog from '../CreateTasksDialog'
import { useApp } from '../../store'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { DIOGO, item, SOFIA, sprint } from '../../../../../test/fixtures'
import { installFakeApi } from '../../../../../test/fakeApi'

/** What the Create Tasks dialog asks TFS for, in each of its shapes. */

const QUERY =
  'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
let fake: ReturnType<typeof installFakeApi>

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState({
    sprint: {
      ...sprint({
        items: [
          item(1, {
            type: 'User Story',
            title: 'Export',
            assignedTo: 'Diogo Mesquita',
            tfsTags: ['Squad A', 'Release 24.10']
          })
        ]
      }),
      queryUrl: QUERY
    },
    settings: {
      ...DEFAULT_SETTINGS,
      members: [DIOGO, SOFIA],
      docOwner: 'CMF\\bsrocha',
      qaOwner: 'sofia'
    },
    createTasksParent: 1,
    dialog: 'create-tasks'
  })
})

const drafts = () => fake.api.createTasks.mock.calls.at(-1)?.[2]
const create = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /^(Create|Retry) \d+ tasks?$/ }))

describe('CreateTasksDialog', () => {
  it('a single task starts from the parent: its title, its owner, its tags', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    expect(screen.getByText('Squad A')).toBeInTheDocument()
    await create(user)
    expect(fake.api.createTasks).toHaveBeenCalledWith(QUERY, 1, [
      { title: 'Export', assignedTo: 'Diogo Mesquita', estimate: 0, tags: undefined }
    ])
  })

  it('a template adds one task per prefix', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.selectOptions(screen.getByLabelText('Apply template'), '0')
    await create(user)
    expect(drafts()?.map((d: { title: string }) => d.title)).toEqual([
      'DEV:: Export',
      'VAL:: Export'
    ])
  })

  it('DOC and QA go to the owners chosen in Settings — on the team or not', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.click(screen.getByRole('button', { name: '+ DOC task' }))
    await user.click(screen.getByRole('button', { name: '+ QA task' }))
    expect(screen.getByText('→ CMF\\bsrocha')).toBeInTheDocument()
    await create(user)
    expect(
      drafts()?.map((d: { title: string; assignedTo?: string }) => [d.title, d.assignedTo])
    ).toEqual([
      ['DOC:: Export', 'CMF\\bsrocha'],
      ['QA:: Export', 'Sofia Marques']
    ])
  })

  it('a sprint with its own owners and templates uses them, not the app’s', async () => {
    const s = useApp.getState().sprint!
    useApp.setState({
      sprint: {
        ...s,
        docOwner: '',
        qaOwner: 'diogo',
        taskTemplates: [{ name: 'Docs', prefixes: ['DOC'] }]
      }
    })
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.selectOptions(screen.getByLabelText('Apply template'), '0')
    await user.click(screen.getByRole('button', { name: '+ DOC task' }))
    await user.click(screen.getByRole('button', { name: '+ QA task' }))
    await create(user)
    expect(
      drafts()?.map((d: { title: string; assignedTo?: string }) => [d.title, d.assignedTo])
    ).toEqual([
      ['DOC:: Export', undefined],
      ['DOC:: Export', undefined],
      ['QA:: Export', 'Diogo Mesquita']
    ])
  })

  it('custom tags replace the parent’s on every task', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.click(screen.getByRole('button', { name: 'Custom tags' }))
    const field = screen.getByLabelText('Custom tags')
    await user.clear(field)
    await user.type(field, 'Docs; Release, docs')
    await create(user)
    expect(drafts()?.[0].tags).toEqual(['Docs', 'Release'])
  })

  it('custom tags left empty means no tags at all', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.click(screen.getByRole('button', { name: 'Custom tags' }))
    await user.clear(screen.getByLabelText('Custom tags'))
    expect(screen.getByText(/will have none/)).toBeInTheDocument()
    await create(user)
    expect(drafts()?.[0].tags).toEqual([])
  })

  it('someone off the team needs a real account name before Create is allowed', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.selectOptions(screen.getByLabelText('Owner'), '__other__')
    const createButton = screen.getByRole('button', { name: 'Create 1 task' })
    expect(createButton).toBeDisabled()
    await user.type(screen.getByLabelText('TFS account'), 'Beatriz Rocha')
    expect(screen.getByText('Not an account name')).toBeInTheDocument()
    expect(createButton).toBeDisabled()
    await user.clear(screen.getByLabelText('TFS account'))
    await user.type(screen.getByLabelText('TFS account'), 'bsrocha')
    expect(createButton).toBeEnabled()
    await create(user)
    expect(drafts()?.[0].assignedTo).toBe('CMF\\bsrocha')
  })

  it('the same task for the whole team, minus anyone unticked', async () => {
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.click(screen.getByRole('button', { name: 'Same task for the whole team' }))
    await user.click(screen.getByRole('checkbox', { name: 'Sofia' }))
    await create(user)
    expect(drafts()).toEqual([
      { title: 'Export', assignedTo: 'Diogo Mesquita', estimate: 0, tags: undefined }
    ])
  })

  it('when TFS refuses some, only those are offered again, with the reason', async () => {
    fake.api.createTasks.mockResolvedValueOnce({
      ok: true,
      value: {
        created: [item(90, { title: 'DEV:: Export', remainingWork: 0 })],
        failures: [{ index: 1, title: 'VAL:: Export', message: 'Rule broken' }]
      }
    } as never)
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await user.selectOptions(screen.getByLabelText('Apply template'), '0')
    await create(user)
    const alert = screen.getByText(/TFS refused/).closest('.message') as HTMLElement
    expect(within(alert).getByText('VAL:: Export')).toBeInTheDocument()
    expect(within(alert).getByText(/Rule broken/)).toBeInTheDocument()
    expect(
      screen.getAllByLabelText('Task title').map((i) => (i as HTMLInputElement).value)
    ).toEqual(['VAL:: Export'])
    expect(screen.getByRole('button', { name: 'Retry 1 task' })).toBeInTheDocument()
    // What did go through is already in the backlog.
    expect(useApp.getState().sprint!.backlog.map((b) => b.workItemId)).toEqual([90])
  })

  it('a request that fails outright shows the message and keeps the form', async () => {
    fake.api.createTasks.mockResolvedValueOnce({
      ok: false,
      message: 'No permission to create'
    } as never)
    const user = userEvent.setup()
    render(<CreateTasksDialog />)
    await create(user)
    expect(screen.getByText('No permission to create')).toBeInTheDocument()
    expect(screen.getByLabelText('Task title')).toHaveValue('Export')
  })
})
