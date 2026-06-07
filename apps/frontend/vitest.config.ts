import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://localhost'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
