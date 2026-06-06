import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules'],
    // Provide minimum required env so config.ts can be imported without throwing.
    // Tests that import config directly should mock it with vi.mock instead.
    env: {
      DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot',
      JWT_SECRET: 'unit-test-secret-at-least-32-chars-long!',
      CORS_ORIGIN: 'http://localhost:5173',
      AI_PROVIDERS: '',
    },
  },
})
