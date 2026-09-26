import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests: the built Electron app (`out/`), driven by Playwright. Run them with
 * `npm run test:e2e`, which builds first. See `e2e/app.ts` for the fixtures.
 */
export default defineConfig({
  testDir: 'e2e',
  // One app at a time: each test starts its own Electron, and real pointer drags are more
  // dependable without other windows competing for the screen.
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
