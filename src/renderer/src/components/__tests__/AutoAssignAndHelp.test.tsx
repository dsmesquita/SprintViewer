import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AutoAssignDialog from '../AutoAssignDialog'
import HelpDialog from '../HelpDialog'
import { planAutoAssign } from '@shared/autoAssign'
import { block, ids, item, MON, sprint, TUE } from '../../../../../test/fixtures'

describe('AutoAssignDialog', () => {
  it('a plan that disturbs nothing is a count and a button', async () => {
    const s = sprint({
      items: [
        item(1, { assignedTo: 'Diogo Mesquita', remainingWork: 4 }),
        item(2, { remainingWork: 2 })
      ],
      backlog: [block('a', 1, 4), block('b', 2, 2)]
    })
    const allow = planAutoAssign(s, MON, { newId: ids() })
    const onApply = vi.fn()
    render(
      <AutoAssignDialog sprint={s} allow={allow} keep={null} onApply={onApply} onClose={() => {}} />
    )
    expect(screen.getByRole('dialog', { name: 'Assign 1 task?' })).toBeInTheDocument()
    expect(screen.getByText(/TFS names nobody on this team/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Assign' }))
    expect(onApply).toHaveBeenCalledWith(allow)
  })

  it('a meeting too long for the last morning says why it stays behind', () => {
    // Only Friday 25, the sprint's last day, is left: 8h would run into its afternoon.
    const s = sprint({
      items: [item(1, { title: 'Meetings', assignedTo: 'Diogo Mesquita', remainingWork: 8 })],
      backlog: [block('m', 1, 8)]
    })
    const allow = planAutoAssign(s, '2026-09-25', { newId: ids() })
    render(
      <AutoAssignDialog
        sprint={s}
        allow={allow}
        keep={null}
        onApply={() => {}}
        onClose={() => {}}
      />
    )
    expect(
      screen.getByText(/^meeting stays in the backlog — only the sprint's last day is left/)
    ).toBeInTheDocument()
  })

  it('nothing to assign says why', () => {
    const s = sprint({ items: [item(2, { remainingWork: 2 })], backlog: [block('b', 2, 2)] })
    const allow = planAutoAssign(s, MON, { newId: ids() })
    render(
      <AutoAssignDialog
        sprint={s}
        allow={allow}
        keep={null}
        onApply={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByRole('dialog', { name: 'Nothing to assign' })).toBeInTheDocument()
  })

  it('a plan that would move planned work names it, and offers to keep the calendar fixed', async () => {
    // The VAL must start when Diogo's DEV ends, which cuts into Sofia's planned work.
    const s = sprint({
      items: [
        item(900, { type: 'User Story', title: 'Story' }),
        item(10, {
          title: 'DEV:: Export',
          parentId: 900,
          assignedTo: 'Diogo Mesquita',
          remainingWork: 5
        }),
        item(11, {
          title: 'VAL:: Export',
          parentId: 900,
          assignedTo: 'Sofia Marques',
          remainingWork: 3
        }),
        item(20, { title: 'Busy', assignedTo: 'Diogo Mesquita', remainingWork: 6 }),
        item(21, { title: 'DEV:: Other', assignedTo: 'Sofia Marques', remainingWork: 16 })
      ],
      queues: { diogo: [block('x', 20, 6)], sofia: [block('y', 21, 16)] },
      backlog: [block('dev', 10, 5), block('val', 11, 3)]
    })
    const allow = planAutoAssign(s, TUE, { newId: ids() })
    const keep = planAutoAssign(s, TUE, { keepBase: true, newId: ids() })
    const onApply = vi.fn()
    render(
      <AutoAssignDialog sprint={s} allow={allow} keep={keep} onApply={onApply} onClose={() => {}} />
    )
    expect(
      screen.getByRole('dialog', { name: 'Auto-assign would change your calendar' })
    ).toBeInTheDocument()
    expect(screen.getByText('#21 DEV:: Other')).toBeInTheDocument()
    expect(screen.getByText(/right after its DEV/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Keep my calendar fixed' }))
    expect(onApply).toHaveBeenLastCalledWith(keep)
    await user.click(screen.getByRole('button', { name: 'Allow changes' }))
    expect(onApply).toHaveBeenLastCalledWith(allow)
  })
})

describe('HelpDialog', () => {
  it('every section can be reached from the contents, and Previous/Next stop at the ends', async () => {
    const user = userEvent.setup()
    render(<HelpDialog onClose={() => {}} />)
    const contents = screen.getByRole('navigation', { name: 'Contents' })
    const entries = contents.querySelectorAll('button')
    expect(entries.length).toBeGreaterThanOrEqual(10)

    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    for (const entry of entries) {
      await user.click(entry)
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        entry.textContent!.replace(/^\d+/, '')
      )
    }
    expect(
      screen.getAllByRole('button').find((b) => b.textContent?.includes('Next'))
    ).toBeDisabled()
  })

  it('screenshots of the app sit in their sections, each with a caption', async () => {
    render(<HelpDialog onClose={() => {}} />)
    // The first section opens on the whole window.
    const shot = screen.getByRole('img', { name: /a row per person/ })
    expect(shot.closest('figure')).toHaveTextContent(/a row per person/)
    expect(shot.getAttribute('src')).toMatch(/overview\.png/)
    const notes = [...document.querySelectorAll<HTMLElement>('.help-toc-item')].find((item) =>
      item.textContent?.trim().endsWith('Notes')
    )!
    await userEvent.setup().click(notes)
    expect(screen.getByRole('img', { name: /Adding a note/ })).toBeInTheDocument()
  })

  it('Close calls back', async () => {
    const onClose = vi.fn()
    render(<HelpDialog onClose={onClose} />)
    await userEvent.setup().click(screen.getByText('Close', { selector: 'button' }))
    expect(onClose).toHaveBeenCalled()
  })
})
