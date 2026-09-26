import { vi } from 'vitest'

// Electron cannot load outside its own runtime, so every test gets the fake in
// `test/electron.ts` instead. The main window module is replaced too: `ipc.ts` imports it
// only to open snapshot windows, and loading the real one would try to create a window.
vi.mock('electron', () => import('./electron'))
vi.mock('../src/main/index', () => ({ openSnapshotWindow: () => {} }))
