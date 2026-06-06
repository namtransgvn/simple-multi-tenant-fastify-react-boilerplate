import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '../db/index.js'
import { authService, parseDurationSeconds } from '../services/auth.service.js'
import { authProviderFactory } from '../providers/auth/factory.js'
import { config } from '../config.js'

const COOKIE_NAME = 'rt'

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: 'Google',
  'amazon-cognito': 'Amazon Cognito',
  keycloak: 'Keycloak',
}

const REFRESH_TOKEN_MAX_AGE = parseDurationSeconds(config.refreshTokenExpiresIn)
const RATE_LIMIT_CONFIG = { max: config.authRateLimit.max, timeWindow: config.authRateLimit.windowMs }

function generateState(): string {
  const nonce = randomBytes(16).toString('hex')
  const hmac = createHmac('sha256', config.jwtSecret).update(nonce).digest('hex')
  return `${nonce}.${hmac}`
}

function verifyState(state: string): boolean {
  const dotIndex = state.indexOf('.')
  if (dotIndex === -1) return false
  const nonce = state.slice(0, dotIndex)
  const provided = state.slice(dotIndex + 1)
  const expected = createHmac('sha256', config.jwtSecret).update(nonce).digest('hex')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function buildRedirectUri(request: FastifyRequest, provider: string): string {
  const proto = (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol
  const host = request.headers['x-forwarded-host'] as string | undefined ?? request.headers.host
  return `${proto}://${host}/auth/sso/${provider}/callback`
}

function setRefreshTokenCookie(reply: FastifyReply, value: string): void {
  const isSecure = config.nodeEnv !== 'development'
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${REFRESH_TOKEN_MAX_AGE}`,
  ]
  if (isSecure) parts.push('Secure')
  reply.header('Set-Cookie', parts.join('; '))
}

function clearRefreshTokenCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

function getRefreshTokenCookie(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return undefined
  for (const pair of cookieHeader.split(';')) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx === -1) continue
    const name = pair.slice(0, eqIdx).trim()
    if (name === COOKIE_NAME) return pair.slice(eqIdx + 1).trim()
  }
  return undefined
}

async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /sso — list available SSO providers with their authorize URLs
  fastify.get(
    '/sso',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request) => {
      const baseUrl = buildRedirectUri(request, '__placeholder__')
        .replace('/auth/sso/__placeholder__/callback', '')

      const providers = authProviderFactory.listProviderTypes().map((providerType) => ({
        providerType,
        name: PROVIDER_DISPLAY_NAMES[providerType] ?? providerType,
        authorizationUrl: `${baseUrl}/auth/sso/${providerType}/authorize`,
      }))

      return { providers }
    },
  )

  // GET /sso/:provider/authorize — redirect browser to the OAuth provider
  fastify.get<{ Params: { provider: string } }>(
    '/sso/:provider/authorize',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const { provider } = request.params

      let authProvider
      try {
        authProvider = authProviderFactory.resolve(provider)
      } catch {
        return reply.badRequest(`Unknown SSO provider: ${provider}`)
      }

      const state = generateState()
      const redirectUri = buildRedirectUri(request, provider)
      const authorizationUrl = authProvider.getAuthorizationUrl(state, redirectUri)

      return reply.redirect(authorizationUrl, 302)
    },
  )

  // GET /sso/:provider/callback — exchange code, issue tokens
  fastify.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string } }>(
    '/sso/:provider/callback',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const { provider } = request.params
      const { code, state } = request.query

      if (!code || !state) {
        return reply.badRequest('Missing code or state parameter')
      }

      if (!verifyState(state)) {
        return reply.badRequest('Invalid state parameter')
      }

      const redirectUri = buildRedirectUri(request, provider)

      let result
      try {
        result = await authService.handleSsoCallback(provider, code, redirectUri, db)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSO authentication failed'
        request.log.error({ err }, message)
        return reply.internalServerError(message)
      }

      setRefreshTokenCookie(reply, result.refreshToken)
      return reply.send({ accessToken: result.accessToken })
    },
  )

  // POST /refresh — issue a new access token using the refresh token cookie
  fastify.post(
    '/refresh',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const rawToken = getRefreshTokenCookie(request)
      if (!rawToken) {
        return reply.unauthorized('No refresh token provided')
      }

      let result
      try {
        result = await authService.refreshAccessToken(rawToken, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode ?? 500
        const message = err instanceof Error ? err.message : 'Token refresh failed'
        return reply.status(statusCode).send({ statusCode, error: 'Unauthorized', message })
      }

      return reply.send({ accessToken: result.accessToken })
    },
  )

  // POST /logout — revoke the refresh token cookie
  fastify.post(
    '/logout',
    { config: { skipTenantGuard: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const rawToken = getRefreshTokenCookie(request)
      if (rawToken) {
        await authService.revokeRefreshToken(rawToken, db)
      }
      clearRefreshTokenCookie(reply)
      return reply.status(204).send()
    },
  )
}

export default authRoutes
