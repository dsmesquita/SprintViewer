import { checklist } from '../../../test/checklist'
import { TfsClient } from '../tfs/client'
import { calls, html, json, setHandler } from '../../../test/electron'

const target = {
  host: 'tfs.example',
  collectionBase: 'https://tfs.example/tfs/Coll',
  projectBase: 'https://tfs.example/tfs/Coll/Proj',
  project: 'Proj',
  source: { kind: 'query', queryId: 'q' }
} as never

const parent = {
  id: 123,
  url: 'https://tfs.example/tfs/Coll/_apis/wit/workItems/123',
  fields: {
    'System.Title': 'Export service',
    'System.WorkItemType': 'User Story',
    'System.State': 'Active',
    'System.Tags': 'Squad A; Release 24.09',
    'System.AreaPath': 'Proj\\Area',
    'System.IterationPath': 'Proj\\Sprint 24.09'
  }
}

let nextId = 900
function created(body: Array<{ path: string; value: unknown }>) {
  const fields: Record<string, unknown> = { 'System.WorkItemType': 'Task', 'System.State': 'New' }
  for (const op of body) if (op.path.startsWith('/fields/')) fields[op.path.slice(8)] = op.value
  return { id: nextId++, fields }
}

const { check, report } = checklist()

async function run(): Promise<void> {
  // 1. Modern server (7.0): POST, JSON-patch, every field, parent link, estimate = remaining.
  setHandler((call: { url: string; method?: string; body?: never }) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    if (call.url.includes('$Task')) return json(200, created(call.body!))
    return json(404, {})
  })
  let client = new TfsClient(target, { mode: 'windows' }, '7.0')
  let result = await client.createTasks(123, [
    { title: 'DEV:: Export service', assignedTo: 'Diogo Mesquita <CORP\\dmesquita>', estimate: 6 },
    { title: 'VAL:: Export service', estimate: 0 }
  ])
  const post = calls.filter((c) => c.url.includes('$Task'))
  const paths = (i: number) =>
    Object.fromEntries(post[i].body.map((op: any) => [op.path, op.value]))
  check(
    'modern: uses POST',
    post.every((c) => c.method === 'POST'),
    post.map((c) => c.method)
  )
  check('modern: json-patch content type', post[0].contentType === 'application/json-patch+json')
  check('modern: api-version on create', post[0].url.endsWith('$Task?api-version=7.0'), post[0].url)
  const first = paths(0)
  check('title', first['/fields/System.Title'] === 'DEV:: Export service')
  check('assignee', first['/fields/System.AssignedTo'] === 'Diogo Mesquita <CORP\\dmesquita>')
  check(
    'estimate + remaining',
    first['/fields/Microsoft.VSTS.Scheduling.OriginalEstimate'] === 6 &&
      first['/fields/Microsoft.VSTS.Scheduling.RemainingWork'] === 6
  )
  check('tags copied', first['/fields/System.Tags'] === 'Squad A; Release 24.09')
  check(
    'area + iteration copied',
    first['/fields/System.AreaPath'] === 'Proj\\Area' &&
      first['/fields/System.IterationPath'] === 'Proj\\Sprint 24.09'
  )
  check(
    'parent link',
    JSON.stringify(first['/relations/-']) ===
      JSON.stringify({ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parent.url })
  )
  const second = paths(1)
  check(
    'no estimate → neither field, no assignee',
    !('/fields/Microsoft.VSTS.Scheduling.RemainingWork' in second) &&
      !('/fields/Microsoft.VSTS.Scheduling.OriginalEstimate' in second) &&
      !('/fields/System.AssignedTo' in second)
  )
  check('created items come back', result.created.length === 2 && result.failures.length === 0)
  check(
    'created carries parent + tags',
    result.created[0].parentId === 123 &&
      JSON.stringify(result.created[0].tfsTags) === '["Squad A","Release 24.09"]',
    result.created[0]
  )
  check(
    'created is sized',
    result.created[0].originalEstimate === 6 && result.created[0].remainingWork === 6
  )

  // 1b. Custom tags replace the parent's; an empty list means none at all.
  calls.length = 0
  await client.createTasks(123, [
    { title: 'DOC:: Export service', estimate: 0, tags: ['Docs', 'Release 24.10'] },
    { title: 'QA:: Export service', estimate: 0, tags: [] }
  ])
  const custom = calls.filter((c) => c.url.includes('$Task'))
  const tagOf = (i: number) =>
    Object.fromEntries(custom[i].body.map((op: any) => [op.path, op.value]))['/fields/System.Tags']
  check("custom tags replace the parent's", tagOf(0) === 'Docs; Release 24.10', tagOf(0))
  check('empty custom tags → no tags at all', tagOf(1) === undefined, tagOf(1))

  // 2. Old server (3.0): PATCH first.
  setHandler((call: any) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    if (call.url.includes('$Task')) return json(200, created(call.body))
    return json(404, {})
  })
  client = new TfsClient(target, { mode: 'windows' }, '3.0')
  result = await client.createTasks(123, [{ title: 'Old', estimate: 1 }])
  check('old server: PATCH', calls.filter((c) => c.url.includes('$Task'))[0].method === 'PATCH')

  // 3. Server refuses the first method with 405 → the other is tried.
  setHandler((call: any) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    if (call.url.includes('$Task'))
      return call.method === 'POST' ? html(405) : json(200, created(call.body))
    return json(404, {})
  })
  client = new TfsClient(target, { mode: 'windows' }, '5.0')
  result = await client.createTasks(123, [{ title: 'Fallback', estimate: 1 }])
  const methods = calls.filter((c) => c.url.includes('$Task')).map((c) => c.method)
  check(
    '405 → falls back to PATCH',
    JSON.stringify(methods) === '["POST","PATCH"]' && result.created.length === 1,
    methods
  )

  // 4. Template without Original Estimate → retried without it, Remaining kept.
  setHandler((call: any) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    if (call.url.includes('$Task')) {
      const named = call.body.some((op: any) => op.path.includes('OriginalEstimate'))
      return named
        ? json(400, {
            message: 'TF51535: Cannot find field Microsoft.VSTS.Scheduling.OriginalEstimate.'
          })
        : json(200, created(call.body))
    }
    return json(404, {})
  })
  client = new TfsClient(target, { mode: 'windows' }, '7.0')
  result = await client.createTasks(123, [{ title: 'No estimate field', estimate: 4 }])
  const last = calls.filter((c) => c.url.includes('$Task')).at(-1)!
  check(
    'estimate field refused → retried without it',
    result.created.length === 1 &&
      last.body.some((op: any) => op.path.endsWith('RemainingWork')) &&
      !last.body.some((op: any) => op.path.includes('OriginalEstimate'))
  )

  // 5. Partial failure: second draft refused, third still created; index reported.
  let n = 0
  setHandler((call: any) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    if (call.url.includes('$Task')) {
      n++
      return n === 2
        ? json(400, { message: 'The identity Nobody is not recognised.' })
        : json(200, created(call.body))
    }
    return json(404, {})
  })
  client = new TfsClient(target, { mode: 'windows' }, '7.0')
  result = await client.createTasks(123, [
    { title: 'A', estimate: 1 },
    { title: 'B', assignedTo: 'Nobody', estimate: 1 },
    { title: 'C', estimate: 1 }
  ])
  check(
    'partial: 2 created, 1 failed at index 1',
    result.created.length === 2 &&
      result.failures.length === 1 &&
      result.failures[0].index === 1 &&
      result.failures[0].message.includes('not recognised'),
    result.failures
  )

  // 6. 403 on write → message asks for Read & Write.
  setHandler((call: any) => {
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    return json(403, {})
  })
  client = new TfsClient(target, { mode: 'pat', pat: 'x' }, '7.0')
  result = await client.createTasks(123, [{ title: 'Denied', estimate: 1 }])
  check(
    '403 names Read & Write',
    result.failures[0]?.message.includes('Read & Write') === true,
    result.failures[0]?.message
  )

  // 7. Parent missing → whole call fails cleanly.
  setHandler(() => json(200, { value: [] }))
  client = new TfsClient(target, { mode: 'windows' }, '7.0')
  const missing = await client.createTasks(999, [{ title: 'X', estimate: 1 }]).then(
    () => 'resolved',
    (e) => String(e.message)
  )
  check('missing parent → clear error', missing.includes('999'), missing)

  // 8. Reading: tags/area/iteration are mapped on fetched containers.
  setHandler((call: any) => {
    if (call.url.includes('wiql')) return json(200, { workItems: [{ id: 123 }] })
    if (call.url.includes('workitems?ids=')) return json(200, { value: [parent] })
    return json(404, {})
  })
  client = new TfsClient(target, { mode: 'windows' }, '7.0')
  const items = await client.fetchWorkItems()
  check(
    'read maps tfsTags/area/iteration',
    items[0].tfsTags?.length === 2 &&
      items[0].areaPath === 'Proj\\Area' &&
      items[0].iterationPath === 'Proj\\Sprint 24.09',
    items[0]
  )
}

await run()
report()
