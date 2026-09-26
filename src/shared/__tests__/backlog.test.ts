import { describe, expect, it } from 'vitest'
import {
  emptyGroupsFor,
  groupBlocks,
  isContainerType,
  parentIdsIn,
  schedulableItems,
  searchTextFor
} from '@shared/grouping'
import {
  isTagVisible,
  showAllTags,
  tagCounts,
  tagForBlock,
  tagOf,
  toggleTag,
  UNTAGGED,
  untagged
} from '@shared/tags'
import { matches, normalize } from '@shared/text'
import { block, item, sprint } from '../../../test/fixtures'

/** What the backlog panel is built from: grouping, tags and search. */

const story = (id: number, title = `Story ${id}`) => item(id, { type: 'User Story', title })

describe('grouping', () => {
  it('knows which work item types are headings rather than work', () => {
    for (const t of [
      'User Story',
      'bug',
      ' Feature ',
      'Epic',
      'Product Backlog Item',
      'Requirement'
    ]) {
      expect(isContainerType(t)).toBe(true)
    }
    expect(isContainerType('Task')).toBe(false)
  })

  it('parentIdsIn and schedulableItems', () => {
    const items = [story(1), item(10, { parentId: 1 }), item(11, { parentId: 1 }), item(12)]
    expect([...parentIdsIn(items)]).toEqual([1])
    expect(schedulableItems(items).map((i) => i.id)).toEqual([10, 11, 12])
  })

  it('groups cards under their parent, orphans last, headings never as cards', () => {
    const s = sprint({
      items: [story(1), story(2), item(10, { parentId: 1 }), item(20, { parentId: 2 }), item(30)],
      backlog: [block('o', 30, 1), block('a', 10, 2.5), block('b', 20, 3), block('s', 1, 5)]
    })
    const groups = groupBlocks(s, s.backlog)
    expect(groups.map((g) => [g.key, g.blocks.map((b) => b.id), g.hours])).toEqual([
      ['1', ['a'], 2.5],
      ['2', ['b'], 3],
      ['none', ['o'], 1]
    ])
    expect(groups[0].parent?.title).toBe('Story 1')
  })

  it('empty headings: a story with no tasks, and one whose tasks are all scheduled', () => {
    const s = sprint({
      items: [story(1), story(2), story(3), item(20, { parentId: 2 }), item(30, { parentId: 3 })],
      queues: { diogo: [block('x', 20, 2)] },
      backlog: [block('y', 30, 2)]
    })
    const empties = emptyGroupsFor(s)
    expect(empties.map((e) => [e.item.id, e.reason, e.taskCount])).toEqual([
      [1, 'no-tasks', 0],
      [2, 'all-scheduled', 1]
    ])
    // They go after groups with work in them and before the orphans.
    const groups = groupBlocks(s, s.backlog, empties)
    expect(groups.map((g) => [g.key, g.empty?.reason])).toEqual([
      ['3', undefined],
      ['1', 'no-tasks'],
      ['2', 'all-scheduled']
    ])
  })

  it('searchTextFor covers id, title, type, assignee and the parent', () => {
    const s = sprint({
      items: [
        story(1, 'Exportação'),
        item(10, { parentId: 1, title: 'Fix it', assignedTo: 'Sofia Marques <CMF\\smarques>' })
      ]
    })
    const text = searchTextFor(s, block('a', 10, 1))
    for (const part of ['10', 'Fix it', 'Task', 'Sofia Marques', '1', 'Exportação'])
      expect(text).toContain(part)
    expect(searchTextFor(s, block('z', 99, 1))).toBe('99')
  })
})

describe('tags', () => {
  it('reads the tag from the start of the title', () => {
    expect(tagOf('DEV:: Export')).toBe('DEV')
    expect(tagOf('dev :: Export')).toBe('DEV')
    expect(tagOf('[Test] Migration')).toBe('TEST')
    expect(tagOf('E2E:: Flaky')).toBe('E2E')
  })

  it('only near the start: a colon pair or bracket later on is not a tag', () => {
    expect(tagOf('Export service:: part two')).toBe(UNTAGGED)
    expect(tagOf('Review [DEV] notes')).toBe(UNTAGGED)
    expect(tagOf('[] empty')).toBe(UNTAGGED)
    expect(tagOf('Plain title')).toBe(UNTAGGED)
  })

  it('untagged strips it', () => {
    expect(untagged('DEV:: Export')).toBe('Export')
    expect(untagged('[TEST] Migration ')).toBe('Migration')
    expect(untagged(' Meetings ')).toBe('Meetings')
  })

  it('counts per tag, most first, Others always last', () => {
    const s = sprint({
      items: [
        item(1, { title: 'DEV:: a' }),
        item(2, { title: 'DEV:: b' }),
        item(3, { title: 'VAL:: c' }),
        item(4, { title: 'plain' })
      ]
    })
    const blocks = [
      block('1', 1, 2),
      block('2', 2, 1.5),
      block('3', 3, 1),
      block('4', 4, 9),
      block('5', 99, 1)
    ]
    expect(tagCounts(s, blocks)).toEqual([
      { tag: 'DEV', count: 2, hours: 3.5 },
      { tag: 'VAL', count: 1, hours: 1 },
      { tag: UNTAGGED, count: 2, hours: 10 }
    ])
    expect(tagForBlock(s, block('x', 99, 1))).toBe(UNTAGGED)
  })

  it('hiding and showing tags', () => {
    const s = sprint({ items: [item(1, { title: 'DEV:: a' })] })
    const hidden = toggleTag(s, 'DEV')
    expect(isTagVisible(hidden, block('a', 1, 1))).toBe(false)
    expect(isTagVisible(toggleTag(hidden, 'DEV'), block('a', 1, 1))).toBe(true)
    expect(showAllTags(hidden).hiddenTags).toEqual([])
    expect(showAllTags(s)).toBe(s)
  })
})

describe('text search', () => {
  it('normalize: no accents, lower case, punctuation to spaces', () => {
    expect(normalize('  Validação — Sessão/Expirada!  ')).toBe('validacao sessao expirada')
  })

  it('matches ignores accents and case; an empty query matches everything', () => {
    expect(matches('Validação de sessão', 'SESSAO')).toBe(true)
    expect(matches('Validação de sessão', 'login')).toBe(false)
    expect(matches('anything', '   ')).toBe(true)
  })
})
