import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface MenuState {
  x: number
  y: number
  label?: string
  items: MenuItem[]
}

interface Props {
  menu: MenuState | null
  onClose: () => void
}

/** Right-click menu. Closes on Escape, on any outside click, and on scroll. */
export default function ContextMenu({ menu, onClose }: Props): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [menu, onClose])

  // Flip the menu back inside the window when it is opened near an edge.
  useEffect(() => {
    if (!menu) return
    const box = ref.current?.getBoundingClientRect()
    const width = box?.width ?? 190
    const height = box?.height ?? 80
    setPosition({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8)
    })
  }, [menu])

  if (!menu) return null

  return (
    <div
      className="context-menu"
      ref={ref}
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {menu.label && <div className="menu-label">{menu.label}</div>}
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
