import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Renderer-only dev server, for iterating on the UI in a plain browser without launching
 * Electron. `npm run dev` is still the real thing — this is a convenience for styling work.
 * Anything behind `window.api` is unavailable here.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: { port: 5178 }
})
