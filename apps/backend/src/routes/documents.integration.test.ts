/**
 * Integration tests for /api/projects/:projectId/documents/* routes.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *
 * Run:
 *   pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { config } from '../config.js'
import { Permission } from '@repo/shared'

// ─── test state ──────────────────────────────────────────────────────────────

let app: FastifyInstance
let testTenantId: string
let otherTenantId: string
let testUserId: string
let testProjectId: string
let docToken: string
let noPermToken: string

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

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** Build a multipart/form-data body with a single "file" field. */
function multipartFile(
  filename: string,
  content: string | Buffer,
  mimeType: string,
): { headers: { 'content-type': string }; body: Buffer } {
  const boundary = 'TestBoundary1234567890ABCDEF'
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  }
}

// ─── setup / teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  const slug = `docs-test-${Date.now()}`

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: 'Docs Test Tenant', slug })
    .returning({ id: schema.tenants.id })
  testTenantId = tenant.id

  const [other] = await db
    .insert(schema.tenants)
    .values({ name: 'Docs Other Tenant', slug: `docs-other-${Date.now()}` })
    .returning({ id: schema.tenants.id })
  otherTenantId = other.id

  const [user] = await db
    .insert(schema.users)
    .values({ tenantId: testTenantId, email: `docs-user-${Date.now()}@example.com` })
    .returning({ id: schema.users.id })
  testUserId = user.id

  const [project] = await db
    .insert(schema.projects)
    .values({ tenantId: testTenantId, ownerId: testUserId, name: 'Test Project' })
    .returning({ id: schema.projects.id })
  testProjectId = project.id

  docToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [Permission.DOCUMENT_MANAGE],
  })

  noPermToken = makeJwt({
    userId: testUserId,
    tenantId: testTenantId,
    roles: [],
    permissions: [],
  })

  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await db.delete(schema.documents).where(eq(schema.documents.tenantId, testTenantId))
  await db.delete(schema.projects).where(eq(schema.projects.tenantId, testTenantId))
  await db.delete(schema.users).where(eq(schema.users.id, testUserId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, testTenantId))
  await db.delete(schema.tenants).where(eq(schema.tenants.id, otherTenantId))
  try {
    await rm(join(config.uploadDir, testTenantId), { recursive: true, force: true })
  } catch {
    // uploadDir may not exist if no files were written
  }
  await app.close()
})

afterEach(async () => {
  await db.delete(schema.documents).where(eq(schema.documents.tenantId, testTenantId))
})

// ─── GET /api/projects/:projectId/documents ───────────────────────────────────

describe('GET /api/projects/:projectId/documents', () => {
  it('returns 401 without an auth token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${testProjectId}/documents`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with an empty items array when no documents exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${testProjectId}/documents`,
      headers: authHeader(docToken),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ items: unknown[] }>().items).toEqual([])
  })

  it('returns uploaded documents in the list', async () => {
    await db.insert(schema.documents).values({
      tenantId: testTenantId,
      projectId: testProjectId,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      contentText: 'some notes',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${testProjectId}/documents`,
      headers: authHeader(docToken),
    })

    expect(res.statusCode).toBe(200)
    const items = res.json<{ items: { filename: string }[] }>().items
    expect(items).toHaveLength(1)
    expect(items[0].filename).toBe('notes.txt')
    expect(items[0]).not.toHaveProperty('contentText')
  })
})

// ─── POST /api/projects/:projectId/documents ──────────────────────────────────

describe('POST /api/projects/:projectId/documents', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      ...multipartFile('test.txt', 'hello', 'text/plain'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks document:manage permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: { ...authHeader(noPermToken), ...multipartFile('x.txt', 'x', 'text/plain').headers },
      body: multipartFile('x.txt', 'x', 'text/plain').body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 201 and stores a text/plain document', async () => {
    const content = 'The quick brown fox.'
    const { headers, body } = multipartFile('report.txt', content, 'text/plain')

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: { ...authHeader(docToken), ...headers },
      body,
    })

    expect(res.statusCode).toBe(201)
    const doc = res.json<Record<string, unknown>>()
    expect(doc.filename).toBe('report.txt')
    expect(doc.mimeType).toBe('text/plain')
    expect(doc.sizeBytes).toBe(Buffer.from(content).byteLength)
    expect(doc.id).toBeTypeOf('string')
    expect(doc.projectId).toBe(testProjectId)
    expect(doc).not.toHaveProperty('contentText')
  })

  it('returns 201 and stores a text/markdown document', async () => {
    const { headers, body } = multipartFile('readme.md', '# Hello', 'text/markdown')

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: { ...authHeader(docToken), ...headers },
      body,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json<{ mimeType: string }>().mimeType).toBe('text/markdown')
  })

  it('stores contentText in the database for a text/plain upload', async () => {
    const content = 'Stored content.'
    const { headers, body } = multipartFile('store.txt', content, 'text/plain')

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: { ...authHeader(docToken), ...headers },
      body,
    })
    expect(res.statusCode).toBe(201)

    const docId = res.json<{ id: string }>().id
    const [row] = await db
      .select({ contentText: schema.documents.contentText })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId))
    expect(row?.contentText).toBe(content)
  })

  it('returns 400 for a disallowed MIME type', async () => {
    const { headers, body } = multipartFile('photo.jpg', 'fake jpeg', 'image/jpeg')

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: { ...authHeader(docToken), ...headers },
      body,
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when no file is attached', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${testProjectId}/documents`,
      headers: {
        ...authHeader(docToken),
        'content-type': 'multipart/form-data; boundary=empty',
      },
      body: Buffer.from('--empty--\r\n'),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─── DELETE /api/projects/:projectId/documents/:docId ─────────────────────────

describe('DELETE /api/projects/:projectId/documents/:docId', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${testProjectId}/documents/00000000-0000-0000-0000-000000000001`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when user lacks document:manage permission', async () => {
    const [doc] = await db
      .insert(schema.documents)
      .values({
        tenantId: testTenantId,
        projectId: testProjectId,
        filename: 'x.txt',
        mimeType: 'text/plain',
        sizeBytes: 1,
      })
      .returning()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${testProjectId}/documents/${doc.id}`,
      headers: authHeader(noPermToken),
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 204 and removes the document from the DB', async () => {
    const [doc] = await db
      .insert(schema.documents)
      .values({
        tenantId: testTenantId,
        projectId: testProjectId,
        filename: 'delete-me.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        contentText: 'bye',
      })
      .returning()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${testProjectId}/documents/${doc.id}`,
      headers: authHeader(docToken),
    })
    expect(res.statusCode).toBe(204)

    const rows = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, doc.id))
    expect(rows).toHaveLength(0)
  })

  it('returns 404 for a non-existent document', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${testProjectId}/documents/00000000-0000-0000-0000-000000000099`,
      headers: authHeader(docToken),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ─── tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('does not list documents that belong to another tenant\'s project', async () => {
    const [otherUser] = await db
      .insert(schema.users)
      .values({ tenantId: otherTenantId, email: `dociso-${Date.now()}@example.com` })
      .returning({ id: schema.users.id })
    const [otherProject] = await db
      .insert(schema.projects)
      .values({ tenantId: otherTenantId, ownerId: otherUser.id, name: 'Other Project' })
      .returning({ id: schema.projects.id })
    await db.insert(schema.documents).values({
      tenantId: otherTenantId,
      projectId: otherProject.id,
      filename: 'secret.txt',
      mimeType: 'text/plain',
      sizeBytes: 6,
      contentText: 'secret',
    })

    // Our test tenant's token tries to list documents from the other project
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${otherProject.id}/documents`,
      headers: authHeader(docToken),
    })

    // Either 200 with empty list (tenant_id filter) or 404 — both are acceptable isolation outcomes
    if (res.statusCode === 200) {
      expect(res.json<{ items: unknown[] }>().items).toHaveLength(0)
    } else {
      expect(res.statusCode).toBe(404)
    }

    // Cleanup
    await db.delete(schema.documents).where(eq(schema.documents.tenantId, otherTenantId))
    await db.delete(schema.projects).where(eq(schema.projects.id, otherProject.id))
    await db.delete(schema.users).where(eq(schema.users.id, otherUser.id))
  })

  it('cannot delete a document from another tenant\'s project', async () => {
    const [otherUser] = await db
      .insert(schema.users)
      .values({ tenantId: otherTenantId, email: `dociso2-${Date.now()}@example.com` })
      .returning({ id: schema.users.id })
    const [otherProject] = await db
      .insert(schema.projects)
      .values({ tenantId: otherTenantId, ownerId: otherUser.id, name: 'Other P' })
      .returning({ id: schema.projects.id })
    const [otherDoc] = await db
      .insert(schema.documents)
      .values({
        tenantId: otherTenantId,
        projectId: otherProject.id,
        filename: 'private.txt',
        mimeType: 'text/plain',
        sizeBytes: 3,
      })
      .returning({ id: schema.documents.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${otherProject.id}/documents/${otherDoc.id}`,
      headers: authHeader(docToken),
    })
    expect(res.statusCode).toBe(404)

    // Confirm the other tenant's document was not deleted
    const rows = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, otherDoc.id))
    expect(rows).toHaveLength(1)

    // Cleanup
    await db.delete(schema.documents).where(eq(schema.documents.id, otherDoc.id))
    await db.delete(schema.projects).where(eq(schema.projects.id, otherProject.id))
    await db.delete(schema.users).where(eq(schema.users.id, otherUser.id))
  })
})
