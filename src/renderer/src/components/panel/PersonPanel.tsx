import { formatDayHeader } from '@shared/dates'
import { effectiveCapacity, type MemberLayout } from '@shared/scheduling'
import { cx, hours } from '../../format'
import { useApp, useSprint } from '../../store'
import NoteCard from './NoteCard'

interface PersonProps {
  memberId: string
  layout: MemberLayout
}

export default function PersonPanel({ memberId, layout }: PersonProps): JSX.Element {
  const sprint = useSprint()
  const openNote = useApp((s) => s.openNote)
  const member = sprint.members.find((m) => m.id === memberId)
  const notes = sprint.notes.filter((note) => note.memberId === memberId)
  const free = layout.availableHours - layout.queuedHours

  const reducedDays = sprint.days
    .filter((day) => effectiveCapacity(sprint, memberId, day.date) < sprint.hoursPerDay)
    .map((day) => {
      const capacity = effectiveCapacity(sprint, memberId, day.date)
      const teamWide = day.capacity <= capacity
      return {
        date: day.date,
        capacity,
        text: `${formatDayHeader(day.date)} · ${capacity <= 0 ? 'off' : hours(capacity)}${
          teamWide ? ` (${day.label ?? 'team'})` : ''
        }`
      }
    })

  return (
    <>
      <p className="section-title">Capacity</p>
      <div className="stat-row">
        <span className="k">Scheduled from today</span>
        <span className="v">{hours(layout.queuedHours)}</span>
      </div>
      <div className="stat-row">
        <span className="k">Available in sprint</span>
        <span className="v">{hours(layout.availableHours)}</span>
      </div>
      <div className="stat-row">
        <span className="k">{layout.spillover > 0 ? 'Spillover' : 'Free'}</span>
        <span className={cx('v', layout.spillover > 0 && 'is-danger')}>
          {hours(layout.spillover > 0 ? layout.spillover : free)}
        </span>
      </div>

      {reducedDays.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: 16 }}>
            Days off and part days
          </p>
          <div>
            {reducedDays.map((day) => (
              <span key={day.date} className="day-off-pill">
                {day.text}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <p className="section-title" style={{ margin: 0, flex: 1 }}>
          Notes {notes.length > 0 && `· ${notes.length}`}
        </p>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: 12, padding: '2px 8px' }}
          onClick={() => openNote({ memberId })}
        >
          Add note
        </button>
      </div>
      {notes.length === 0 ? (
        <p className="empty">No notes for {member?.name} yet.</p>
      ) : (
        notes.map((note) => <NoteCard key={note.id} note={note} />)
      )}
    </>
  )
}
