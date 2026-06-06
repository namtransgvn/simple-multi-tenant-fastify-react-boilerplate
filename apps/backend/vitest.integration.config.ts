import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env from apps/backend/ then workspace root so DATABASE_URL etc. are
// available when this config file evaluates process.env below.
loadDotenv({ path: resolve(__dirname, '.env') })
loadDotenv({ path: resolve(__dirname, '../../.env') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Run test files sequentially to avoid parallel DB conflicts.
    sequence: { concurrent: false },
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://chatbot:chatbot@localhost:5432/chatbot',
      JWT_SECRET: process.env.JWT_SECRET ?? 'integration-test-secret-min-32-chars-long!',
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      AI_PROVIDERS: process.env.AI_PROVIDERS ?? '',
      AI_KEY_ENCRYPTION_SECRET: process.env.AI_KEY_ENCRYPTION_SECRET ?? '0'.repeat(64),
    },
  },
})
