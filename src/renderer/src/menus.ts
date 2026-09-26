import { useCallback, useState } from 'react'
import { formatDayHeader } from '@shared/dates'
import { findBlock } from '@shared/mutations'
import type { ISODate, Sprint } from '@shared/types'
import type { MenuItem, MenuState } from './components/ContextMenu'
import { useApp } from './store'

/**
 * The right-click menus: on a day, a person, a block, a reported-hours ribbon and a backlog
 * heading. Returns the menu currently open and the handlers that open each one.
 *
 * The handlers are wrapped so the memoised rows and blocks in SprintGrid see the same functions
 * on every hop of a drag. `sprint` itself does not change until the drop, so they stay stable.
 */
export function useContextMenus(sprint: Sprint | null) {
  const openDialog = useApp((s) => s.openDialog)
  const openSplit = useApp((s) => s.openSplit)
  const openNote = useApp((s) => s.openNote)
  const openHours = useApp((s) => s.openHours)
  const openCreateTasks = useApp((s) => s.openCreateTasks)
  const moveBlock = useApp((s) => s.moveBlock)
  const unpinBlock = useApp((s) => s.unpinBlock)
  const unpinReported = useApp((s) => s.unpinReported)
  const setDayCapacity = useApp((s) => s.setDayCapacity)
  const setMemberCapacity = useApp((s) => s.setMemberCapacity)

  const [menu, setMenu] = useState<MenuState | null>(null)

  const onDayContextMenu = useCallback(
    (date: ISODate, event: React.MouseEvent, memberId?: string): void => {
      event.preventDefault()
      if (!sprint) return
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: formatDayHeader(date),
        items: dayMenuItems(sprint, date, memberId, {
          openDialog,
          setDayCapacity,
          setMemberCapacity
        })
      })
    },
    [sprint, openDialog, setDayCapacity, setMemberCapacity]
  )

  const onMemberContextMenu = useCallback(
    (memberId: string, event: React.MouseEvent): void => {
      event.preventDefault()
      if (!sprint) return
      const member = sprint.members.find((m) => m.id === memberId)
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: member?.name,
        items: [{ label: 'Add note…', onSelect: () => openNote({ memberId }) }]
      })
    },
    [sprint, openNote]
  )

  const onReportedContextMenu = useCallback(
    (workItemId: number, event: React.MouseEvent, label: string): void => {
      event.preventDefault()
      if (!sprint) return
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label,
        items: [
          {
            label: 'Reset to automatic',
            onSelect: () => unpinReported(workItemId),
            disabled: sprint.reportedPins?.[workItemId] === undefined
          },
          { label: 'Add note…', onSelect: () => openNote({ taskId: workItemId }) }
        ]
      })
    },
    [sprint, openNote, unpinReported]
  )

  const onGroupContextMenu = useCallback(
    (parentId: number, event: React.MouseEvent): void => {
      event.preventDefault()
      if (!sprint) return
      const parent = sprint.workItems[parentId]
      // Writing needs somewhere to write to: a sprint that came from TFS, in the desktop app.
      const unavailable = !sprint.queryUrl
        ? 'Only a sprint imported from TFS'
        : !window.api
          ? 'Only in the desktop app'
          : null
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: `#${parentId} ${parent?.title ?? ''}`,
        items: [
          {
            label: unavailable ? `Create tasks… (${unavailable})` : 'Create tasks…',
            onSelect: () => openCreateTasks(parentId),
            disabled: unavailable !== null
          }
        ]
      })
    },
    [sprint, openCreateTasks]
  )

  const onBlockContextMenu = useCallback(
    (blockId: string, event: React.MouseEvent, label: string): void => {
      event.preventDefault()
      if (!sprint) return
      const found = findBlock(sprint, blockId)
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label,
        items: [
          {
            label: 'Split…',
            onSelect: () => openSplit(blockId),
            // Nothing to divide when the whole block is a single hour or less.
            disabled: (found?.block.hours ?? 0) <= 1
          },
          {
            label: 'Set hours…',
            onSelect: () => {
              if (found) openHours(found.block.workItemId)
            }
          },
          { label: 'Add note…', onSelect: () => openNote({ taskId: found?.block.workItemId }) },
          ...(found?.block.pin
            ? [{ label: 'Unpin — let it flow again', onSelect: () => unpinBlock(blockId) }]
            : []),
          ...(found?.location.kind === 'member'
            ? [
                {
                  label: 'Return to backlog',
                  onSelect: () => moveBlock(blockId, { kind: 'backlog' }, sprint.backlog.length)
                }
              ]
            : [])
        ]
      })
    },
    [sprint, openSplit, openHours, openNote, unpinBlock, moveBlock]
  )

  return {
    menu,
    closeMenu: () => setMenu(null),
    onDayContextMenu,
    onMemberContextMenu,
    onReportedContextMenu,
    onGroupContextMenu,
    onBlockContextMenu
  }
}

interface DayMenuActions {
  openDialog: (dialog: 'start-sprint', seed: ISODate) => void
  setDayCapacity: (date: ISODate, capacity: number, label?: string) => void
  setMemberCapacity: (memberId: string, date: ISODate, capacity: number | null) => void
}

/** A day header's menu, or a day on someone's row: days off and half days. */
export function dayMenuItems(
  sprint: Sprint,
  date: ISODate,
  memberId: string | undefined,
  actions: DayMenuActions
): MenuItem[] {
  const day = sprint.days.find((d) => d.date === date)
  const member = sprint.members.find((m) => m.id === memberId)
  const half = sprint.hoursPerDay / 2
  const items: MenuItem[] = [
    { label: 'Start sprint here…', onSelect: () => actions.openDialog('start-sprint', date) }
  ]

  if (member) {
    const override = sprint.capacityOverrides[member.id]?.[date]
    items.push(
      {
        label: `Day off for ${member.name}`,
        onSelect: () => actions.setMemberCapacity(member.id, date, 0)
      },
      {
        label: `Half day for ${member.name}`,
        onSelect: () => actions.setMemberCapacity(member.id, date, half)
      }
    )
    if (override !== undefined) {
      items.push({
        label: `Clear ${member.name}'s day`,
        onSelect: () => actions.setMemberCapacity(member.id, date, null)
      })
    }
  }

  items.push(
    (day?.capacity ?? 0) > 0
      ? {
          label: 'Disable day for everyone',
          onSelect: () => actions.setDayCapacity(date, 0, 'Day off')
        }
      : {
          label: 'Enable day for everyone',
          onSelect: () => actions.setDayCapacity(date, sprint.hoursPerDay, undefined)
        },
    {
      label: 'Half day for everyone',
      onSelect: () => actions.setDayCapacity(date, half, 'Half day')
    }
  )
  return items
}
