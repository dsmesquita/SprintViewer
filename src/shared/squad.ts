import { displayName } from './assignment'
import { normalize } from './text'
import type { Member, Sprint } from './types'

/**
 * Keeping the team roster in step with the team TFS knows about.
 *
 * The roster is what the calendar's rows are, and each person's TFS identity is what ties a
 * work item's Assigned To to a row — for auto-assign, for the drop warning, and as the owner of
 * tasks created from the backlog. Typing those identities by hand is where they go wrong, so
 * this reads them from the team instead and proposes the changes, rather than making them.
 */

export interface TfsTeam {
  id: string
  name: string
}

/** A person on a TFS team. */
export interface TfsPerson {
  id: string
  displayName: string
  /** The account, `DOMAIN\user` on-prem or an email address when hosted. */
  uniqueName?: string
}

/**
 * One proposed change, or the reason there is none.
 *
 * - `link`: a roster member matched a person; their TFS identity will be set.
 * - `linked`: already set to exactly this identity. Nothing to do.
 * - `add`: a person on the team nobody on the roster matched.
 * - `keep`: a roster member who is not on the team. Kept unless told otherwise — people help
 *   out across teams, and a roster is allowed to be bigger than the TFS team.
 */
export type SyncRow =
  | { kind: 'link'; key: string; member: Member; person: TfsPerson; identity: string }
  | { kind: 'linked'; key: string; member: Member; person: TfsPerson }
  | {
      kind: 'add'
      key: string
      person: TfsPerson
      identity: string
      name: string
      /** Roster members this person could be, when the names were too close to call. */
      maybe: string[]
    }
  | { kind: 'keep'; key: string; member: Member }

/** `Display Name <DOMAIN\user>` — the form TFS itself writes into Assigned To. */
export function identityOf(person: TfsPerson): string {
  const account = person.uniqueName?.trim()
  return account ? `${person.displayName.trim()} <${account}>` : person.displayName.trim()
}

/**
 * The name to show on a calendar row. Collections configured surname-first give
 * `Mesquita, Diogo`; a row reads better as the name is spoken.
 */
export function rosterName(display: string): string {
  const name = displayName(display)
  const parts = name.split(',').map((part) => part.trim())
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name
}

/** The account inside an identity, `DOMAIN\user` from `Name <DOMAIN\user>`. */
function accountOf(identity: string | undefined): string | undefined {
  return identity
    ?.match(/<([^>]+)>\s*$/)?.[1]
    ?.trim()
    .toLowerCase()
}

function tokens(value: string): string[] {
  return normalize(displayName(value)).split(' ').filter(Boolean)
}

/**
 * How confidently a roster member is this person.
 *
 * 3 — every word of the name is the same, in any order.
 * 2 — every word of the roster name is in the TFS name: `Sofia` for `Sofia Marques`.
 * 1 — only the first or the last name agrees.
 * 0 — nothing in common.
 *
 * Deliberately stricter than the matching that guards a drop. There a wrong guess costs a
 * missing prompt; here it writes someone else's account against a row.
 */
function nameScore(member: Member, person: TfsPerson): number {
  const theirs = tokens(person.displayName)
  if (theirs.length === 0) return 0
  let best = 0
  for (const known of [member.name, member.tfsIdentity]) {
    if (!known) continue
    const mine = tokens(known)
    if (mine.length === 0) continue
    if ([...mine].sort().join(' ') === [...theirs].sort().join(' ')) return 3
    if (mine.every((token) => theirs.includes(token))) best = Math.max(best, 2)
    else if (mine[0] === theirs[0] || mine[mine.length - 1] === theirs[theirs.length - 1]) {
      best = Math.max(best, 1)
    }
  }
  return best
}

/**
 * Works out what a sync would change, without changing anything.
 *
 * An account that is already on a roster row settles that row first. Names come next, most
 * confident first, and a pairing is only made when it is unambiguous at that level — two
 * Diogos on the team and one on the roster is a question for the user, not a coin toss.
 */
export function planSquadSync(roster: Member[], people: TfsPerson[]): SyncRow[] {
  const pairs = new Map<string, TfsPerson>()
  const taken = new Set<string>()

  // 1. The account itself.
  for (const member of roster) {
    const account = accountOf(member.tfsIdentity)
    if (!account) continue
    const person = people.find(
      (p) => !taken.has(p.id) && p.uniqueName?.trim().toLowerCase() === account
    )
    if (person) {
      pairs.set(member.id, person)
      taken.add(person.id)
    }
  }

  // 2. Names, one confidence level at a time.
  const ambiguous = new Map<string, Set<string>>()
  for (const level of [3, 2, 1]) {
    const open = roster.filter((member) => !pairs.has(member.id))
    const free = people.filter((person) => !taken.has(person.id))
    for (const member of open) {
      const candidates = free.filter((person) => nameScore(member, person) >= level)
      if (candidates.length === 0) continue
      const [person] = candidates
      const rivals = open.filter((other) => nameScore(other, person) >= level)
      if (candidates.length === 1 && rivals.length === 1 && !taken.has(person.id)) {
        pairs.set(member.id, person)
        taken.add(person.id)
      } else {
        for (const candidate of candidates) {
          const names = ambiguous.get(candidate.id) ?? new Set<string>()
          names.add(member.name)
          ambiguous.set(candidate.id, names)
        }
      }
    }
  }

  const rows: SyncRow[] = []
  for (const member of roster) {
    const person = pairs.get(member.id)
    if (!person) {
      rows.push({ kind: 'keep', key: `keep:${member.id}`, member })
      continue
    }
    const identity = identityOf(person)
    rows.push(
      member.tfsIdentity?.trim().toLowerCase() === identity.toLowerCase()
        ? { kind: 'linked', key: `linked:${member.id}`, member, person }
        : { kind: 'link', key: `link:${member.id}`, member, person, identity }
    )
  }
  for (const person of people) {
    if (taken.has(person.id)) continue
    rows.push({
      kind: 'add',
      key: `add:${person.id}`,
      person,
      identity: identityOf(person),
      name: rosterName(person.displayName),
      maybe: [...(ambiguous.get(person.id) ?? [])]
    })
  }
  return rows
}

/**
 * The changes ticked by default: every link, every clear addition, and every member kept. An
 * addition that might be someone already on the roster is left for the user to decide, since
 * ticking it would give that person two rows.
 */
export function defaultChoices(rows: SyncRow[]): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.kind === 'link' ||
          row.kind === 'keep' ||
          (row.kind === 'add' && row.maybe.length === 0)
      )
      .map((row) => row.key)
  )
}

/** The roster after applying the ticked rows. Order is kept; additions go at the end. */
export function applySquadSync(roster: Member[], rows: SyncRow[], chosen: Set<string>): Member[] {
  const links = new Map<string, string>()
  const dropped = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'link' && chosen.has(row.key)) links.set(row.member.id, row.identity)
    if (row.kind === 'keep' && !chosen.has(row.key)) dropped.add(row.member.id)
  }

  const next: Member[] = roster
    .filter((member) => !dropped.has(member.id))
    .map((member) =>
      links.has(member.id) ? { ...member, tfsIdentity: links.get(member.id) } : member
    )

  const used = new Set(roster.map((member) => member.id))
  for (const row of rows) {
    if (row.kind !== 'add' || !chosen.has(row.key)) continue
    const id = idFor(row.person, used)
    used.add(id)
    next.push({ id, name: row.name, tfsIdentity: row.identity, order: next.length })
  }
  return next.map((member, order) => ({ ...member, order }))
}

/**
 * A row id for someone added from TFS, taken from their TFS id rather than counted.
 *
 * Counting — `member-8` because there are seven — can hand out the id of someone removed a
 * moment ago, and the open sprint still has that person's row: the newcomer would be mistaken
 * for them, work and all. An id from the account cannot collide with a counted one, and gives
 * the same person the same row if they leave the roster and come back.
 */
function idFor(person: TfsPerson, used: Set<string>): string {
  const base = `tfs-${person.id.toLowerCase().replace(/[^a-z0-9-]+/g, '')}`
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Brings the open sprint's rows in line with a roster: identities are updated, and people the
 * sprint has never had are added as empty rows at the bottom.
 *
 * Nobody is removed and nobody is renamed or reordered. A sprint is a plan already under way —
 * a row may hold work, and rows jumping around mid-sprint would be far more confusing than a
 * roster that is briefly out of step with it.
 */
export function syncSprintMembers(sprint: Sprint, roster: Member[]): Sprint {
  const byId = new Map(roster.map((member) => [member.id, member]))
  let changed = false

  const members = sprint.members.map((member) => {
    const identity = byId.get(member.id)?.tfsIdentity
    if (identity === undefined || identity === member.tfsIdentity) return member
    changed = true
    return { ...member, tfsIdentity: identity }
  })

  const queues = { ...sprint.queues }
  const known = new Set(members.map((member) => member.id))
  let order = members.reduce((max, member) => Math.max(max, member.order), -1)
  for (const member of roster) {
    if (known.has(member.id)) continue
    changed = true
    members.push({ ...member, order: ++order })
    queues[member.id] = queues[member.id] ?? []
  }

  return changed ? { ...sprint, members, queues } : sprint
}
