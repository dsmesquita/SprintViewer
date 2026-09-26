import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * One runner for every layer. Logic and main-process tests run in Node; component tests
 * (`*.test.tsx`) get a DOM from jsdom. Electron itself is never loaded — see `test/setup.ts`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Entry points that only run inside Electron or a real page load: there is nothing in
      // them to test without launching the app.
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/main/index.ts',
        'src/preload/index.ts',
        'src/renderer/src/main.tsx'
      ],
      reporter: ['text-summary', 'html']
    }
  }
})
