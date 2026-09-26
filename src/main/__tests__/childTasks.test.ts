import { checklist } from '../../../test/checklist'
import { registerIpc } from '../ipc'
import { handlers, json, setServer } from '../../../test/electron'

const QUERY =
  'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
const A = 'Proj\\Sprint A'
const B = 'Proj\\Sprint B'

type Item = { id: number; type: string; parent?: number; iteration: string }
const items: Record<number, Item> = {
  1: { id: 1, type: 'User Story', iteration: A },
  2: { id: 2, type: 'Bug', iteration: A },
  3: { id: 3, type: 'User Story', iteration: A }, // only ever a parent of a returned task
  4: { id: 4, type: 'User Story', iteration: B },
  10: { id: 10, type: 'Task', parent: 1, iteration: A },
  11: { id: 11, type: 'Task', parent: 1, iteration: A },
  12: { id: 12, type: 'Task', parent: 1, iteration: B }, // a task of story 1 in another sprint
  20: { id: 20, type: 'Task', parent: 3, iteration: A },
  21: { id: 21, type: 'Task', parent: 3, iteration: A }, // sibling the query left out
  30: { id: 30, type: 'Task', parent: 2, iteration: A },
  40: { id: 40, type: 'Task', parent: 4, iteration: B },
  41: { id: 41, type: 'Task', parent: 4, iteration: 'PROJ\\sprint b' }, // same path, other case
  42: { id: 42, type: 'Task', parent: 4, iteration: A } // story 4 is in B, this task in A
}
const childrenOf = (parent: number) => Object.values(items).filter((item) => item.parent === parent)

function raw(id: number) {
  const item = items[id]
  return {
    id,
    fields: {
      'System.Title': `Item ${id}`,
      'System.WorkItemType': item.type,
      'System.State': 'Active',
      'System.IterationPath': item.iteration,
      'Microsoft.VSTS.Scheduling.RemainingWork': 2,
      ...(item.parent ? { 'System.Parent': item.parent } : {})
    }
  }
}

/**
 * A server whose saved query returns `queryIds`. Child queries are answered as TFS would, unless
 * `ignoreIteration` is set — then the iteration clause is disregarded, which is what proves the
 * client checks the answer itself rather than trusting it.
 */
function serve(queryIds: number[], ignoreIteration = false) {
  const childQueries: Array<{ parents: number[]; iteration: string }> = []
  setServer((call: any) => {
    if (call.url.includes('/_apis/connectionData'))
      return json(200, { authenticatedUser: { providerDisplayName: 'Test' } })
    if (call.url.includes('/wiql/')) return json(200, { workItems: queryIds.map((id) => ({ id })) })
    if (call.url.includes('/wiql?')) {
      const text = String(call.body.query)
      const parents = text
        .match(/\[System\.Parent\] IN \(([^)]*)\)/)![1]
        .split(',')
        .map((s) => Number(s.trim()))
      const iteration =
        text.match(/\[System\.IterationPath\] = '((?:[^']|'')*)'/)?.[1].replace(/''/g, "'") ??
        '(none)'
      childQueries.push({ parents, iteration })
      const found = parents
        .flatMap(childrenOf)
        .filter(
          (child) => ignoreIteration || child.iteration.toLowerCase() === iteration.toLowerCase()
        )
      return json(200, { workItems: found.map((child) => ({ id: child.id })) })
    }
    if (call.url.includes('workitems?ids=')) {
      const ids = decodeURIComponent(call.url)
        .match(/ids=([\d,]+)/)![1]
        .split(',')
        .map(Number)
      const url = decodeURIComponent(call.url)
      // A named-field request must ask for the iteration, or the client could not check it.
      if (url.includes('&fields=') && !url.includes('System.IterationPath')) {
        return json(400, { message: 'test: iteration path not requested' })
      }
      return json(200, { value: ids.filter((id) => items[id]).map(raw) })
    }
    return json(404, {})
  })
  return childQueries
}

const { check, report } = checklist()
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
const sorted = (ids: number[]) => JSON.stringify([...ids].sort((a, b) => a - b))

async function start(
  mode: 'auto' | 'always' | 'never',
  queryIds: number[],
  ignoreIteration = false
) {
  await call('settings:update', { childQueryMode: mode })
  const childQueries = serve(queryIds, ignoreIteration)
  const result = await call('sprint:start', {
    name: 'T',
    startDate: '2026-09-14',
    weeks: 2,
    includeWeekends: false,
    queryUrl: QUERY
  })
  if (!result.ok) throw new Error(result.message)
  return {
    childQueries,
    workItems: Object.keys(result.value.workItems).map(Number),
    backlog: result.value.backlog.map((b: any) => b.workItemId) as number[]
  }
}

async function refresh(mode: 'auto' | 'always' | 'never', queryIds: number[]) {
  await call('settings:update', { childQueryMode: mode })
  const childQueries = serve(queryIds)
  const result = await call('sprint:refresh', QUERY)
  if (!result.ok) throw new Error(result.message)
  return { childQueries, ids: (result.value as Array<{ id: number }>).map((item) => item.id) }
}

async function run(): Promise<void> {
  registerIpc()
  await call('settings:update', {
    authMode: 'windows',
    members: [{ id: 'm', name: 'M', order: 0 }]
  })

  // Settings round trip — the original bug.
  for (const mode of ['never', 'always', 'auto'] as const) {
    await call('settings:update', { childQueryMode: mode })
    const read = await call('settings:get')
    check(`settings: ${mode} reads back`, read.childQueryMode === mode, read.childQueryMode)
  }
  await call('settings:update', { childQueryMode: 'bogus' })
  check('settings: invalid value ignored', (await call('settings:get')).childQueryMode === 'auto')

  // Import: containers only, two parents in sprint A and one in sprint B.
  let r = await start('auto', [1, 2, 4])
  check(
    "import · auto → only tasks in their parent's iteration",
    sorted(r.backlog) === '[10,11,30,40,41]',
    r
  )
  check(
    'import · one child query per parent iteration',
    r.childQueries.length === 2 &&
      r.childQueries.some((q) => q.iteration === A && sorted(q.parents) === '[1,2]') &&
      r.childQueries.some((q) => q.iteration === B && sorted(q.parents) === '[4]'),
    r.childQueries
  )
  check(
    'import · other-sprint tasks 12 and 42 excluded',
    !r.workItems.includes(12) && !r.workItems.includes(42),
    r.workItems
  )
  check(
    'import · iteration compared case-insensitively (41 kept)',
    r.backlog.includes(41),
    r.backlog
  )

  r = await start('auto', [1, 2, 4], true)
  check(
    'import · server ignoring the iteration clause is still filtered',
    sorted(r.backlog) === '[10,11,30,40,41]',
    r
  )

  r = await start('always', [1, 2, 4])
  check(
    'import · always, containers only → same as auto',
    sorted(r.backlog) === '[10,11,30,40,41]',
    r
  )
  r = await start('never', [1, 2, 4])
  check(
    'import · never → nothing fetched',
    r.childQueries.length === 0 && r.backlog.length === 0,
    r
  )

  // Import: a story, one of its tasks, and a task whose story the query did not return.
  r = await start('auto', [1, 10, 20])
  check(
    'mixed · auto → nothing fetched',
    r.childQueries.length === 0 && sorted(r.backlog) === '[10,20]',
    r
  )
  r = await start('always', [1, 10, 20])
  check(
    'mixed · always → children of the returned story only',
    r.childQueries.length === 1 &&
      sorted(r.childQueries[0].parents) === '[1]' &&
      sorted(r.backlog) === '[10,11,20]',
    r
  )
  check(
    'mixed · always → heading-only story 3 kept, its left-out task 21 not pulled in',
    r.workItems.includes(3) && !r.workItems.includes(21),
    r.workItems
  )
  r = await start('never', [1, 10, 20])
  check(
    'mixed · never → nothing fetched',
    r.childQueries.length === 0 && sorted(r.backlog) === '[10,20]',
    r
  )
  r = await start('always', [10, 20])
  check(
    'tasks only · always → nothing to fetch',
    r.childQueries.length === 0 && sorted(r.backlog) === '[10,20]',
    r
  )

  // Refresh follows the same setting.
  let f = await refresh('auto', [1, 2, 4])
  check(
    'refresh · auto → children included',
    [10, 11, 30, 40, 41].every((id) => f.ids.includes(id)) &&
      !f.ids.includes(12) &&
      !f.ids.includes(42),
    f.ids
  )
  f = await refresh('always', [1, 10, 20])
  check(
    'refresh · always → children of returned containers',
    f.ids.includes(11) && !f.ids.includes(21),
    f.ids
  )
  f = await refresh('never', [1, 2, 4])
  check(
    'refresh · never → query result only',
    f.childQueries.length === 0 && sorted(f.ids) === '[1,2,4]',
    f.ids
  )
}

await run()
report()
