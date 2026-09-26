import { plannedHours } from './sizing'
import type { Block, Member, Sprint, WorkItem } from './types'

/**
 * Creating Tasks under a Bug or User Story, in TFS.
 *
 * The one place the app writes to the server. Everything here is the part that does not need
 * the network: what a request asks for, what the titles look like, and how the answer is
 * folded back into the sprint.
 */

/** One task to create. */
export interface TaskDraft {
  title: string
  /** What goes in Assigned To — a TFS identity where one is known. Absent leaves it unassigned. */
  assignedTo?: string
  /**
   * Original Estimate, which Remaining Work is also set to: a task that has just been created
   * has all of its estimate still to do. Zero sets neither.
   */
  estimate: number
  /**
   * The task's TFS tags. Absent copies the parent's, which is what a task under a story almost
   * always wants; a list — even an empty one — is used exactly as given.
   */
  tags?: string[]
}

export interface CreateTasksResult {
  created: WorkItem[]
  /**
   * Tasks the server refused, with its reason and their position in the request, so they can
   * be offered again without the ones that did go through. The ones before them still exist.
   */
  failures: Array<{ index: number; title: string; message: string }>
}

/** A named set of discipline prefixes, applied as one task per prefix. */
export interface TaskTemplate {
  name: string
  prefixes: string[]
}

export const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [{ name: 'DEV + VAL', prefixes: ['DEV', 'VAL'] }]

/** `DEV` and `Export service` make `DEV:: Export service` — the house style for task titles. */
export function taggedTitle(prefix: string, title: string): string {
  const tag = prefix.trim().replace(/:+$/, '').trim().toUpperCase()
  return tag.length === 0 ? title : `${tag}:: ${title}`
}

/** The domain an account name is taken to be in when it is typed without one. */
export const DEFAULT_DOMAIN = 'CMF'

/** The owner list's entry for somebody who is not on the team. */
export const OTHER_OWNER = '__other__'

/**
 * A TFS account typed by hand, in the form TFS takes for Assigned To — or null when what was
 * typed cannot be one.
 *
 * All of these name the same person: `bsrocha`, `CMF\bsrocha`, `<CMF\bsrocha>` and
 * `Beatriz Rocha <CMF\bsrocha>`. A bare account gets the {@link DEFAULT_DOMAIN}, angle
 * brackets on their own are dropped, and a display name with the account after it is kept
 * whole, since TFS resolves that form too. A bare name with a space in it is a display name,
 * not an account, and is refused: TFS would guess, and could guess wrong.
 */
export function normaliseIdentity(input: string): string | null {
  const text = input.trim()
  if (text.length === 0) return null

  const named = /^(.*?)\s*<\s*([^<>]+?)\s*>$/.exec(text)
  if (named) {
    const account = withDomain(named[2])
    if (!account) return null
    const name = named[1].trim()
    return name.length > 0 ? `${name} <${account}>` : account
  }
  if (/[<>]/.test(text)) return null
  return withDomain(text)
}

function withDomain(account: string): string | null {
  const text = account.trim()
  if (text.length === 0 || /\s/.test(text)) return null
  const slash = text.indexOf('\\')
  if (slash < 0) return `${DEFAULT_DOMAIN}\\${text}`
  const domain = text.slice(0, slash)
  const user = text.slice(slash + 1)
  if (domain.length === 0 || user.length === 0 || user.includes('\\')) return null
  return `${domain.toUpperCase()}\\${user}`
}

/** True when a saved owner is an account typed by hand rather than a team member's id. */
export function isIdentity(value: string | undefined): boolean {
  return value !== undefined && value.includes('\\')
}

/**
 * Tags typed as a list: split on commas or semicolons — TFS itself separates them with
 * semicolons — trimmed, blanks dropped, and each kept once whatever its case.
 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of text.split(/[;,]/)) {
    const tag = raw.trim()
    if (tag.length === 0 || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  return tags
}

/**
 * What to put in Assigned To for a team member.
 *
 * The TFS identity when the roster has one, since it names exactly one account. The roster
 * name otherwise, which TFS resolves itself when it is unambiguous and rejects when it is not
 * — a refusal that is shown next to the task rather than a task silently given to someone else.
 */
export function assigneeFor(member: Member | undefined): string | undefined {
  if (!member) return undefined
  const identity = member.tfsIdentity?.trim()
  return identity && identity.length > 0 ? identity : member.name.trim() || undefined
}

/**
 * Folds newly created tasks into the sprint: their work items are recorded, and each gets a
 * card in the backlog, sized the same way an import sizes one.
 *
 * The backlog rather than a calendar, even though every task has an owner by now. Where on
 * that person's calendar it goes is a planning decision, and auto-assign is where those are
 * made.
 */
export function addCreatedTasks(
  sprint: Sprint,
  items: WorkItem[],
  newId: () => string
): Sprint {
  if (items.length === 0) return sprint
  const workItems = { ...sprint.workItems }
  const cards: Block[] = []
  for (const item of items) {
    const known = workItems[item.id] !== undefined
    workItems[item.id] = item
    if (!known) cards.push({ id: newId(), workItemId: item.id, hours: plannedHours(item) })
  }
  return { ...sprint, workItems, backlog: [...sprint.backlog, ...cards] }
}
