import { shownBacklog } from '@shared/hiddenBacklog'
import type { MemberLayout } from '@shared/scheduling'
import { cx, hours } from '../../format'
import { ChevronIcon } from '../../icons'
import { useApp, useSprint } from '../../store'
import type { BlockContextMenu, GroupContextMenu } from './types'
import Backlog from './Backlog'
import PersonPanel from './PersonPanel'
import TaskPanel from './TaskPanel'

/**
 * The panel on the right, with its three tabs.
 *
 *   Backlog.tsx      what is not on a calendar yet, grouped under its story, with search and tags
 *   TaskCard.tsx     one backlog card (draggable)
 *   PersonPanel.tsx  a person's capacity, planned hours and notes
 *   TaskPanel.tsx    one task: its hours, where it is, its notes, and what can be done with it
 *   TimeFields.tsx   the estimate / completed / remaining / manual figures, and which one counts
 *   NoteCard.tsx     one note
 */

interface Props {
  layouts: Record<string, MemberLayout>
  onBlockContextMenu: BlockContextMenu
  onGroupContextMenu: GroupContextMenu
}

export default function SidePanel({
  layouts,
  onBlockContextMenu,
  onGroupContextMenu
}: Props): JSX.Element {
  const collapsed = useApp((s) => s.panelCollapsed)
  const togglePanel = useApp((s) => s.togglePanel)
  const tab = useApp((s) => s.panelTab)
  const setPanelTab = useApp((s) => s.setPanelTab)
  const sprint = useSprint()
  const selectedMemberId = useApp((s) => s.selectedMemberId)
  const selectedWorkItemId = useApp((s) => s.selectedWorkItemId)
  const member = sprint.members.find((m) => m.id === selectedMemberId)
  const task = selectedWorkItemId === null ? undefined : sprint.workItems[selectedWorkItemId]

  if (collapsed) {
    return (
      <aside className="panel is-collapsed">
        <div className="panel-head" style={{ justifyContent: 'center', padding: 8 }}>
          <button type="button" className="ghost" onClick={togglePanel} title="Expand panel">
            <ChevronIcon direction="left" />
          </button>
        </div>
        <div className="panel-collapsed-label">
          Backlog · {hours(shownBacklog(sprint).reduce((sum, b) => sum + b.hours, 0))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-tabs">
          <button
            type="button"
            className={cx('tab', tab === 'backlog' && 'is-active')}
            onClick={() => setPanelTab('backlog')}
          >
            Backlog
          </button>
          <button
            type="button"
            className={cx('tab', tab === 'person' && 'is-active')}
            onClick={() => setPanelTab('person')}
            disabled={!member}
            title={member ? `${member.name}'s notes and capacity` : 'Select a person in the grid'}
          >
            {member ? member.name : 'Person'}
          </button>
          <button
            type="button"
            className={cx('tab', tab === 'task' && 'is-active')}
            onClick={() => setPanelTab('task')}
            disabled={!task}
            title={task ? `#${task.id} ${task.title}` : 'Click a task on the calendar'}
          >
            Task
          </button>
        </div>
        <button type="button" className="ghost" onClick={togglePanel} title="Collapse panel">
          <ChevronIcon direction="right" />
        </button>
      </div>

      <div className="panel-body">
        {tab === 'task' && task ? (
          <TaskPanel workItemId={task.id} />
        ) : tab === 'person' && member ? (
          <PersonPanel memberId={member.id} layout={layouts[member.id]} />
        ) : (
          <Backlog
            onBlockContextMenu={onBlockContextMenu}
            onGroupContextMenu={onGroupContextMenu}
          />
        )}
      </div>
    </aside>
  )
}
