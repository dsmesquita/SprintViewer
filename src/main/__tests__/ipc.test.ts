import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerIpc } from '../ipc'
import { item, sprint } from '../../../test/fixtures'
import {
  dialog,
  invoke,
  json,
  requests,
  setSavePath,
  setServer,
  userData
} from '../../../test/electron'
import type { AppSettings } from '@shared/settings'
import type { Result } from '@shared/ipc'
import type { Sprint } from '@shared/types'

/** The routes the renderer calls, with the validation between it and the main process. */

const QUERY =
  'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'

beforeAll(async () => {
  registerIpc()
  await invoke('settings:update', { authMode: 'windows' })
})

describe('settings:update only lets known, well-typed fields through', () => {
  it('drops unknown keys and bad types', async () => {
    const settings = await invoke<AppSettings>('settings:update', {
      hoursPerDay: 'eight',
      patCipher: 'attacker-chosen',
      authMode: 'root',
      childQueryMode: 'sometimes',
      trustedHosts: ['a.example', 7],
      lastQueryUrl: QUERY
    })
    expect(settings.hoursPerDay).toBe(8)
    expect(settings.authMode).toBe('windows')
    expect(settings.childQueryMode).toBeUndefined()
    expect(settings.trustedHosts).toEqual(['a.example', '7'])
    const onDisk = await readFile(join(userData, 'settings.json'), 'utf8')
    expect(onDisk).not.toContain('attacker-chosen')
  })

  it('an empty string clears an optional value; owners may be TFS accounts', async () => {
    await invoke('settings:update', { apiVersion: '7.0', docOwner: 'member-1' })
    const cleared = await invoke<AppSettings>('settings:update', {
      apiVersion: '',
      docOwner: '',
      qaOwner: 'CMF\\bsrocha'
    })
    expect(cleared.apiVersion).toBeUndefined()
    expect(cleared.docOwner).toBeUndefined()
    expect(cleared.qaOwner).toBe('CMF\\bsrocha')
  })

  it('templates keep only named ones, prefixes as strings', async () => {
    const settings = await invoke<AppSettings>('settings:update', {
      taskTemplates: [
        { name: 'Full', prefixes: ['DEV', 3] },
        { prefixes: ['X'] },
        null,
        { name: 'No prefixes' }
      ]
    })
    expect(settings.taskTemplates).toEqual([
      { name: 'Full', prefixes: ['DEV', '3'] },
      { name: 'No prefixes', prefixes: [] }
    ])
  })
})

describe('tfs:createTasks cleans the drafts before they reach TFS', () => {
  it('trims titles and owners, clamps estimates, normalises tags, keeps order', async () => {
    let created = 100
    setServer((call) => {
      if (call.url.includes('/_apis/connectionData'))
        return json(200, { authenticatedUser: { providerDisplayName: 'T' } })
      if (call.url.includes('workitems?ids=')) {
        return json(200, {
          value: [
            {
              id: 5,
              url: 'https://tfs.example/5',
              fields: {
                'System.Title': 'Parent',
                'System.WorkItemType': 'User Story',
                'System.Tags': 'A; B'
              }
            }
          ]
        })
      }
      if (call.url.includes('$Task')) {
        const fields = Object.fromEntries(
          call.body.map((op: any) => [op.path.replace('/fields/', ''), op.value])
        )
        return json(200, {
          id: ++created,
          fields: { ...fields, 'System.WorkItemType': 'Task', 'System.State': 'New' }
        })
      }
      return json(404, {})
    })
    const result = await invoke<Result<{ created: unknown[] }>>('tfs:createTasks', QUERY, 5, [
      {
        title: '  DEV:: One  ',
        assignedTo: '  ',
        estimate: -3,
        tags: [' Docs ', 'docs', 'Release']
      },
      { title: 'VAL:: Two', assignedTo: ' CMF\\bsrocha ', estimate: 'x' },
      'garbage'
    ])
    expect(result.ok).toBe(true)
    const posts = requests.filter((r) => r.url.includes('$Task'))
    const fieldsOf = (i: number) =>
      Object.fromEntries(posts[i].body.map((op: any) => [op.path, op.value]))
    expect(fieldsOf(0)['/fields/System.Title']).toBe('DEV:: One')
    expect(fieldsOf(0)['/fields/System.AssignedTo']).toBeUndefined()
    expect(fieldsOf(0)['/fields/Microsoft.VSTS.Scheduling.RemainingWork']).toBeUndefined()
    expect(fieldsOf(0)['/fields/System.Tags']).toBe('Docs; Release')
    expect(fieldsOf(1)['/fields/System.AssignedTo']).toBe('CMF\\bsrocha')
    expect(fieldsOf(1)['/fields/System.Tags']).toBe('A; B') // no tags given → the parent's
    // Nothing is dropped: failures are reported by position, so a blank title still goes to
    // TFS (which refuses it) rather than shifting every later draft's index.
    expect(posts).toHaveLength(3)
    expect(fieldsOf(2)['/fields/System.Title']).toBeUndefined()
  })
})

describe('sprint:start', () => {
  const serveQuery = () =>
    setServer((call) => {
      if (call.url.includes('/_apis/connectionData'))
        return json(200, { authenticatedUser: { providerDisplayName: 'T' } })
      if (call.url.includes('/wiql/')) return json(200, { workItems: [{ id: 1 }, { id: 10 }] })
      if (call.url.includes('workitems?ids=')) {
        return json(200, {
          value: [
            {
              id: 1,
              fields: {
                'System.Title': 'Story',
                'System.WorkItemType': 'User Story',
                'System.State': 'Active'
              }
            },
            {
              id: 10,
              fields: {
                'System.Title': 'DEV:: Work',
                'System.WorkItemType': 'Task',
                'System.State': 'New',
                'System.Parent': 1,
                'Microsoft.VSTS.Scheduling.RemainingWork': 5,
                'Microsoft.VSTS.Scheduling.CompletedWork': 2
              }
            }
          ]
        })
      }
      return json(404, {})
    })

  it('needs a team first', async () => {
    await invoke('settings:update', { members: [] })
    const result = await invoke<Result<Sprint>>('sprint:start', {
      name: 'S',
      startDate: '2026-09-14',
      weeks: 2,
      includeWeekends: false,
      queryUrl: QUERY
    })
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.message).toMatch(/team members/)
  })

  it('builds the sprint: rows from the team, only tasks as cards, sized by Remaining', async () => {
    serveQuery()
    await invoke('settings:update', {
      members: [{ id: 'diogo', name: 'Diogo', order: 0 }],
      hoursPerDay: 8
    })
    const result = await invoke<Result<Sprint>>('sprint:start', {
      name: '  ',
      startDate: '2026-09-14',
      weeks: 2,
      includeWeekends: false,
      queryUrl: QUERY
    })
    if (!result.ok) throw new Error(result.message)
    const s = result.value
    expect(s.name).toBe('Sprint')
    expect(s.days).toHaveLength(10)
    expect(s.queues).toEqual({ diogo: [] })
    expect(s.backlog).toEqual([{ id: '10-1', workItemId: 10, hours: 5 }])
    expect(Object.keys(s.workItems)).toEqual(['1', '10'])
    // Saved, made the active sprint, and the URL remembered.
    expect(await invoke('sprint:load', s.id)).toEqual(s)
    const settings = await invoke<AppSettings>('settings:get')
    expect(settings).toMatchObject({ activeSprintId: s.id, lastQueryUrl: QUERY })
  })
})

describe('sprints, snapshots and files', () => {
  const s: Sprint = {
    ...sprint({ items: [item(3, { title: 'Export' })] }),
    id: 'files',
    name: 'Sprint: 24/09',
    notes: [
      {
        id: 'n',
        memberId: 'diogo',
        text: 'Great demo',
        taskIds: [3, 99],
        category: 'Agility',
        createdAt: '',
        updatedAt: ''
      }
    ]
  }

  beforeAll(async () => {
    await invoke('sprint:save', s)
  })

  it('switching sprints makes it active; an unknown one is an error', async () => {
    expect(await invoke('sprint:switch', 'files')).toMatchObject({ ok: true })
    expect((await invoke<AppSettings>('settings:get')).activeSprintId).toBe('files')
    expect(await invoke('sprint:switch', 'nope')).toMatchObject({
      ok: false,
      message: 'Sprint not found.'
    })
  })

  it('exporting notes writes Markdown to the chosen file, under a safe suggested name', async () => {
    const target = join(userData, 'notes-export.md')
    setSavePath(target)
    expect(await invoke('sprint:exportNotes', 'files')).toEqual({
      ok: true,
      value: 'notes-export.md'
    })
    expect(dialog.lastDefaultPath).toBe('Sprint 2409 notes.md')
    const md = await readFile(target, 'utf8')
    expect(md).toContain('# Sprint: 24/09 — Notes')
    expect(md).toContain('## Diogo')
    expect(md).toContain('**Category:** Agility')
    expect(md).toContain('[#3 Export](https://tfs.example/tfs/Coll/Proj/_workitems/edit/3), #99')
    expect(md).toContain('Great demo')
  })

  it('cancelling a save dialog writes nothing and returns null', async () => {
    setSavePath(null)
    expect(await invoke('sprint:exportNotes', 'files')).toEqual({ ok: true, value: null })
    expect(await invoke('sprint:saveSummary', 'S', '# hi')).toEqual({ ok: true, value: null })
  })

  it('saving a summary writes exactly the Markdown given', async () => {
    const target = join(userData, 'summary.md')
    setSavePath(target)
    expect(await invoke('sprint:saveSummary', 'S', '# Summary')).toEqual({
      ok: true,
      value: target
    })
    expect(await readFile(target, 'utf8')).toBe('# Summary')
  })

  it('snapshots: take, list, export, delete; exporting a missing one is an error', async () => {
    const taken = await invoke<Result<{ id: string }>>('snapshot:take', s, 'Plan')
    if (!taken.ok) throw new Error(taken.message)
    expect(await invoke<unknown[]>('snapshot:list', 'files')).toHaveLength(1)
    const target = join(userData, 'snap.json')
    setSavePath(target)
    await invoke('snapshot:export', 'files', taken.value.id)
    expect(JSON.parse(await readFile(target, 'utf8')).name).toBe('Plan')
    await invoke('snapshot:delete', 'files', taken.value.id)
    expect(await invoke('snapshot:export', 'files', taken.value.id)).toMatchObject({ ok: false })
  })
})

describe('tfs:test', () => {
  it('reports who it connected as, and remembers the API version', async () => {
    setServer((call) =>
      call.url.includes('/_apis/connectionData')
        ? json(200, { authenticatedUser: { providerDisplayName: 'Diogo Mesquita' } })
        : json(404, {})
    )
    const result = await invoke<{ ok: boolean; message: string; apiVersion?: string }>(
      'tfs:test',
      QUERY
    )
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/Connected as Diogo Mesquita/)
    expect((await invoke<AppSettings>('settings:get')).apiVersion).toBe(result.apiVersion)
  })

  it('a bad URL comes back as a readable failure, not a crash', async () => {
    expect(await invoke('tfs:test', 'nonsense')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/valid URL/)
    })
  })
})
