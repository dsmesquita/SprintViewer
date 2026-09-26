import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import SnapshotView from './SnapshotView'
import './styles/index.css'

/**
 * One bundle, two windows. A `?snapshot=` in the address means this window is a read-only
 * view of a stored board rather than the app itself.
 */
const params = new URLSearchParams(window.location.search)
const snapshotId = params.get('snapshot')
const sprintId = params.get('sprint')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {snapshotId && sprintId ? (
      <SnapshotView sprintId={sprintId} snapshotId={snapshotId} />
    ) : (
      <App />
    )}
  </StrictMode>
)
