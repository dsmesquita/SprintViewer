import { checklist } from '../../../test/checklist'
import { registerIpc } from '../../main/ipc'
import { handlers, json, setServer } from '../../../test/electron'
import {
  applySquadSync,
  defaultChoices,
  planSquadSync,
  rosterName,
  syncSprintMembers
} from '@shared/squad'
import { createMockSprint } from '@shared/mock'

const { check, report } = checklist()
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)

const SPRINT_URL = 'https://tfs.example/tfs/Coll/Proj/_sprints/taskboard/Squad%20A/Proj/Sprint%2024.09'
const QUERY_URL = 'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'

const teams = [
  { id: 't2', name: 'Squad A' },
  { id: 't1', name: 'Proj Team' },
  { id: 't3', name: 'Other' }
]

function serve(shape: 'old' | 'new') {
  const people = [
    { id: 'p1', displayName: 'Mesquita, Diogo', uniqueName: 'CORP\\dmesquita' },
    { id: 'p2', displayName: 'Sofia Marques', uniqueName: 'CORP\\smarques' },
    { id: 'g1', displayName: '[Proj]\\Squad A Team', uniqueName: '[Proj]\\Squad A Team' },
    { id: 'g2', displayName: 'Contractors', uniqueName: 'CORP\\contractors', isContainer: true },
    { id: 'p1', displayName: 'Mesquita, Diogo', uniqueName: 'CORP\\dmesquita' } // listed twice
  ]
  const urls: string[] = []
  setServer((c: any) => {
    urls.push(c.url)
    if (c.url.includes('/_apis/connectionData')) return json(200, { authenticatedUser: { providerDisplayName: 'T' } })
    if (/\/teams\/t2\/members/.test(c.url)) {
      return json(200, { value: shape === 'old' ? people : people.map((p) => ({ isTeamAdmin: false, identity: p })) })
    }
    if (/\/_apis\/projects\/Proj\/teams\?/.test(c.url)) return json(200, { value: teams })
    return json(404, { message: 'unexpected ' + c.url })
  })
  return urls
}

async function run(): Promise<void> {
  registerIpc()
  await call('settings:update', { authMode: 'windows' })

  // ---- TFS side ----
  let urls = serve('new')
  let listed = await call('tfs:listTeams', SPRINT_URL)
  check('teams listed, sorted', listed.ok && listed.value.teams.map((t: any) => t.name).join('|') === 'Other|Proj Team|Squad A', listed)
  check('suggested = team named in the sprint URL', listed.value.suggested === 't2', listed.value.suggested)
  check('teams url is the project teams API with $top',
    urls.some((u) => u.startsWith('https://tfs.example/tfs/Coll/_apis/projects/Proj/teams?$top=1000&api-version=')), urls)

  listed = await call('tfs:listTeams', QUERY_URL)
  check('query URL → suggested = "<Project> Team"', listed.value.suggested === 't1', listed.value.suggested)

  for (const shape of ['new', 'old'] as const) {
    serve(shape)
    const people = await call('tfs:teamMembers', SPRINT_URL, 't2')
    check(`members (${shape} shape): groups dropped, duplicates merged`,
      people.ok && JSON.stringify(people.value.map((p: any) => p.id)) === '["p1","p2"]', people)
    check(`members (${shape} shape): account kept`, people.value[0].uniqueName === 'CORP\\dmesquita', people.value[0])
  }

  urls = serve('new')
  const noProject = await call('tfs:listTeams', 'https://tfs.example/tfs/Coll')
  check('URL without a project → clear error', !noProject.ok && /project/i.test(noProject.message), noProject)

  // ---- Matching ----
  const people = [
    { id: 'p1', displayName: 'Mesquita, Diogo', uniqueName: 'CORP\\dmesquita' },
    { id: 'p2', displayName: 'Sofia Marques', uniqueName: 'CORP\\smarques' },
    { id: 'p3', displayName: 'Bruno Sá', uniqueName: 'CORP\\bsa' },
    { id: 'p4', displayName: 'Bruno Costa', uniqueName: 'CORP\\bcosta' },
    { id: 'p5', displayName: 'Ana Lima', uniqueName: 'CORP\\alima' },
    { id: 'p6', displayName: 'Rui Pinto', uniqueName: 'CORP\\rpinto' }
  ]
  const roster = [
    { id: 'diogo', name: 'Diogo Mesquita', order: 0 },                                   // full name, other order
    { id: 'sofia', name: 'Sofia', order: 1 },                                            // name subset
    { id: 'bruno', name: 'Bruno', order: 2 },                                            // two Brunos → ambiguous
    { id: 'ana', name: 'Whoever', tfsIdentity: 'Old Name <corp\\ALIMA>', order: 3 },     // account wins over name
    { id: 'rui', name: 'Rui', tfsIdentity: 'Rui Pinto <CORP\\rpinto>', order: 4 },       // already linked
    { id: 'ezra', name: 'Ezra', order: 5 }                                               // not on the team
  ]
  const rows = planSquadSync(roster, people)
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r])) as Record<string, any>
  check('full name in any order → link', byKey['link:diogo']?.identity === 'Mesquita, Diogo <CORP\\dmesquita>', rows)
  check('roster name within TFS name → link', byKey['link:sofia']?.person.id === 'p2')
  check('account match beats a different name', byKey['link:ana']?.person.id === 'p5')
  check('identical identity → already linked', byKey['linked:rui'] !== undefined)
  check('two Brunos → no link, both offered with a warning',
    byKey['keep:bruno'] !== undefined && byKey['add:p3']?.maybe.includes('Bruno') && byKey['add:p4']?.maybe.includes('Bruno'), rows)
  check('not on the team → keep', byKey['keep:ezra'] !== undefined)

  const chosen = defaultChoices(rows)
  check('defaults: links and keeps ticked, ambiguous additions not',
    chosen.has('link:diogo') && chosen.has('keep:ezra') && !chosen.has('add:p3') && !chosen.has('add:p4'), [...chosen])

  chosen.delete('keep:ezra') // remove Ezra
  chosen.add('add:p4')       // add Bruno Costa after all
  const next = applySquadSync(roster, rows, chosen)
  check('apply: Ezra removed, Bruno Costa added at the end',
    !next.some((m) => m.id === 'ezra') && next.at(-1)?.name === 'Bruno Costa' && next.at(-1)?.tfsIdentity === 'Bruno Costa <CORP\\bcosta>', next)
  check('apply: identities written, order renumbered',
    next.find((m) => m.id === 'diogo')?.tfsIdentity === 'Mesquita, Diogo <CORP\\dmesquita>' &&
    next.every((m, i) => m.order === i), next)
  check('apply: new id does not collide', new Set(next.map((m) => m.id)).size === next.length, next.map((m) => m.id))
  check('apply: new member id comes from the TFS id', next.at(-1)?.id === 'tfs-p4', next.at(-1)?.id)

  // Removing the last counted member and adding someone in the same sync must not reuse the id
  // the open sprint still has a row for.
  const counted = [
    { id: 'member-1', name: 'Diogo Mesquita', order: 0 },
    { id: 'member-2', name: 'Leaving Person', order: 1 }
  ]
  const swapRows = planSquadSync(counted, [
    { id: 'p1', displayName: 'Diogo Mesquita', uniqueName: 'CORP\\dm' },
    { id: 'P-9', displayName: 'Newcomer', uniqueName: 'CORP\\nc' }
  ])
  const swapChoice = defaultChoices(swapRows)
  swapChoice.delete('keep:member-2')
  const swapped = applySquadSync(counted, swapRows, swapChoice)
  check('apply: removed id is not reused', !swapped.some((m) => m.id === 'member-2') &&
    swapped.some((m) => m.name === 'Newcomer' && m.id === 'tfs-p-9'), swapped)
  const sprintWithLeaver = {
    ...createMockSprint(),
    members: counted,
    queues: { 'member-1': [], 'member-2': [{ id: 'b1', workItemId: 1, hours: 4 }] }
  }
  const afterSwap = syncSprintMembers(sprintWithLeaver, swapped)
  check('sprint: leaver keeps their row and work, newcomer gets a new row',
    afterSwap.members.find((m) => m.id === 'member-2')?.tfsIdentity === undefined &&
    afterSwap.queues['member-2'].length === 1 &&
    afterSwap.members.some((m) => m.id === 'tfs-p-9'), afterSwap.members)
  check('apply: TFS id already in use gets a suffix',
    applySquadSync([{ id: 'tfs-p-9', name: 'Other', order: 0 }], swapRows, new Set(['add:P-9'])).at(-1)?.id === 'tfs-p-9-2')

  check('rosterName swaps "Surname, First"', rosterName('Mesquita, Diogo <CORP\\dmesquita>') === 'Diogo Mesquita')

  // ---- Open sprint ----
  const sprint = createMockSprint()
  const withWork = sprint.members[0].id
  const rosterForSprint = [
    { ...sprint.members[0], tfsIdentity: 'Someone <CORP\\x>' },
    { id: 'member-99', name: 'New Person', tfsIdentity: 'New Person <CORP\\np>', order: 1 }
  ] // everyone else missing from this roster
  const synced = syncSprintMembers(sprint, rosterForSprint)
  check('sprint: identity updated', synced.members.find((m) => m.id === withWork)?.tfsIdentity === 'Someone <CORP\\x>')
  check('sprint: new person added as an empty row at the bottom',
    synced.members.at(-1)?.id === 'member-99' && (synced.queues['member-99'] ?? []).length === 0 &&
    synced.members.at(-1)!.order > Math.max(...sprint.members.map((m) => m.order)), synced.members.at(-1))
  check('sprint: nobody removed, work untouched',
    synced.members.length === sprint.members.length + 1 && synced.queues[withWork] === sprint.queues[withWork])
  check('sprint: unchanged roster → same object', syncSprintMembers(synced, rosterForSprint) === synced)

}

await run()
report()
