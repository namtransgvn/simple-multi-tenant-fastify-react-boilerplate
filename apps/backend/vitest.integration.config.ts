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
    include: [
      'src/**/*.integration.test.ts',
      'src/__tests__/integration/**/*.test.ts',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Each test file runs in its own worker; force sequential to prevent
    // concurrent TRUNCATE / INSERT races across workers on the shared DB.
    fileParallelism: false,
    sequence: { concurrent: false },
    // Run Drizzle migrations once before all test files.
    globalSetup: ['src/__tests__/integration/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      // TEST_DATABASE_URL takes priority so CI can point tests at an isolated DB.
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        process.env.DATABASE_URL ??
        'postgresql://localhost:5432/chatbot_test',
      JWT_SECRET: process.env.JWT_SECRET ?? 'integration-test-secret-min-32-chars-long!',
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      AI_PROVIDERS: '',
      AI_KEY_ENCRYPTION_SECRET: process.env.AI_KEY_ENCRYPTION_SECRET ?? '0'.repeat(64),
      MASTER_TENANT_ID: '00000000-0000-0000-0000-000000000001',
      // Disable all SSO providers so auth-factory side-effects are deterministic.
      // Workers inherit the parent's process.env (which may have real .env creds);
      // these empty-string overrides are normalised to undefined by config.ts,
      // preventing any SSO provider from being registered during tests.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      AMAZON_COGNITO_CLIENT_ID: '',
      AMAZON_COGNITO_CLIENT_SECRET: '',
      AMAZON_COGNITO_ISSUER_URL: '',
      KEYCLOAK_CLIENT_ID: '',
      KEYCLOAK_CLIENT_SECRET: '',
      KEYCLOAK_ISSUER_URL: '',
    },
  },
})
