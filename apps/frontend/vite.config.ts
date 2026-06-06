import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  // Read .env from the monorepo root so VITE_API_BASE_URL is available
  envDir: resolve(__dirname, '../..'),
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
