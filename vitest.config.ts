import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    /* Only run tests from src/. Excludes:
       - dependencies (node_modules)
       - build output (dist)
       - local Claude Code worktrees that may live inside this repo root
         (.claude/worktrees/...) — without this, running from the main
         checkout would pick up duplicate test files from worktrees and
         either fail or time out. */
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '**/.claude/**',
    ],
  },
})
