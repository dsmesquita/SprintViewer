import { useDroppable } from '@dnd-kit/core'
import { emptyGroupsFor, groupBlocks, searchTextFor } from '@shared/grouping'
import { isTagVisible, tagCounts, tagOf } from '@shared/tags'
import { matches } from '@shared/text'
import { cx, hours } from '../../format'
import { BACKLOG_DROP_ID } from '../../grid'
import { FoldIcon } from '../../icons'
import { useApp, useSprint } from '../../store'
import type { BlockContextMenu, GroupContextMenu } from './types'
import TaskCard from './TaskCard'

export default function Backlog({
  onBlockContextMenu,
  onGroupContextMenu
}: {
  onBlockContextMenu: BlockContextMenu
  onGroupContextMenu: GroupContextMenu
}): JSX.Element {
  const sprint = useSprint()
  const highlight = useApp((s) => s.highlightWorkItem)
  const highlighted = useApp((s) => s.highlightedWorkItemId)
  const search = useApp((s) => s.backlogSearch)
  const setSearch = useApp((s) => s.setBacklogSearch)
  const collapsed = useApp((s) => s.collapsedGroups)
  const toggleGroup = useApp((s) => s.toggleGroup)
  const setCollapsedGroups = useApp((s) => s.setCollapsedGroups)
  const toggleTag = useApp((s) => s.toggleTag)
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG_DROP_ID })

  // Counted over the whole backlog rather than what is currently shown, so a chip never
  // vanishes while it is switched off — you would have no way to switch it back on.
  const tags = tagCounts(sprint, sprint.backlog)
  const hidden = sprint.hiddenTags ?? []

  // Filtering only hides cards. The backlog order is untouched, so clearing the filters puts
  // the list back exactly as it was. Both filters apply at once.
  const visible = sprint.backlog.filter(
    (block) => isTagVisible(sprint, block) && matches(searchTextFor(sprint, block), search)
  )
  // Containers with no cards under them keep a heading, so neither a bug nobody has broken
  // down nor a story whose tasks are all placed disappears from the list. Same two filters.
  const empties = emptyGroupsFor(sprint).filter(
    ({ item }) =>
      !hidden.includes(tagOf(item.title)) &&
      matches(`${item.id} ${item.title} ${item.type}`, search)
  )
  const groups = groupBlocks(sprint, visible, empties)
  const total = visible.reduce((sum, block) => sum + block.hours, 0)
  const searching = search.trim().length > 0
  const anyExpanded = groups.some((group) => !collapsed.includes(group.key))

  // A task that is already on someone's calendar is not in the backlog, so searching for it
  // finds nothing here. Saying how many matched elsewhere beats a bare "no results".
  const scheduledMatches = searching
    ? Object.values(sprint.queues)
        .flat()
        .filter((block) => matches(searchTextFor(sprint, block), search)).length
    : 0

  return (
    <div ref={setNodeRef} className={cx('backlog-drop', isOver && 'is-over')}>
      <div className="search-row">
        <input
          type="text"
          value={search}
          placeholder="Filter by number or title"
          aria-label="Filter the backlog"
          onChange={(event) => setSearch(event.target.value)}
        />
        {searching && (
          <button type="button" className="ghost" onClick={() => setSearch('')} aria-label="Clear">
            ✕
          </button>
        )}
      </div>

      {tags.length > 1 && (
        <div className="tag-row">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              className={cx('tag-chip', hidden.includes(entry.tag) && 'is-off')}
              onClick={() => toggleTag(entry.tag)}
              aria-pressed={!hidden.includes(entry.tag)}
              title={`${hidden.includes(entry.tag) ? 'Show' : 'Hide'} ${entry.tag} · ${hours(
                entry.hours
              )}`}
            >
              {entry.tag} <span className="tag-count">{entry.count}</span>
            </button>
          ))}
        </div>
      )}

      {groups.length > 0 ? (
        <>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <p className="section-title" style={{ flex: 1, margin: '4px 0 8px' }}>
              {searching || hidden.length > 0
                ? `${visible.length} of ${sprint.backlog.length} · ${hours(total)}`
                : `Unassigned · ${hours(total)} across ${sprint.backlog.length} items`}
            </p>
            {!searching && groups.length > 1 && (
              <button
                type="button"
                className="ghost fold-all"
                onClick={() =>
                  setCollapsedGroups(anyExpanded ? groups.map((group) => group.key) : [])
                }
                title={anyExpanded ? 'Collapse every group' : 'Expand every group'}
                aria-label={anyExpanded ? 'Collapse all' : 'Expand all'}
              >
                <FoldIcon folded={!anyExpanded} size={14} />
              </button>
            )}
          </div>
          {groups.map((group) => {
            // A search is a request to see what matched, so it overrides a collapsed group.
            const isCollapsed = !searching && collapsed.includes(group.key)
            return (
              <div className="group" key={group.key}>
                <button
                  type="button"
                  className="group-head"
                  onClick={() => toggleGroup(group.key)}
                  onContextMenu={(event) => {
                    // The leftover group has no work item to put tasks under.
                    if (!group.parent) return
                    onGroupContextMenu(group.parent.id, event)
                  }}
                  aria-expanded={!isCollapsed}
                  title={group.parent ? `#${group.parent.id} ${group.parent.title}` : undefined}
                >
                  <span
                    className={cx('group-caret', isCollapsed && 'is-collapsed')}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                  <span className="group-title">
                    {group.parent ? group.parent.title : 'No parent work item'}
                  </span>
                  <span className="group-meta">
                    {group.blocks.length > 0
                      ? `${group.blocks.length} · ${hours(group.hours)}`
                      : group.empty?.reason === 'all-scheduled'
                        ? 'all placed'
                        : 'no tasks'}
                  </span>
                </button>
                {group.parent && (
                  <div className="group-sub">
                    #{group.parent.id} · {group.parent.type}
                  </div>
                )}
                {!isCollapsed && group.blocks.length === 0 && (
                  <p className="group-empty">
                    {group.empty?.reason !== 'all-scheduled'
                      ? 'No tasks under this item.'
                      : group.empty.taskCount === 1
                        ? 'Its only task is on the calendar.'
                        : `All ${group.empty.taskCount} tasks are on the calendar.`}
                  </p>
                )}
                {!isCollapsed &&
                  group.blocks.map((block) => (
                    <TaskCard
                      key={block.id}
                      block={block}
                      isHighlighted={highlighted === block.workItemId}
                      onHover={highlight}
                      onBlockContextMenu={onBlockContextMenu}
                    />
                  ))}
              </div>
            )
          })}
        </>
      ) : sprint.backlog.length === 0 ? (
        <p className="empty">
          Everything is scheduled.
          <br />
          Drop a task here to unschedule it.
        </p>
      ) : (
        <p className="empty">
          Nothing in the backlog matches.
          {hidden.length > 0 && (
            <>
              <br />
              {hidden.length === 1 ? 'Tag' : 'Tags'} {hidden.join(', ')}{' '}
              {hidden.length === 1 ? 'is' : 'are'} hidden.
            </>
          )}
          {scheduledMatches > 0 && (
            <>
              <br />
              {scheduledMatches} scheduled {scheduledMatches === 1 ? 'task is' : 'tasks are'}{' '}
              already on the calendar.
            </>
          )}
        </p>
      )}
    </div>
  )
}
