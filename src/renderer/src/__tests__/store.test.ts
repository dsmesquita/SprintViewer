// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persistSprint, useApp } from '../store'
import { DEFAULT_HOUR_W } from '../grid'
import { block, item, MON, sprint, TUE, WED } from '../../../../test/fixtures'
import { installFakeApi } from '../../../../test/fakeApi'
import type { Sprint } from '@shared/types'

/** The store: undo, persistence, refresh, opening sprints and view state. */

const initial = useApp.getState()
let fake: ReturnType<typeof installFakeApi>

const board = (): Sprint => ({
  ...sprint({
    items: [item(1, { remainingWork: 4 }), item(2, { remainingWork: 4, title: 'DEV:: two' })],
    queues: { diogo: [block('a', 1, 4), block('b', 2, 4)] }
  }),
  queryUrl: 'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
})

/** Lets queued microtasks and awaited fakes settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  fake = installFakeApi()
  useApp.setState({ ...initial, sprint: board(), loading: false, today: MON }, true)
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('changing the board', () => {
  it('a change is applied, saved, and can be undone by name', async () => {
    useApp.getState().moveBlock('b', { kind: 'member', memberId: 'diogo' }, 0)
    expect(useApp.getState().sprint!.queues.diogo.map((b) => b.id)).toEqual(['b', 'a'])
    expect(useApp.getState().undoStack.map((u) => u.label)).toEqual(['move'])
    await settle()
    expect(fake.api.saveSprint).toHaveBeenCalledTimes(1)

    useApp.getState().undo()
    expect(useApp.getState().sprint!.queues.diogo.map((b) => b.id)).toEqual(['a', 'b'])
    expect(useApp.getState().undoStack).toEqual([])
  })

  it('a change that changes nothing is not saved and not undoable', async () => {
    useApp.getState().moveBlock('no-such-block', { kind: 'backlog' }, 0)
    await settle()
    expect(useApp.getState().undoStack).toEqual([])
    expect(fake.api.saveSprint).not.toHaveBeenCalled()
  })

  it('undo remembers fifty steps and forgets older ones', () => {
    for (let i = 0; i < 55; i++)
      useApp.getState().moveBlock(i % 2 ? 'a' : 'b', { kind: 'member', memberId: 'diogo' }, 0)
    expect(useApp.getState().undoStack).toHaveLength(50)
  })

  it('the tag filter is saved with the sprint but is not a step to undo', () => {
    useApp.getState().toggleTag('DEV')
    expect(useApp.getState().sprint!.hiddenTags).toEqual(['DEV'])
    expect(useApp.getState().undoStack).toEqual([])
    // …and undoing something else does not bring hidden tags back.
    useApp.getState().moveBlock('b', { kind: 'member', memberId: 'diogo' }, 0)
    useApp.getState().toggleTag('DEV')
    useApp.getState().undo()
    expect(useApp.getState().sprint!.hiddenTags).toEqual([])
  })

  it('every board action goes through undo with its own label', () => {
    const s = useApp.getState()
    s.setHoursPerDay(6)
    s.setDayCapacity(TUE, 0, 'Day off')
    s.setMemberCapacity('sofia', WED, 4)
    s.pinBlock('a', 'diogo', WED, 2)
    s.unpinBlock('a')
    s.splitBlock('a', 1)
    s.setCustomHours(2, 7)
    s.lockDay(WED)
    s.unlockDay(WED)
    s.clearSprint()
    expect(useApp.getState().undoStack.map((u) => u.label)).toEqual([
      'hours in a day',
      'day capacity',
      'capacity',
      'move',
      'unpin',
      'split',
      'manual hours',
      'lock day',
      'unlock day',
      'clear sprint'
    ])
  })

  it('the sample sprint is never written to disk', async () => {
    useApp.getState().loadSample()
    expect(useApp.getState().isSample).toBe(true)
    useApp.getState().toggleTag('DEV')
    await persistSprint()
    expect(fake.api.saveSprint).not.toHaveBeenCalled()
  })

  it('a failed save is reported, not rolled back', async () => {
    fake.api.saveSprint.mockResolvedValueOnce({ ok: false, message: 'Disk full' } as never)
    useApp.getState().unpinBlock('a') // no-op
    useApp.getState().moveBlock('b', { kind: 'member', memberId: 'diogo' }, 0)
    await settle()
    expect(useApp.getState().saveError).toBe('Disk full')
    expect(useApp.getState().sprint!.queues.diogo[0].id).toBe('b')
  })

  it('the Sprint start baseline is checked once changes stop, not on every save', async () => {
    vi.useFakeTimers()
    useApp.getState().moveBlock('b', { kind: 'member', memberId: 'diogo' }, 0)
    useApp.getState().moveBlock('a', { kind: 'member', memberId: 'diogo' }, 0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.api.ensureBaseline).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.api.ensureBaseline).toHaveBeenCalledTimes(1)
  })
})

describe('refresh', () => {
  it('applies TFS figures and says what changed', async () => {
    fake.api.refreshSprint.mockResolvedValueOnce({
      ok: true,
      value: [
        item(1, { remainingWork: 2 }),
        item(2, { remainingWork: 0, completedWork: 4 }),
        item(3, { remainingWork: 5 })
      ]
    } as never)
    await useApp.getState().refresh()
    const state = useApp.getState()
    expect(state.refreshStatus).toEqual({ ok: true, text: '1 updated, 1 finished, 1 new' })
    expect(state.undoStack.map((u) => u.label)).toEqual(['refresh'])
    expect(state.sprint!.lastRefreshedAt).toBeDefined()
  })

  describe('a new backlog task with hours already done by someone on the team', () => {
    const refreshWithDoneWork = async () => {
      fake.api.refreshSprint.mockResolvedValueOnce({
        ok: true,
        value: [
          item(1, { remainingWork: 4 }),
          item(2, { remainingWork: 4 }),
          item(3, { remainingWork: 5, completedWork: 2, assignedTo: 'Diogo Mesquita' })
        ]
      } as never)
      await useApp.getState().refresh()
    }

    it('is asked about once the refresh is in', async () => {
      await refreshWithDoneWork()
      expect(useApp.getState().doneQuestion).toEqual([3])
    })

    it('kept in the backlog: its done hours wait there, as one undoable step', async () => {
      await refreshWithDoneWork()
      useApp.getState().answerDoneQuestion(false)
      const state = useApp.getState()
      expect(state.doneQuestion).toBeNull()
      expect(state.sprint!.doneInBacklog).toEqual([3])
      expect(state.undoStack.map((u) => u.label)).toEqual(['refresh', 'done hours'])
      useApp.getState().undo()
      expect(useApp.getState().sprint!.doneInBacklog ?? []).toEqual([])
    })

    it('placed on the calendar: drawn, and not asked about again', async () => {
      await refreshWithDoneWork()
      useApp.getState().answerDoneQuestion(true)
      expect(useApp.getState().sprint!.doneInBacklog).toEqual([])
      expect(useApp.getState().sprint!.doneDecided).toEqual([3])
      await refreshWithDoneWork()
      expect(useApp.getState().doneQuestion).toBeNull()
    })

    it('dismissed: nothing is recorded, and the next refresh asks again', async () => {
      await refreshWithDoneWork()
      const before = useApp.getState().sprint
      useApp.getState().dismissDoneQuestion()
      expect(useApp.getState().doneQuestion).toBeNull()
      expect(useApp.getState().sprint).toBe(before)
      await refreshWithDoneWork()
      expect(useApp.getState().doneQuestion).toEqual([3])
    })
  })

  it('a failure is shown and the board is untouched', async () => {
    const before = useApp.getState().sprint
    fake.api.refreshSprint.mockResolvedValueOnce({ ok: false, message: 'TFS is down' } as never)
    await useApp.getState().refresh()
    expect(useApp.getState().refreshStatus).toEqual({ ok: false, text: 'TFS is down' })
    expect(useApp.getState().sprint).toBe(before)
  })

  it('a manual time TFS now disagrees with holds the whole refresh until decided', async () => {
    useApp.getState().setCustomHours(1, 10)
    const before = useApp.getState().sprint
    fake.api.refreshSprint.mockResolvedValue({
      ok: true,
      value: [item(1, { remainingWork: 3 }), item(2, { remainingWork: 4 })]
    } as never)
    await useApp.getState().refresh()
    expect(useApp.getState().pendingRefresh?.conflicts).toEqual([
      { workItemId: 1, title: 'Task 1', yours: 10, theirs: 3 }
    ])
    expect(useApp.getState().sprint).toBe(before)

    useApp.getState().cancelRefresh()
    expect(useApp.getState().pendingRefresh).toBeNull()
    expect(useApp.getState().refreshStatus?.text).toBe('Refresh cancelled')
    expect(useApp.getState().sprint).toBe(before)

    await useApp.getState().refresh()
    useApp.getState().resolveRefresh(new Map([[1, { kind: 'theirs' as const }]]))
    expect(useApp.getState().pendingRefresh).toBeNull()
    expect(useApp.getState().sprint!.customHours?.[1]).toBeUndefined()
  })

  it('a sprint not imported from TFS has nothing to refresh', async () => {
    useApp.setState({ sprint: { ...board(), queryUrl: undefined } })
    await useApp.getState().refresh()
    expect(fake.api.refreshSprint).not.toHaveBeenCalled()
  })
})

describe('opening a sprint', () => {
  it('loads the active sprint and settings on start', async () => {
    const s = { ...board(), id: 'active' }
    fake.saved.set('active', s)
    fake.setSettings({ activeSprintId: 'active' })
    useApp.setState({ ...initial, today: MON }, true)
    await useApp.getState().init()
    expect(useApp.getState()).toMatchObject({ loading: false, isSample: false })
    expect(useApp.getState().sprint!.id).toBe('active')
  })

  it('without the desktop bridge it just stops loading', async () => {
    ;(window as unknown as { api?: unknown }).api = undefined
    useApp.setState({ ...initial }, true)
    await useApp.getState().init()
    expect(useApp.getState().loading).toBe(false)
  })

  it('a refreshed sprint without a past record gets one; a never-refreshed one does not', async () => {
    const refreshed = {
      ...board(),
      id: 'r',
      lastRefreshedAt: '2026-09-15T08:00:00Z',
      workItems: {
        ...board().workItems,
        9: item(9, { completedWork: 3, assignedTo: 'Diogo Mesquita' })
      }
    }
    fake.saved.set('r', refreshed)
    fake.saved.set('never', { ...board(), id: 'never' })
    useApp.setState({ today: WED })
    await useApp.getState().switchSprint('r')
    expect(
      useApp.getState().sprint!.pastRecord?.diogo?.[MON]?.map((p) => [p.workItemId, p.hours])
    ).toEqual([[9, 3]])
    await useApp.getState().switchSprint('never')
    expect(useApp.getState().sprint!.pastRecord).toBeUndefined()
  })

  it('a finished task left on the calendar by an older version loses its block', async () => {
    const old = {
      ...board(),
      id: 'old',
      workItems: {
        ...board().workItems,
        1: item(1, { remainingWork: 0, completedWork: 4, state: 'Closed' })
      }
    }
    fake.saved.set('old', old)
    await useApp.getState().switchSprint('old')
    expect(useApp.getState().sprint!.queues.diogo.map((b) => b.id)).toEqual(['b'])
  })

  it('switching to an unknown sprint changes nothing', async () => {
    const before = useApp.getState().sprint
    await useApp.getState().switchSprint('ghost')
    expect(useApp.getState().sprint).toBe(before)
  })
})

describe('creating tasks', () => {
  it('adds what TFS created to the backlog, as one undoable step', async () => {
    fake.api.createTasks.mockResolvedValueOnce({
      ok: true,
      value: { created: [item(50, { remainingWork: 3 })], failures: [] }
    } as never)
    const result = await useApp.getState().createTasks(1, [{ title: 'x', estimate: 3 }])
    expect(result).toMatchObject({ failures: [] })
    expect(useApp.getState().sprint!.backlog.map((b) => [b.workItemId, b.hours])).toEqual([[50, 3]])
    expect(useApp.getState().undoStack.at(-1)?.label).toBe('create tasks')
  })

  it('says why when it cannot', async () => {
    useApp.setState({ sprint: { ...board(), queryUrl: undefined } })
    expect(await useApp.getState().createTasks(1, [])).toMatch(/imported from TFS/)
    useApp.setState({ sprint: board() })
    fake.api.createTasks.mockResolvedValueOnce({ ok: false, message: 'No permission' } as never)
    expect(await useApp.getState().createTasks(1, [])).toBe('No permission')
  })
})

describe('view state', () => {
  it('selecting a task opens its tab; clearing it only leaves the Task tab', () => {
    const s = useApp.getState()
    s.selectTask(1, 'a')
    expect(useApp.getState()).toMatchObject({
      selectedWorkItemId: 1,
      selectedBlockId: 'a',
      panelTab: 'task'
    })
    s.clearTask()
    expect(useApp.getState()).toMatchObject({ selectedWorkItemId: null, panelTab: 'backlog' })
    s.selectTask(1, 'a')
    s.selectMember('sofia')
    s.clearTask()
    expect(useApp.getState().panelTab).toBe('person')
  })

  it('Shift+arrow nudges the selected block, as an undoable step', () => {
    useApp.getState().selectTask(2, 'b')
    useApp.getState().nudge(-1)
    expect(useApp.getState().sprint!.queues.diogo.map((b) => b.id)).toEqual(['b', 'a'])
    expect(useApp.getState().undoStack.at(-1)?.label).toBe('nudge')
  })

  it('nudging with nothing selected does nothing', () => {
    useApp.getState().nudge(1)
    expect(useApp.getState().undoStack).toEqual([])
  })

  it('zoom steps, resets, and is remembered on this computer', () => {
    useApp.getState().zoomBy(1)
    const zoomed = useApp.getState().hourWidth
    expect(zoomed).toBeGreaterThan(DEFAULT_HOUR_W)
    expect(localStorage.getItem('sprint-viewer.hourWidth')).toBe(String(zoomed))
    useApp.getState().zoomBy(null)
    expect(useApp.getState().hourWidth).toBe(DEFAULT_HOUR_W)
  })

  it('zoom still works when the browser refuses storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    useApp.getState().zoomBy(-1)
    expect(useApp.getState().hourWidth).toBeLessThan(DEFAULT_HOUR_W)
    spy.mockRestore()
  })

  it('dialogs open with their target and close clean', () => {
    const s = useApp.getState()
    s.openCreateTasks(5)
    expect(useApp.getState()).toMatchObject({ dialog: 'create-tasks', createTasksParent: 5 })
    s.openDialog('start-sprint', WED)
    expect(useApp.getState().startDateSeed).toBe(WED)
    s.closeDialog()
    expect(useApp.getState()).toMatchObject({
      dialog: 'none',
      startDateSeed: null,
      createTasksParent: null
    })
  })
})
