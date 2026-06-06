/**
 * Integration tests for POST /api/chat.
 *
 * The AI provider factory is mocked so no real API calls are made.
 * Everything else (JWT, tenant guard, project lookup, provider config,
 * model validation, message persistence) runs against a real DB.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *
 * Run:
 *   pnpm test:integration
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { config } from '../config.js'
import { encryptApiKey } from '../lib/crypto.js'
import { Permission } from '@repo/shared'

// ─── AI factory mock ──────────────────────────────────────────────────────────
// vi.hoisted ensures these refs exist before the mock factory executes,
// which happens when app.ts (and transitively chat.ts) is first imported.

const { mockStreamChat, mockResolve } = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
  mockResolve: vi.fn(),
}))

vi.mock('../providers/ai/factory.js', () => ({
  aiProviderFactory: {
    resolve: mockResolve,
    getSupportedModels: vi.fn().mockReturnValue(['claude-sonnet-4-5', 'claude-haiku-4-5']),
  },
}))

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let otherTenantId: string
let testUserId: string
let otherUserId: string
let projectId: string
let otherProjectId: string
let chatToken: string        // has chat:use
let noPermToken: string      // no permissions
let otherTenantToken: string // chat:use but different tenant

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeJwt(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + 3600 }),
  ).toString('base64url')
  const sig = createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${sig}`
}

/** Build a complete inject options object with correct merged headers. */
function postJson(url: string, payload: unknown, token?: string) {
  return {
    method: 'POST' as const,
    url,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  }
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)))
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `chat-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Chat Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant.id

  const [other] = await db
    .insert(schema.tenants)
    .values({ name: 'Other Chat Tenant', slug: `other-chat-${Date.now()}` })
    .returning({ id: schema.tenants.id })
  otherTenantId = other.id

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `chat-user-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  testUserId = user.id

  const [otherUser] = await db
    .insert(schema.users)
    .values({ tenantId: otherTenantId, email: `other-chat-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  otherUserId = otherUser.id

  const [project] = await db
    .insert(schema.projects)
    .values({ tenantId: testTenantId, ownerId: testUserId, name: 'Test Project' })
    .returning({ id: schema.projects.id })
  projectId = project.id

  const [otherProject] = await db
    .insert(schema.projects)
    .values({ tenantId: otherTenantId, ownerId: otherUserId, name: 'Other Project' })
    .returning({ id: schema.projects.id })
  otherProjectId = otherProject.id

  chatToken = makeJwt({
    userId: testUserId, tenantId: testTenantId,
    roles: [], permissions: [Permission.CHAT_USE],
  })
  noPermToken = makeJwt({
    userId: testUserId, tenantId: testTenantId,
    roles: [], permissions: [],
  })
  otherTenantToken = makeJwt({
    userId: otherUserId, tenantId: otherTenantId,
    roles: [], permissions: [Permission.CHAT_USE],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db.delete(schema.messages).where(eq(schema.messages.tenantId, testTenantId))
  await db.delete(schema.messages).where(eq(schema.messages.tenantId, otherTenantId))
  await db.delete(schema.tenantAiProviders).where(eq(schema.tenantAiProviders.tenantId, testTenantId))
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
  await db.delete(schema.projects).where(eq(schema.projects.id, otherProjectId))
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.users).where(eq(schema.users.id, otherUserId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenantId))
  await app.close()
})

afterEach(async () => {
  await db.delete(schema.messages).where(eq(schema.messages.tenantId, testTenantId))
  await db.delete(schema.tenantAiProviders).where(eq(schema.tenantAiProviders.tenantId, testTenantId))
  mockStreamChat.mockReset()
  mockResolve.mockReset()
})

// ─── auth / permission guards ─────────────────────────────────────────────────

describe('POST /api/chat — auth and permission guards', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }))
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks chat:use permission', async () => {
    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }, noPermToken))
    expect(res.statusCode).toBe(403)
  })
})

// ─── request body validation ──────────────────────────────────────────────────

describe('POST /api/chat — body validation', () => {
  it('returns 400 when projectId is missing', async () => {
    const res = await app.inject(postJson('/api/chat', {
      messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }, chatToken))
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when provider is not a known value', async () => {
    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'unknown-llm', model: 'some-model',
    }, chatToken))
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when model is an empty string', async () => {
    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'anthropic', model: '',
    }, chatToken))
    expect(res.statusCode).toBe(400)
  })
})

// ─── project / provider / model validation ────────────────────────────────────

describe('POST /api/chat — project, provider, and model validation', () => {
  it('returns 404 for a non-existent project', async () => {
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })

    const res = await app.inject(postJson('/api/chat', {
      projectId: '00000000-0000-0000-0000-000000000099',
      messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }, chatToken))
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when provider is not configured for the tenant', async () => {
    // No tenantAiProviders row — resolveApiKey throws 400
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })

    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }, chatToken))
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when model is not in tenant allowedModels', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: encryptApiKey('fake-key'),
      allowedModels: ['claude-sonnet-4-5'],
      enabled: true,
    })
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })

    const res = await app.inject(postJson('/api/chat', {
      projectId, messages: [], provider: 'anthropic', model: 'claude-opus-4-5',
    }, chatToken))
    expect(res.statusCode).toBe(400)
    expect(res.json<{ message: string }>().message).toMatch(/not permitted/)
  })
})

// ─── happy path ───────────────────────────────────────────────────────────────

describe('POST /api/chat — happy path', () => {
  it('responds with SSE headers and streams delta chunks followed by a done event', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: encryptApiKey('fake-key'),
      allowedModels: [],
      enabled: true,
    })
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })
    mockStreamChat.mockImplementation(async function* () {
      yield 'Hello'
      yield ', world!'
    })

    const res = await app.inject(postJson('/api/chat', {
      projectId,
      messages: [{ role: 'user', content: 'Hi' }],
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    }, chatToken))

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['x-accel-buffering']).toBe('no')

    const events = parseSseEvents(res.body)
    expect(events).toContainEqual({ delta: 'Hello' })
    expect(events).toContainEqual({ delta: ', world!' })
    expect(events[events.length - 1]).toEqual({ done: true })
  })

  it('persists the assembled assistant message to the DB with correct fields', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: encryptApiKey('fake-key'),
      allowedModels: [],
      enabled: true,
    })
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })
    mockStreamChat.mockImplementation(async function* () {
      yield 'Saved'
      yield ' content'
    })

    await app.inject(postJson('/api/chat', {
      projectId,
      messages: [{ role: 'user', content: 'Store this' }],
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    }, chatToken))

    // saveMessage is fire-and-forget after reply.raw.end(); wait for it
    await vi.waitFor(async () => {
      const [msg] = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.projectId, projectId))
      expect(msg).toBeDefined()
      expect(msg?.content).toBe('Saved content')
      expect(msg?.role).toBe('assistant')
      expect(msg?.provider).toBe('anthropic')
      expect(msg?.model).toBe('claude-sonnet-4-5')
      expect(msg?.keySource).toBe('tenant')
      expect(msg?.tenantId).toBe(testTenantId)
    }, { timeout: 5000 })
  })

  it('emits an error SSE event when the provider stream throws', async () => {
    await db.insert(schema.tenantAiProviders).values({
      tenantId: testTenantId,
      providerType: 'anthropic',
      encryptedApiKey: encryptApiKey('fake-key'),
      allowedModels: [],
      enabled: true,
    })
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })
    mockStreamChat.mockImplementation(async function* () {
      yield 'partial'
      throw new Error('upstream provider error')
    })

    const res = await app.inject(postJson('/api/chat', {
      projectId,
      messages: [{ role: 'user', content: 'Cause an error' }],
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    }, chatToken))

    const events = parseSseEvents(res.body)
    const errorEvent = events.find((e) => 'error' in e)
    expect(errorEvent).toBeDefined()
    expect(errorEvent?.error).toBe('upstream provider error')
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('POST /api/chat — tenant isolation', () => {
  it('returns 404 when the project belongs to another tenant', async () => {
    // otherTenantToken is for otherTenantId — otherProjectId also belongs there
    // but chatToken is for testTenantId, which cannot see otherProjectId
    mockResolve.mockReturnValue({ streamChat: mockStreamChat })

    const res = await app.inject(postJson('/api/chat', {
      projectId: otherProjectId,
      messages: [], provider: 'anthropic', model: 'claude-sonnet-4-5',
    }, chatToken))
    expect(res.statusCode).toBe(404)
  })
})
