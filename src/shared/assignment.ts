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
 * Whether two names plausibly refer to the same person: the full name, else the first name,
 * else the last name — in that order of confidence, all compared with accents and case
 * stripped, since TFS and the team roster rarely spell them the same way.
 *
 * Deliberately generous. A false match costs nothing but a missing prompt; a false mismatch
 * would nag on every correct drop, which is how a warning gets ignored.
 */
export function sameName(a: string, b: string): boolean {
  const left = partsOf(a)
  const right = partsOf(b)
  if (!left || !right) return false
  return left.full === right.full || left.first === right.first || left.last === right.last
}

/** True when the TFS assignee looks like this team member, under any of their known names. */
export function memberMatches(member: Member, assignee: string): boolean {
  return [member.name, member.tfsIdentity]
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .some((name) => sameName(name, assignee))
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
  if (memberMatches(member, item.assignedTo ?? '')) return null

  return { assignee, memberName: member.name, workItemId }
}
