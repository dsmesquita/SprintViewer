import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Electron cannot load outside its own runtime, so every test gets the fake in
// `test/electron.ts` instead. The main window module is replaced too: `ipc.ts` imports it
// only to open snapshot windows, and loading the real one would try to create a window.
vi.mock('electron', () => import('./electron'))
vi.mock('../src/main/index', () => ({ openSnapshotWindow: () => {} }))

// Component tests render into a shared document; each starts from an empty one.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})
