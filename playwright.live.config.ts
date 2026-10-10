import { defineConfig, devices } from '@playwright/test'

const LIVE_URL = process.env.LIVE_URL ?? 'https://yanchen184.github.io/taipei-bike/'

export default defineConfig({
  testDir: 'tests/live',
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: 'node_modules/.tmp/playwright-live-results.json' }]],
  use: {
    baseURL: LIVE_URL.endsWith('/') ? LIVE_URL : `${LIVE_URL}/`,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
