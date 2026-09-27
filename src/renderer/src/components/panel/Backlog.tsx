import { useDroppable } from '@dnd-kit/core'
import { doneWaiting } from '@shared/doneHours'
import { emptyGroupsFor, groupBlocks, searchTextFor } from '@shared/grouping'
import { hiddenInBacklog, shownBacklog } from '@shared/hiddenBacklog'
import { reportedHours } from '@shared/sizing'
import type { Block } from '@shared/types'
import { isTagVisible, tagCounts, tagOf } from '@shared/tags'
import { matches } from '@shared/text'
import { cx, hours } from '../../format'
import { BACKLOG_DROP_ID } from '../../grid'
import { FoldIcon } from '../../icons'
import { useApp, useSprint } from '../../store'
import DoneCard from './DoneCard'
import type { BlockContextMenu, GroupContextMenu } from './types'
import TaskCard from './TaskCard'

/** The id a waiting done card goes by among the backlog's blocks, to be grouped with them. */
const DONE_PREFIX = 'done:'

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
  const showHidden = useApp((s) => s.showHiddenBacklog)
  const setShowHidden = useApp((s) => s.setShowHiddenBacklog)
  const unhide = useApp((s) => s.unhideInBacklog)
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG_DROP_ID })

  // Tasks hidden from the backlog are left out of everything — cards, counts, hours, tags —
  // unless the user asks to see them, and even then they are listed but not counted.
  const hiddenTasks = hiddenInBacklog(sprint)
  const counted = shownBacklog(sprint)
  const pool = showHidden ? sprint.backlog : counted
  const hiddenCount = [...hiddenTasks].filter(
    (id) =>
      sprint.backlog.some((block) => block.workItemId === id) ||
      doneWaiting(sprint).some((item) => item.id === id)
  ).length

  // Counted over the whole backlog rather than what is currently shown, so a chip never
  // vanishes while it is switched off — you would have no way to switch it back on.
  const tags = tagCounts(sprint, pool)
  const hidden = sprint.hiddenTags ?? []

  // Filtering only hides cards. The backlog order is untouched, so clearing the filters puts
  // the list back exactly as it was. Both filters apply at once.
  const shown = (block: Block): boolean =>
    isTagVisible(sprint, block) && matches(searchTextFor(sprint, block), search)
  const visible = pool.filter(shown)
  const visibleCounted = visible.filter((block) => !hiddenTasks.has(block.workItemId))
  // Done hours waiting to be placed sit with their task's other cards, under the same parent.
  const doneCards: Block[] = doneWaiting(sprint)
    .filter((item) => showHidden || !hiddenTasks.has(item.id))
    .map((item) => ({
      id: `${DONE_PREFIX}${item.id}`,
      workItemId: item.id,
      hours: reportedHours(item)
    }))
    .filter(shown)
  // Containers with no cards under them keep a heading, so neither a bug nobody has broken
  // down nor a story whose tasks are all placed disappears from the list. Same two filters.
  const empties = emptyGroupsFor(sprint).filter(
    ({ item }) =>
      !hidden.includes(tagOf(item.title)) &&
      matches(`${item.id} ${item.title} ${item.type}`, search)
  )
  const groups = groupBlocks(sprint, [...visible, ...doneCards], empties)
  const total = visibleCounted.reduce((sum, block) => sum + block.hours, 0)
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

      {hiddenCount > 0 && (
        <label className="hidden-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          Show hidden ({hiddenCount})
        </label>
      )}

      {groups.length > 0 ? (
        <>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <p className="section-title" style={{ flex: 1, margin: '4px 0 8px' }}>
              {searching || hidden.length > 0
                ? `${visibleCounted.length} of ${counted.length} · ${hours(total)}`
                : `Unassigned · ${hours(total)} across ${counted.length} items`}
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
                  group.blocks.map((block) =>
                    block.id.startsWith(DONE_PREFIX) ? (
                      <DoneCard
                        key={block.id}
                        item={sprint.workItems[block.workItemId]}
                        done={block.hours}
                        isHighlighted={highlighted === block.workItemId}
                        onHover={highlight}
                        onBlockContextMenu={onBlockContextMenu}
                        onUnhide={hiddenTasks.has(block.workItemId) ? unhide : undefined}
                      />
                    ) : (
                      <TaskCard
                        key={block.id}
                        block={block}
                        isHighlighted={highlighted === block.workItemId}
                        onHover={highlight}
                        onBlockContextMenu={onBlockContextMenu}
                        onUnhide={hiddenTasks.has(block.workItemId) ? unhide : undefined}
                      />
                    )
                  )}
              </div>
            )
          })}
        </>
      ) : pool.length === 0 && doneCards.length === 0 ? (
        <p className="empty">
          Everything is scheduled.
          <br />
          Drop a task here to unschedule it.
          {hiddenCount > 0 && (
            <>
              <br />
              {hiddenCount} hidden {hiddenCount === 1 ? 'task waits' : 'tasks wait'} here.
            </>
          )}
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
