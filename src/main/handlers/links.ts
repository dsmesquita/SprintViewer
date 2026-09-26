import { shell } from 'electron'
import { webUrl } from '../validate'

/**
 * Opening a link in the user's browser. Every link the app opens comes through here — work item
 * links from the renderer, and pages that ask for a new window — so there is one place that
 * decides what may be opened.
 *
 * Only web addresses. `shell.openExternal` hands anything to Windows, and a `file:` or custom
 * scheme address would run whatever is registered for it; nothing the app shows needs that.
 */
export async function openInBrowser(url: unknown): Promise<void> {
  const safe = webUrl(url)
  if (safe) await shell.openExternal(safe)
}
