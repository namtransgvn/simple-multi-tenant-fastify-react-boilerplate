import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ssoProviders as ssoProvidersTable, tenants as tenantsTable } from '../db/schema/index.js'
import { authService, parseDurationSeconds } from '../services/auth.service.js'
import { authProviderFactory } from '../providers/auth/factory.js'
import { config } from '../config.js'

const COOKIE_NAME = 'rt'

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  google: 'Google',
  'amazon-cognito': 'Amazon Cognito',
  keycloak: 'Keycloak',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REFRESH_TOKEN_MAX_AGE = parseDurationSeconds(config.refreshTokenExpiresIn)
const RATE_LIMIT_CONFIG = { max: config.authRateLimit.max, timeWindow: config.authRateLimit.windowMs }

// State format: "{32hex-nonce}.{tenantId}.{64hex-hmac}"
// HMAC covers "{nonce}.{tenantId}" so tenantId is integrity-protected.
function generateState(tenantId: string): string {
  const nonce = randomBytes(16).toString('hex')
  const data = `${nonce}.${tenantId}`
  const hmac = createHmac('sha256', config.jwtSecret).update(data).digest('hex')
  return `${data}.${hmac}`
}

function verifyState(state: string): boolean {
  const lastDot = state.lastIndexOf('.')
  if (lastDot === -1) return false
  const data = state.slice(0, lastDot)
  const provided = state.slice(lastDot + 1)
  const expected = createHmac('sha256', config.jwtSecret).update(data).digest('hex')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

// Call only after verifyState returns true.
function extractTenantFromState(state: string): string {
  const lastDot = state.lastIndexOf('.')
  const data = state.slice(0, lastDot) // "{nonce}.{tenantId}"
  const firstDot = data.indexOf('.')
  return data.slice(firstDot + 1)
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
  // GET /tenants — public list of tenants that have at least one enabled SSO provider
  fastify.get('/tenants', { config: { public: true } }, async () => {
    const [allTenants, enabledProviders] = await Promise.all([
      db.select({ id: tenantsTable.id, name: tenantsTable.name, slug: tenantsTable.slug }).from(tenantsTable),
      db
        .select({ tenantId: ssoProvidersTable.tenantId, providerType: ssoProvidersTable.providerType })
        .from(ssoProvidersTable)
        .where(eq(ssoProvidersTable.enabled, true)),
    ])

    const providersByTenant = new Map<string, string[]>()
    for (const p of enabledProviders) {
      if (!p.tenantId) continue
      const arr = providersByTenant.get(p.tenantId) ?? []
      arr.push(p.providerType)
      providersByTenant.set(p.tenantId, arr)
    }

    const tenants = allTenants
      .filter((t) => providersByTenant.has(t.id))
      .map((t) => ({ ...t, ssoProviders: providersByTenant.get(t.id) ?? [] }))

    return { tenants }
  })

  // GET /sso — list SSO providers, optionally filtered to a specific tenant
  fastify.get<{ Querystring: { tenantId?: string } }>(
    '/sso',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const { tenantId } = request.query

      if (tenantId !== undefined && !UUID_RE.test(tenantId)) {
        return reply.badRequest('Invalid tenantId')
      }

      const baseUrl = buildRedirectUri(request, '__placeholder__')
        .replace('/auth/sso/__placeholder__/callback', '')

      let providerTypes: string[]

      if (tenantId) {
        const rows = await db
          .select({ providerType: ssoProvidersTable.providerType })
          .from(ssoProvidersTable)
          .where(and(eq(ssoProvidersTable.tenantId, tenantId), eq(ssoProvidersTable.enabled, true)))
        providerTypes = rows
          .map((r) => r.providerType)
          .filter((type) => {
            try { authProviderFactory.resolve(type); return true } catch { return false }
          })
      } else {
        providerTypes = authProviderFactory.listProviderTypes()
      }

      const providers = providerTypes.map((providerType) => {
        const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''
        return {
          providerType,
          name: PROVIDER_DISPLAY_NAMES[providerType] ?? providerType,
          authorizationUrl: `${baseUrl}/auth/sso/${providerType}/authorize${params}`,
        }
      })

      return { providers }
    },
  )

  // GET /sso/:provider/authorize — redirect browser to the OAuth provider
  fastify.get<{ Params: { provider: string }; Querystring: { tenantId?: string } }>(
    '/sso/:provider/authorize',
    { config: { public: true, rateLimit: RATE_LIMIT_CONFIG } },
    async (request, reply) => {
      const { provider } = request.params
      const tenantId = request.query.tenantId ?? config.masterTenantId

      if (!UUID_RE.test(tenantId)) {
        return reply.badRequest('Invalid tenantId')
      }

      let authProvider
      try {
        authProvider = authProviderFactory.resolve(provider)
      } catch {
        return reply.badRequest(`Unknown SSO provider: ${provider}`)
      }

      const state = generateState(tenantId)
      const redirectUri = buildRedirectUri(request, provider)
      const authorizationUrl = authProvider.getAuthorizationUrl(state, redirectUri)

      return reply.redirect(authorizationUrl, 302)
    },
  )

  // GET /sso/:provider/callback — exchange code, issue tokens, redirect to frontend
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

      const tenantId = extractTenantFromState(state)
      const redirectUri = buildRedirectUri(request, provider)

      let result
      try {
        result = await authService.handleSsoCallback(provider, code, redirectUri, db, tenantId)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SSO authentication failed'
        request.log.error({ err }, message)
        return reply.internalServerError(message)
      }

      const frontendBase = config.corsOrigins[0]
      setRefreshTokenCookie(reply, result.refreshToken)
      return reply.redirect(`${frontendBase}/auth/callback?token=${result.accessToken}`, 302)
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
