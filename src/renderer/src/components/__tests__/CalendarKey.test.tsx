import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CalendarKey from '../CalendarKey'

/** The ⓘ in the calendar's corner: the keys and the marks, on hover or focus. */

describe('CalendarKey', () => {
  it('shows the keys and the marks while hovered, and hides them after', () => {
    render(<CalendarKey />)
    const button = screen.getByRole('button', { name: 'Keys and marks' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.mouseEnter(button)
    const key = screen.getByRole('tooltip')
    expect(button).toHaveAttribute('aria-describedby', key.id)
    expect(key).toHaveTextContent('Move the selected task an hour')
    expect(key).toHaveTextContent('Scroll the calendar sideways')
    expect(key).toHaveTextContent('Right-click a task, a person’s name or a day for more options.')
    expect(key).toHaveTextContent('Locked day — settled: nothing moves on or off it.')
    expect(key).toHaveTextContent('Pinned task — keeps its hour; other work flows around it.')

    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens from the keyboard too', () => {
    render(<CalendarKey />)
    const button = screen.getByRole('button', { name: 'Keys and marks' })
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
