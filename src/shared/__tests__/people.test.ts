import { describe, expect, it } from 'vitest'
import { checkAssignment, displayName, memberFor } from '@shared/assignment'
import {
  addDays,
  buildSprintDays,
  formatDayHeader,
  formatRange,
  fromISO,
  isWeekend,
  startOfWeek,
  toISO
} from '@shared/dates'
import {
  addNote,
  deleteNote,
  holderOf,
  NOTE_CATEGORIES,
  updateNote,
  validCategory,
  type NoteDraft
} from '@shared/notes'
import { addCreatedTasks, assigneeFor, taggedTitle } from '@shared/taskCreation'
import { block, DIOGO, ids, item, MON, sprint } from '../../../test/fixtures'

describe('names and assignment', () => {
  it('displayName strips the account and the domain', () => {
    expect(displayName('Sofia Marques <CMF\\smarques>')).toBe('Sofia Marques')
    expect(displayName('CMF\\smarques')).toBe('smarques')
    expect(displayName('sofia@example.com')).toBe('sofia')
    expect(displayName(undefined)).toBe('')
  })

  it('memberFor: the same person however TFS writes them', () => {
    const bruno = { id: 'b', name: 'Bruno Sá', order: 0 }
    const beatriz = { id: 'r', name: 'Beatriz Rocha', order: 1 }
    const joao = { id: 'j', name: 'João', order: 2 }
    const roster = [bruno, beatriz, joao]
    expect(memberFor(roster, 'Sá, Bruno')).toBe(bruno)
    expect(memberFor(roster, 'Beatriz Rocha <CMF\\bsrocha>')).toBe(beatriz)
    expect(memberFor(roster, 'joao')).toBe(joao)
    expect(memberFor(roster, '')).toBeUndefined()
    expect(memberFor(roster, undefined)).toBeUndefined()
  })

  it('memberFor: the row name or the TFS identity', () => {
    const bia = { id: 'x', name: 'Bia', tfsIdentity: 'Beatriz Rocha', order: 0 }
    expect(memberFor([bia], 'Beatriz Rocha')).toBe(bia)
    expect(memberFor([bia], 'Bia')).toBe(bia)
  })

  it('memberFor: a first or last name alone counts when one person has it', () => {
    // A roster of first names, as most squads write it.
    const diogo = { id: 'd', name: 'Diogo', order: 0 }
    const ana = { id: 'a', name: 'Ana Silva', order: 1 }
    expect(memberFor([diogo, ana], 'Diogo Mesquita <CMF\\dmesquita>')).toBe(diogo)
    expect(memberFor([diogo, ana], 'Maria Silva')).toBe(ana)
    expect(memberFor([diogo, ana], 'Rui Costa')).toBeUndefined()
  })

  it('memberFor: with two people sharing a name, only a full match picks one', () => {
    const mesquita = { id: 'm', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 }
    const silva = { id: 's', name: 'Diogo S.', tfsIdentity: 'Diogo Silva', order: 1 }
    const roster = [mesquita, silva]
    expect(memberFor(roster, 'Diogo Silva')).toBe(silva)
    expect(memberFor(roster, 'Silva, Diogo')).toBe(silva)
    expect(memberFor(roster, 'Diogo Mesquita')).toBe(mesquita)
    // Shares the first name with both: neither is guessed.
    expect(memberFor(roster, 'Diogo Santos')).toBeUndefined()
    // Ambiguous first name, but only one Silva: the last name settles it.
    expect(memberFor(roster, 'Diogo A. Silva')).toBe(silva)
  })

  it('checkAssignment flags a drop on someone TFS does not name', () => {
    const s = sprint({ items: [item(1, { assignedTo: 'Sofia Marques' }), item(2)] })
    expect(checkAssignment(s, 1, 'diogo')).toEqual({
      assignee: 'Sofia Marques',
      memberName: 'Diogo',
      workItemId: 1
    })
    expect(checkAssignment(s, 1, 'sofia')).toBeNull()
    expect(checkAssignment(s, 2, 'diogo')).toBeNull() // nobody assigned: nothing to contradict
    expect(checkAssignment(s, 99, 'diogo')).toBeNull()
  })

  it('checkAssignment asks about a drop on the wrong one of two people sharing a name', () => {
    const mesquita = { id: 'm', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 }
    const silva = { id: 's', name: 'Diogo S.', tfsIdentity: 'Diogo Silva', order: 1 }
    const s = sprint({
      members: [mesquita, silva],
      items: [item(1, { assignedTo: 'Diogo Silva' }), item(2, { assignedTo: 'Diogo Santos' })]
    })
    expect(checkAssignment(s, 1, 's')).toBeNull()
    expect(checkAssignment(s, 1, 'm')).toMatchObject({
      assignee: 'Diogo Silva',
      memberName: 'Diogo'
    })
    // Someone off the roster: either row is worth a question.
    expect(checkAssignment(s, 2, 'm')).not.toBeNull()
    expect(checkAssignment(s, 2, 's')).not.toBeNull()
  })
})

describe('dates', () => {
  it('round-trips ISO dates in local time', () => {
    expect(toISO(fromISO('2026-02-28'))).toBe('2026-02-28')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('weeks start on Monday; Sunday belongs to the week before', () => {
    expect(startOfWeek('2026-09-16')).toBe(MON)
    expect(startOfWeek('2026-09-20')).toBe(MON)
    expect(isWeekend('2026-09-19')).toBe(true)
    expect(isWeekend(MON)).toBe(false)
  })

  it('formats headers and ranges', () => {
    expect(formatDayHeader('2026-09-01')).toBe('Tue 01/09')
    expect(formatRange('2026-09-28', '2026-10-09')).toBe('28 Sep – 9 Oct')
  })

  it('buildSprintDays: weekdays only by default, across a month end', () => {
    const days = buildSprintDays('2026-09-28', 2, 6)
    expect(days).toHaveLength(10)
    expect(days[0]).toEqual({ date: '2026-09-28', capacity: 6 })
    expect(days.map((d) => d.date)).toContain('2026-10-01')
    expect(days.some((d) => isWeekend(d.date))).toBe(false)
  })

  it('buildSprintDays with weekends, and other lengths', () => {
    expect(buildSprintDays(MON, 1, 8, true)).toHaveLength(7)
    expect(buildSprintDays(MON, 3, 8)).toHaveLength(15)
  })
})

describe('notes', () => {
  const draft: NoteDraft = {
    memberId: 'diogo',
    text: '  Great demo  ',
    taskIds: [1, 1, 2],
    category: 'Agility'
  }

  it('adds a trimmed note with unique task ids and a known category', () => {
    const s = addNote(sprint(), draft, ids())
    expect(s.notes[0]).toMatchObject({
      id: 'n1',
      memberId: 'diogo',
      text: 'Great demo',
      taskIds: [1, 2],
      category: 'Agility'
    })
  })

  it('an unknown category is dropped, never stored', () => {
    const s = addNote(sprint(), { ...draft, category: 'Made up' } as unknown as NoteDraft, ids())
    expect('category' in s.notes[0]).toBe(false)
    expect(validCategory('Innovation')).toBe('Innovation')
    expect(validCategory(3)).toBeUndefined()
    expect(NOTE_CATEGORIES).toHaveLength(6)
  })

  it('updating can clear the category; deleting removes the note', () => {
    const s = addNote(sprint(), draft, ids())
    const updated = updateNote(s, 'n1', { ...draft, text: 'Edited', category: undefined })
    expect(updated.notes[0]).toMatchObject({ text: 'Edited' })
    expect('category' in updated.notes[0]).toBe(false)
    expect(deleteNote(updated, 'n1').notes).toEqual([])
  })

  it('holderOf finds who has a task on their calendar', () => {
    const s = sprint({ queues: { sofia: [block('a', 7, 2)] } })
    expect(holderOf(s, 7)).toBe('sofia')
    expect(holderOf(s, 8)).toBeUndefined()
  })
})

describe('creating tasks', () => {
  it('taggedTitle uses the house style, whatever the prefix looks like', () => {
    expect(taggedTitle('dev', 'Export')).toBe('DEV:: Export')
    expect(taggedTitle(' VAL:: ', 'Export')).toBe('VAL:: Export')
    expect(taggedTitle('  ', 'Export')).toBe('Export')
  })

  it('assigneeFor prefers the TFS identity, then the roster name', () => {
    expect(assigneeFor(DIOGO)).toBe('Diogo Mesquita')
    expect(assigneeFor({ id: 'x', name: ' Ana ', order: 0 })).toBe('Ana')
    expect(assigneeFor(undefined)).toBeUndefined()
  })

  it('addCreatedTasks records the items and adds one backlog card each, sized by Remaining', () => {
    const s = sprint({ items: [item(1, { remainingWork: 2 })], backlog: [block('old', 1, 2)] })
    const next = addCreatedTasks(
      s,
      [item(1, { remainingWork: 2 }), item(2, { remainingWork: 5, completedWork: 1 })],
      ids()
    )
    expect(next.backlog).toEqual([block('old', 1, 2), block('n1', 2, 5)])
    expect(next.workItems[2].remainingWork).toBe(5)
    expect(addCreatedTasks(s, [], ids())).toBe(s)
  })
})
