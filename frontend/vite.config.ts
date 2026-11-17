import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // The forks pool copies transformed modules to disk, where renames can fail in Windows sandboxes.
    pool: 'threads',
    // Keep jsdom suites from competing for CPU on shared runners.
    maxWorkers: 2,
    testTimeout: 15_000,
    setupFiles: './src/test/setup.ts',
  },
})
