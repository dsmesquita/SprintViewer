import type { CalendarExport } from '@shared/calendarExport'

/**
 * One person's calendar board drawn as a PNG, with the browser's own canvas — no library, and
 * the same rows the dialog shows. Colours and font are the app's own, read from its tokens.
 * Resolves to the image as base64, without the `data:` prefix.
 */
export function boardPng(board: CalendarExport): string {
  const root = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    root.getPropertyValue(name).trim() || fallback
  const colors = {
    background: token('--surface', 'white'),
    header: token('--surface-3', 'whitesmoke'),
    border: token('--border', 'lightgray'),
    text: token('--text', 'black'),
    muted: token('--text-2', 'gray')
  }
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const font = (size: number, weight = 400): string => `${weight} ${size}px ${family}`

  // Sized to the text first, then drawn at twice the scale so it stays sharp when zoomed.
  const measure = document.createElement('canvas').getContext('2d')!
  const widest = (texts: string[], size: number, weight = 400): number => {
    measure.font = font(size, weight)
    return Math.max(...texts.map((text) => measure.measureText(text).width))
  }
  const pad = 24
  const cellPad = 12
  const rowHeight = 30
  const dayWidth = widest(['Day', ...board.rows.map((row) => row.day)], 13, 600) + cellPad * 2
  const tasksWidth = Math.max(
    240,
    widest(['Tasks', ...board.rows.map((row) => row.tasks)], 13) + cellPad * 2
  )
  const tableWidth = dayWidth + tasksWidth
  const width = Math.ceil(
    Math.max(tableWidth, widest([board.memberName], 18, 700), widest([board.subtitle], 13)) +
      pad * 2
  )
  const tableTop = pad + 54
  const height = Math.ceil(tableTop + rowHeight * (board.rows.length + 1) + pad)

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, width, height)

  ctx.textBaseline = 'middle'
  ctx.fillStyle = colors.text
  ctx.font = font(18, 700)
  ctx.fillText(board.memberName, pad, pad + 10)
  ctx.fillStyle = colors.muted
  ctx.font = font(13)
  ctx.fillText(board.subtitle, pad, pad + 34)

  // The header row, shaded, then one row per day.
  ctx.fillStyle = colors.header
  ctx.fillRect(pad, tableTop, tableWidth, rowHeight)
  const rows: Array<[string, string, boolean]> = [
    ['Day', 'Tasks', true],
    ...board.rows.map((row): [string, string, boolean] => [row.day, row.tasks, false])
  ]
  rows.forEach(([day, tasks, isHeader], index) => {
    const middle = tableTop + rowHeight * index + rowHeight / 2
    ctx.fillStyle = colors.text
    ctx.font = font(13, isHeader ? 700 : 600)
    ctx.fillText(day, pad + cellPad, middle)
    ctx.font = font(13, isHeader ? 700 : 400)
    ctx.fillText(tasks, pad + dayWidth + cellPad, middle)
  })

  ctx.strokeStyle = colors.border
  ctx.lineWidth = 1
  for (let index = 0; index <= rows.length; index++) {
    const y = tableTop + rowHeight * index + 0.5
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(pad + tableWidth, y)
    ctx.stroke()
  }
  for (const x of [pad, pad + dayWidth, pad + tableWidth]) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, tableTop)
    ctx.lineTo(x + 0.5, tableTop + rowHeight * rows.length)
    ctx.stroke()
  }

  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
}
