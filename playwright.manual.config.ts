import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testDir: 'tests/manual',
  reporter: [['list']],
  use: { ...base.use, viewport: { width: 1280, height: 720 } },
})
