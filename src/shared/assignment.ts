import { normalize } from './text'
import type { Member, Sprint } from './types'

/**
 * Matching the person a work item is assigned to in TFS against the person a task is being
 * dropped on, so a slip can be caught before it becomes someone else's plan for the week.
 */

/**
 * The readable part of a TFS identity. They arrive as a display name, sometimes with the
 * account trailing in angle brackets, and sometimes as the account alone.
 */
export function displayName(identity: string | undefined): string {
  if (!identity) return ''
  const withoutAccount = identity.replace(/\s*<[^>]*>\s*$/, '').trim()
  const value = withoutAccount.length > 0 ? withoutAccount : identity.trim()
  // `DOMAIN\user` or an email: the surname-first form of neither, so take the local part.
  const local = value.includes('\\') ? value.slice(value.lastIndexOf('\\') + 1) : value
  return local.includes('@') ? local.slice(0, local.indexOf('@')) : local
}

interface NameParts {
  /**
   * The tokens sorted rather than in the order written, so `Sá, Bruno` and `Bruno Sá` are one
   * name — TFS is configured surname-first in plenty of collections.
   */
  full: string
  first: string
  last: string
}

function partsOf(value: string): NameParts | null {
  const tokens = normalize(displayName(value)).split(' ').filter(Boolean)
  if (tokens.length === 0) return null
  return {
    full: [...tokens].sort().join(' '),
    first: tokens[0],
    last: tokens[tokens.length - 1]
  }
}

/**
 * The roster member a TFS assignee is — or `undefined` when nobody on the roster is, or there is
 * no telling which one.
 *
 * TFS and the roster rarely spell a name alike, so names are compared with accents, case and
 * word order set aside, against both the row name and the TFS identity. A full name is the
 * surest sign, then a first name, then a last name — but a first or last name only counts when
 * one person alone has it: with two Diogos on the squad, "Diogo Santos" is neither of them.
 */
export function memberFor(members: Member[], assignee: string | undefined): Member | undefined {
  const wanted = partsOf(assignee ?? '')
  if (!wanted) return undefined

  const namesOf = (member: Member): NameParts[] =>
    [member.name, member.tfsIdentity]
      .map((name) => (name ? partsOf(name) : null))
      .filter((parts): parts is NameParts => parts !== null)
  const sharing = (part: keyof NameParts): Member[] =>
    members.filter((member) => namesOf(member).some((parts) => parts[part] === wanted[part]))

  const full = sharing('full')
  if (full.length > 0) return full[0]
  for (const part of ['first', 'last'] as const) {
    const found = sharing(part)
    if (found.length === 1) return found[0]
  }
  return undefined
}

export interface AssignmentMismatch {
  /** The person TFS has the work item assigned to, as it should be shown. */
  assignee: string
  /** The person the task is being dropped on. */
  memberName: string
  workItemId: number
}

/**
 * Checks a drop, returning the mismatch to confirm or `null` when there is nothing to query.
 *
 * An unassigned work item is not a mismatch: there is nothing to contradict, and prompting
 * for it would fire on most of a fresh import.
 */
export function checkAssignment(
  sprint: Sprint,
  workItemId: number,
  memberId: string
): AssignmentMismatch | null {
  const member = sprint.members.find((m) => m.id === memberId)
  const item = sprint.workItems[workItemId]
  if (!member || !item) return null

  const assignee = displayName(item.assignedTo)
  if (assignee.length === 0) return null
  if (memberFor(sprint.members, item.assignedTo)?.id === member.id) return null

  return { assignee, memberName: member.name, workItemId }
}
