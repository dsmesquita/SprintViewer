import type { SprintViewerApi } from './index'

declare global {
  interface Window {
    api: SprintViewerApi
  }
}

export {}
