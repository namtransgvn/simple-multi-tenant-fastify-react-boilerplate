import http from 'node:http'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import fastifyMultipart from '@fastify/multipart'
import fastifySensible from '@fastify/sensible'
import fastifyRateLimit from '@fastify/rate-limit'
import { ulid } from 'ulid'
import { config } from './config.js'
import authPlugin from './plugins/auth.plugin.js'

type HttpError = Error & { statusCode?: number }

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const isTest = config.nodeEnv === 'test'

  const fastify = Fastify({
    logger: isTest
      ? false
      : { level: config.logLevel },
    ...opts,
  })

  // ── Plugins ────────────────────────────────────────────────────────────────

  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
  })

  await fastify.register(fastifyCors, {
    origin: config.corsOrigins.length === 1 ? config.corsOrigins[0] : config.corsOrigins,
    credentials: true,
  })

  await fastify.register(fastifyMultipart, {
    limits: { fileSize: config.maxFileSizeBytes },
  })

  await fastify.register(fastifySensible)

  await fastify.register(authPlugin)

  // global: false — auth routes opt-in via route-level config
  await fastify.register(fastifyRateLimit, {
    global: false,
    max: config.authRateLimit.max,
    timeWindow: config.authRateLimit.windowMs,
  })

  // ── Global hooks ───────────────────────────────────────────────────────────

  fastify.addHook('onRequest', async (request) => {
    request.log = request.log.child({ requestId: request.id })
  })

  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    reply.header('Content-Security-Policy', "default-src 'self'")
    return payload
  })

  // ── Error handler ──────────────────────────────────────────────────────────

  fastify.setErrorHandler<HttpError>((error, request, reply) => {
    const errorId = `err_${ulid()}`
    const statusCode = error.statusCode ?? 500
    const errorName = http.STATUS_CODES[statusCode] ?? 'Error'

    request.log.error({ err: error, errorId }, error.message)

    const message = statusCode >= 500 ? 'Internal Server Error' : error.message

    reply.status(statusCode).send({ statusCode, error: errorName, message, errorId })
  })

  // ── Routes ─────────────────────────────────────────────────────────────────

  fastify.get('/health', { config: { public: true } }, async () => {
    let dbStatus: 'ok' | 'error' = 'error'
    try {
      const { checkDb } = await import('./db/index.js')
      await checkDb()
      dbStatus = 'ok'
    } catch {
      dbStatus = 'error'
    }
    return {
      status: 'ok',
      db: dbStatus,
      version: process.env.npm_package_version ?? '0.0.0',
    }
  })

  return fastify
}
