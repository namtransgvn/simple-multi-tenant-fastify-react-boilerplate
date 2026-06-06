import { createHash, createHmac, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import { config } from '../config.js'
import { authProviderFactory } from '../providers/auth/factory.js'

type Db = PostgresJsDatabase<typeof schema>

export function parseDurationSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration)
  if (!match) throw new Error(`Invalid duration: "${duration}"`)
  const n = parseInt(match[1], 10)
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return n * (multipliers[match[2]] ?? 1)
}

function signJwt(payload: Record<string, unknown>, expiresIn: string): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + parseDurationSeconds(expiresIn)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp })).toString('base64url')
  const sig = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function buildAccessToken(userId: string, tenantId: string, db: Db): Promise<string> {
  const directRoles = await db
    .select({ name: schema.roles.name, permissions: schema.roles.permissions })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(and(eq(schema.userRoles.userId, userId), eq(schema.userRoles.tenantId, tenantId)))

  const groupDerivedRoles = await db
    .select({ name: schema.roles.name, permissions: schema.roles.permissions })
    .from(schema.userGroups)
    .innerJoin(schema.groupRoles, eq(schema.userGroups.groupId, schema.groupRoles.groupId))
    .innerJoin(schema.roles, eq(schema.groupRoles.roleId, schema.roles.id))
    .where(and(eq(schema.userGroups.userId, userId), eq(schema.userGroups.tenantId, tenantId)))

  const allRoles = [...directRoles, ...groupDerivedRoles]
  const roles = [...new Set(allRoles.map((r) => r.name))]
  const permissions = [...new Set(allRoles.flatMap((r) => r.permissions))]

  return signJwt({ userId, tenantId, roles, permissions }, config.jwtExpiresIn)
}

async function generateTokens(user: { id: string; tenantId: string }, db: Db) {
  const accessToken = await buildAccessToken(user.id, user.tenantId, db)

  const rawRefreshToken = randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawRefreshToken)
  const expiresAt = new Date(Date.now() + parseDurationSeconds(config.refreshTokenExpiresIn) * 1000)

  await db.insert(schema.refreshTokens).values({
    userId: user.id,
    tenantId: user.tenantId,
    tokenHash,
    expiresAt,
  })

  return { accessToken, refreshToken: rawRefreshToken }
}

async function handleSsoCallback(
  providerType: string,
  code: string,
  redirectUri: string,
  db: Db,
) {
  const provider = authProviderFactory.resolve(providerType)
  const tokenSet = await provider.exchangeCodeForToken(code, redirectUri)
  const profile = await provider.getUserProfile(tokenSet)

  const [existingUser] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.ssoProvider, profile.providerType),
        eq(schema.users.ssoSubject, profile.subject),
      ),
    )
    .limit(1)

  let user: { id: string; tenantId: string }

  if (existingUser) {
    await db
      .update(schema.users)
      .set({ displayName: profile.displayName, updatedAt: new Date() })
      .where(eq(schema.users.id, existingUser.id))
    user = { id: existingUser.id, tenantId: existingUser.tenantId }
  } else {
    const [ssoRow] = await db
      .select({ tenantId: schema.ssoProviders.tenantId })
      .from(schema.ssoProviders)
      .where(
        and(
          eq(schema.ssoProviders.providerType, providerType),
          eq(schema.ssoProviders.enabled, true),
        ),
      )
      .limit(1)

    const tenantId = ssoRow?.tenantId ?? config.masterTenantId

    const [newUser] = await db
      .insert(schema.users)
      .values({
        tenantId,
        email: profile.email,
        displayName: profile.displayName,
        ssoProvider: profile.providerType,
        ssoSubject: profile.subject,
      })
      .returning({ id: schema.users.id, tenantId: schema.users.tenantId })

    user = { id: newUser.id, tenantId: newUser.tenantId }
  }

  const tokens = await generateTokens(user, db)
  return { ...tokens, user }
}

async function refreshAccessToken(rawRefreshToken: string, db: Db) {
  const tokenHash = hashToken(rawRefreshToken)
  const now = new Date()

  const [row] = await db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash))
    .limit(1)

  if (!row || row.revokedAt !== null || row.expiresAt <= now) {
    const err = Object.assign(new Error('Invalid or expired refresh token'), { statusCode: 401 })
    throw err
  }

  const accessToken = await buildAccessToken(row.userId, row.tenantId, db)
  return { accessToken }
}

async function revokeRefreshToken(rawRefreshToken: string, db: Db) {
  const tokenHash = hashToken(rawRefreshToken)
  await db
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.refreshTokens.tokenHash, tokenHash))
}

export const authService = {
  generateTokens,
  handleSsoCallback,
  refreshAccessToken,
  revokeRefreshToken,
}
