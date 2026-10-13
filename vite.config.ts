import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

process.env.VITE_COMMIT_SHA ??= 'dev'

export default defineConfig({
  base: '/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
