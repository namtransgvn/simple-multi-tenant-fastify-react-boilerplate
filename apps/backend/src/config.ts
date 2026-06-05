import { config as loadDotenv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Try apps/backend/.env first; fall back to workspace root .env
loadDotenv({ path: resolve(__dirname, '../.env') })
loadDotenv({ path: resolve(__dirname, '../../../.env') })

const AI_PROVIDER_KEY_MAP = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
} as const

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),

    DATABASE_URL: z.string().min(1),

    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('24h'),
    REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),

    CORS_ORIGIN: z.string().min(1),

    // Comma-separated list of active AI providers e.g. "anthropic,openai"
    AI_PROVIDERS: z.string().default(''),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_AI_API_KEY: z.string().optional(),

    // SSO credentials — all optional, providers configured per-tenant in DB
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    AMAZON_COGNITO_CLIENT_ID: z.string().optional(),
    AMAZON_COGNITO_CLIENT_SECRET: z.string().optional(),
    AMAZON_COGNITO_ISSUER_URL: z.string().url().optional(),
    KEYCLOAK_CLIENT_ID: z.string().optional(),
    KEYCLOAK_CLIENT_SECRET: z.string().optional(),
    KEYCLOAK_ISSUER_URL: z.string().url().optional(),

    MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
    UPLOAD_DIR: z.string().default('./uploads'),

    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

    // Seed
    MASTER_TENANT_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
    ADMIN_EMAIL: z.string().email().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'development' && data.CORS_ORIGIN === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGIN cannot be "*" in non-development environments',
        path: ['CORS_ORIGIN'],
      })
    }

    const activeProviders = data.AI_PROVIDERS.split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    for (const provider of activeProviders) {
      const keyName = AI_PROVIDER_KEY_MAP[provider as keyof typeof AI_PROVIDER_KEY_MAP]
      if (!keyName) continue
      const keyPresent = {
        ANTHROPIC_API_KEY: data.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: data.OPENAI_API_KEY,
        GOOGLE_AI_API_KEY: data.GOOGLE_AI_API_KEY,
      }[keyName]

      if (!keyPresent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${keyName} is required when "${provider}" is listed in AI_PROVIDERS`,
          path: [keyName],
        })
      }
    }
  })

// dotenv sets missing vars to ""; normalise to undefined so optional() works correctly
const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
)

const result = envSchema.safeParse(rawEnv)
if (!result.success) {
  const lines = result.error.errors
    .map((e) => `  ${e.path.join('.')}: ${e.message}`)
    .join('\n')
  throw new Error(`Environment validation failed:\n${lines}`)
}

const env = result.data

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  databaseUrl: env.DATABASE_URL,

  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN,
  refreshTokenExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN,

  corsOrigins: env.CORS_ORIGIN.split(',').map((s) => s.trim()),

  aiProviders: env.AI_PROVIDERS.split(',').map((p) => p.trim()).filter(Boolean),
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  openaiApiKey: env.OPENAI_API_KEY,
  googleAiApiKey: env.GOOGLE_AI_API_KEY,

  sso: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    cognito: {
      clientId: env.AMAZON_COGNITO_CLIENT_ID,
      clientSecret: env.AMAZON_COGNITO_CLIENT_SECRET,
      issuerUrl: env.AMAZON_COGNITO_ISSUER_URL,
    },
    keycloak: {
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      issuerUrl: env.KEYCLOAK_ISSUER_URL,
    },
  },

  maxFileSizeBytes: env.MAX_FILE_SIZE_BYTES,
  uploadDir: env.UPLOAD_DIR,

  authRateLimit: {
    max: env.AUTH_RATE_LIMIT_MAX,
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  },

  masterTenantId: env.MASTER_TENANT_ID,
  adminEmail: env.ADMIN_EMAIL,
} as const
