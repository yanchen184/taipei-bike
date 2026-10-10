import { defineConfig, devices } from '@playwright/test'

const PORT = 5185

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'node_modules/.tmp/playwright-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/taipei-bike/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/taipei-bike/`,
    env: { VITE_USE_EMULATOR: 'true' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
