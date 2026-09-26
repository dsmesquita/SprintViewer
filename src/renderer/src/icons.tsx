/** Inline icons. The app ships offline, so nothing is loaded from an icon CDN. */

interface IconProps {
  size?: number
  className?: string
  title?: string
}

function svgProps({ size = 15, className, title }: IconProps): Record<string, unknown> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': title ? undefined : true,
    role: title ? 'img' : undefined
  }
}

export function WarningIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </svg>
  )
}

export function NoteIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M5 4h14v10l-5 6H5V4Z" />
      <path d="M19 14h-5v6" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M20 11a8 8 0 1 0-1.6 5.5" />
      <path d="M20 5v6h-6" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.6 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function ChevronIcon({
  direction,
  ...props
}: IconProps & { direction: 'left' | 'right' }): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d={direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

export function ExternalIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps({ size: 11, ...props })}>
      {props.title && <title>{props.title}</title>}
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

/** Double chevron for expand-all / collapse-all. */
export function FoldIcon({ folded, ...props }: IconProps & { folded: boolean }): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      {folded ? (
        <>
          <path d="M7 13l5 5 5-5" />
          <path d="M7 6l5 5 5-5" />
        </>
      ) : (
        <>
          <path d="M7 11l5-5 5 5" />
          <path d="M7 18l5-5 5 5" />
        </>
      )}
    </svg>
  )
}

/** Broom-ish sweep, for clearing the calendar. */
export function ClearIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M3 21h18" />
      <path d="M6 21v-5l9-9" />
      <path d="M14 4l6 6-5 5-6-6z" />
    </svg>
  )
}

/** Arrows fanning into rows: pouring the backlog onto the calendar. */
export function AssignIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M3 6h8" />
      <path d="M3 12h5" />
      <path d="M3 18h8" />
      <path d="M14 12h7" />
      <path d="M18 8l3 4-3 4" />
    </svg>
  )
}

/** Arrow curving back on itself: undo. */
export function UndoIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M3 8h11a5 5 0 0 1 0 10h-6" />
      <path d="M7 4 3 8l4 4" />
    </svg>
  )
}

/** Two overlapping frames: comparing one board with another. */
export function DiffIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <path d="M9 9h12v12H9" />
    </svg>
  )
}

/** Camera: keeping a copy of the board as it stands. */
export function CameraIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

export function LockIcon({ locked, ...props }: IconProps & { locked: boolean }): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      {locked ? <path d="M7 11V7a5 5 0 0 1 10 0v4" /> : <path d="M7 11V7a5 5 0 0 1 9.9-1" />}
    </svg>
  )
}

/** Download arrow: saving something out of the app to a file. */
export function ExportIcon(props: IconProps): JSX.Element {
  return (
    <svg {...svgProps(props)}>
      {props.title && <title>{props.title}</title>}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
