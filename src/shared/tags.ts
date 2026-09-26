import type { Block, Sprint } from './types'

/**
 * Task titles carry a discipline tag at the front: `DEV:: Export service`, `[TEST] Smoke run`,
 * `E2E :: Checkout`. The panel groups by it so one discipline can be hidden while planning.
 */

/** Tasks with no recognisable prefix. Not a real tag, so it is never abbreviated away. */
export const UNTAGGED = 'Others'

/**
 * How far into the title a tag may reach. A prefix is a short label by convention; without a
 * bound, a `::` or a bracket pair anywhere in a sentence would be read as one.
 */
const WINDOW = 7

/**
 * The tag a title declares, or `Others`.
 *
 * Only the first {@link WINDOW} characters are considered, and for the bracket form the
 * closing bracket has to fall inside them too — otherwise `[Fix the export] pipeline` would
 * pass as a tag.
 *
 * The `::` form is trimmed, which is the whole point of `E2E ::`: the space before the colons
 * is spacing, not part of the name, so it has to land on the same tag as `E2E::`.
 */
export function tagOf(title: string): string {
  const head = title.slice(0, WINDOW)

  const colons = head.indexOf('::')
  if (colons > 0) return clean(head.slice(0, colons))

  const open = head.indexOf('[')
  if (open >= 0) {
    const close = head.indexOf(']', open + 1)
    if (close > open + 1) return clean(head.slice(open + 1, close))
  }

  return UNTAGGED
}

/**
 * The title with its tag taken off: `DEV:: Export service` gives `Export service`. A title
 * with no recognisable tag comes back as it is.
 */
export function untagged(title: string): string {
  if (tagOf(title) === UNTAGGED) return title.trim()
  const head = title.slice(0, WINDOW)
  const colons = head.indexOf('::')
  const cut = colons > 0 ? colons + 2 : head.indexOf(']') + 1
  return title.slice(cut).trim()
}

/**
 * Tags are compared case-insensitively, so `dev::` and `DEV::` are one tag rather than two
 * that look alike in a filter row. Upper case is how they are nearly always written.
 */
function clean(raw: string): string {
  const tag = raw.trim().toUpperCase()
  return tag.length === 0 ? UNTAGGED : tag
}

/** The tag on the work item a block belongs to. */
export function tagForBlock(sprint: Sprint, block: Block): string {
  const item = sprint.workItems[block.workItemId]
  return item ? tagOf(item.title) : UNTAGGED
}

export interface TagCount {
  tag: string
  count: number
  hours: number
}

/**
 * Every tag present in the given blocks, with how much work carries it. Ordered by how much
 * there is, with `Others` last however big it is — it is the leftovers, not a discipline.
 */
export function tagCounts(sprint: Sprint, blocks: Block[]): TagCount[] {
  const counts = new Map<string, TagCount>()
  for (const block of blocks) {
    const tag = tagForBlock(sprint, block)
    const entry = counts.get(tag) ?? { tag, count: 0, hours: 0 }
    entry.count += 1
    entry.hours = Math.round((entry.hours + block.hours) * 100) / 100
    counts.set(tag, entry)
  }

  const ordered = [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return [
    ...ordered.filter((entry) => entry.tag !== UNTAGGED),
    ...ordered.filter((entry) => entry.tag === UNTAGGED)
  ]
}

/**
 * Whether a block passes the tag filter.
 *
 * The sprint stores the tags that are *hidden* rather than the ones shown, so a tag that
 * turns up later — a refresh bringing in the first `[TEST]` task of the sprint — is visible
 * by default instead of silently filtered out by a list written before it existed.
 */
export function isTagVisible(sprint: Sprint, block: Block): boolean {
  const hidden = sprint.hiddenTags
  if (!hidden || hidden.length === 0) return true
  return !hidden.includes(tagForBlock(sprint, block))
}

/** Shows or hides one tag, leaving the rest as they are. */
export function toggleTag(sprint: Sprint, tag: string): Sprint {
  const hidden = sprint.hiddenTags ?? []
  return {
    ...sprint,
    hiddenTags: hidden.includes(tag)
      ? hidden.filter((other) => other !== tag)
      : [...hidden, tag]
  }
}

/** Clears the filter. */
export function showAllTags(sprint: Sprint): Sprint {
  return sprint.hiddenTags && sprint.hiddenTags.length > 0
    ? { ...sprint, hiddenTags: [] }
    : sprint
}
