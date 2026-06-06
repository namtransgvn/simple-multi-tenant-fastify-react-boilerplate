import { describe, it, expect, vi } from 'vitest'

// Hoisted mock — projects.service does not use config but db/schema imports trigger it.
vi.mock('../config.js', () => ({
  config: {
    masterTenantId: '00000000-0000-0000-0000-000000000001',
    jwtSecret: 'unit-test-secret-at-least-32-chars-long!',
    uploadDir: './uploads',
  },
}))

import { projectsService } from './projects.service.js'
import { Permission } from '@repo/shared'

// ─── helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-0001'
const OWNER_ID = 'user-uuid-owner'
const OTHER_ID = 'user-uuid-other'
const PROJECT_ID = 'proj-uuid-0001'

/**
 * Builds a chainable thenable that resolves to `value`.
 * All Drizzle query builder methods return `self`; `.returning()` resolves to `value`.
 */
function thenable(value: unknown): any {
  const self: any = {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      Promise.resolve(value).then(resolve, reject)
    },
    returning: vi.fn().mockResolvedValue(value),
  }
  for (const m of [
    'from', 'innerJoin', 'leftJoin', 'where', 'limit', 'offset',
    'set', 'values', 'onConflictDoUpdate', 'groupBy', 'orderBy',
  ]) {
    self[m] = vi.fn().mockReturnValue(self)
  }
  return self
}

function mockDb(opts: {
  selectSeq?: unknown[]
  insertReturn?: unknown
  updateReturn?: unknown
  deleteReturn?: unknown
} = {}) {
  const { selectSeq = [], insertReturn = [], updateReturn = [], deleteReturn = [] } = opts
  let selectIdx = 0
  return {
    select: vi.fn().mockImplementation(() => thenable(selectSeq[selectIdx++] ?? [])),
    insert: vi.fn().mockReturnValue(thenable(insertReturn)),
    update: vi.fn().mockReturnValue(thenable(updateReturn)),
    delete: vi.fn().mockReturnValue(thenable(deleteReturn)),
  }
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    tenantId: TENANT_ID,
    ownerId: OWNER_ID,
    name: 'My Project',
    description: 'A description',
    deletedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-02T00:00:00Z'),
    ...overrides,
  }
}

// ─── listProjects ─────────────────────────────────────────────────────────────

describe('projectsService.listProjects', () => {
  it('returns empty items and total 0 when tenant has no projects', async () => {
    const db = mockDb({ selectSeq: [[], [{ count: 0 }]] })
    const result = await projectsService.listProjects(TENANT_ID, { page: 1, limit: 20 }, db as any)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('returns projects with correct fields and documentCount from batch query', async () => {
    const row = projectRow()
    const db = mockDb({
      selectSeq: [
        [row],
        [{ count: 1 }],
        [{ projectId: PROJECT_ID, count: 3 }],
      ],
    })

    const result = await projectsService.listProjects(TENANT_ID, { page: 1, limit: 20 }, db as any)

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    expect(item.id).toBe(PROJECT_ID)
    expect(item.tenantId).toBe(TENANT_ID)
    expect(item.ownerId).toBe(OWNER_ID)
    expect(item.name).toBe('My Project')
    expect(item.description).toBe('A description')
    expect(item.documentCount).toBe(3)
    expect(item.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(item.updatedAt).toBe('2025-01-02T00:00:00.000Z')
  })

  it('uses 0 for documentCount when no documents exist for a project', async () => {
    const row = projectRow()
    const db = mockDb({
      selectSeq: [[row], [{ count: 1 }], []],
    })

    const result = await projectsService.listProjects(TENANT_ID, { page: 1, limit: 20 }, db as any)
    expect(result.items[0].documentCount).toBe(0)
  })

  it('does not issue a document-count query when the page is empty', async () => {
    const db = mockDb({ selectSeq: [[], [{ count: 0 }]] })
    await projectsService.listProjects(TENANT_ID, { page: 1, limit: 20 }, db as any)
    // Only 2 selects: rows + count
    expect(db.select).toHaveBeenCalledTimes(2)
  })

  it('returns correct page and limit in the response', async () => {
    const db = mockDb({ selectSeq: [[], [{ count: 0 }]] })
    const result = await projectsService.listProjects(TENANT_ID, { page: 3, limit: 10 }, db as any)
    expect(result.page).toBe(3)
    expect(result.limit).toBe(10)
  })
})

// ─── getProject ───────────────────────────────────────────────────────────────

describe('projectsService.getProject', () => {
  it('returns a ProjectResponse with documentCount', async () => {
    const row = projectRow({ description: null })
    const db = mockDb({ selectSeq: [[row], [{ count: 7 }]] })

    const result = await projectsService.getProject(TENANT_ID, PROJECT_ID, db as any)

    expect(result.id).toBe(PROJECT_ID)
    expect(result.description).toBeNull()
    expect(result.documentCount).toBe(7)
  })

  it('throws 404 when no row is returned', async () => {
    const db = mockDb({ selectSeq: [[]] })
    await expect(
      projectsService.getProject(TENANT_ID, PROJECT_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Project not found' })
  })
})

// ─── createProject ────────────────────────────────────────────────────────────

describe('projectsService.createProject', () => {
  it('inserts a project and returns it with documentCount 0', async () => {
    const row = projectRow()
    const db = mockDb({ insertReturn: [row] })

    const result = await projectsService.createProject(
      TENANT_ID,
      OWNER_ID,
      { name: 'My Project', description: 'A description' },
      db as any,
    )

    expect(db.insert).toHaveBeenCalledOnce()
    expect(result.id).toBe(PROJECT_ID)
    expect(result.documentCount).toBe(0)
  })

  it('creates a project without a description', async () => {
    const row = projectRow({ description: null })
    const db = mockDb({ insertReturn: [row] })

    const result = await projectsService.createProject(
      TENANT_ID,
      OWNER_ID,
      { name: 'Minimal Project' },
      db as any,
    )
    expect(result.description).toBeNull()
    expect(result.documentCount).toBe(0)
  })
})

// ─── updateProject ────────────────────────────────────────────────────────────

describe('projectsService.updateProject', () => {
  it('updates successfully when requestUserId matches ownerId', async () => {
    const existing = projectRow()
    const updated = projectRow({ name: 'Renamed', updatedAt: new Date('2025-06-01T00:00:00Z') })
    const db = mockDb({
      selectSeq: [[existing], [{ count: 2 }]],
      updateReturn: [updated],
    })

    const result = await projectsService.updateProject(
      TENANT_ID, PROJECT_ID, OWNER_ID,
      { name: 'Renamed' }, [], db as any,
    )

    expect(db.update).toHaveBeenCalledOnce()
    expect(result.name).toBe('Renamed')
    expect(result.documentCount).toBe(2)
  })

  it('updates successfully when user is not owner but has ADMIN_MANAGE', async () => {
    const existing = projectRow()
    const updated = projectRow({ name: 'Admin Rename' })
    const db = mockDb({
      selectSeq: [[existing], [{ count: 0 }]],
      updateReturn: [updated],
    })

    await expect(
      projectsService.updateProject(
        TENANT_ID, PROJECT_ID, OTHER_ID,
        { name: 'Admin Rename' }, [Permission.ADMIN_MANAGE], db as any,
      ),
    ).resolves.toBeDefined()
  })

  it('throws 403 when user is not owner and lacks ADMIN_MANAGE', async () => {
    const existing = projectRow()
    const db = mockDb({ selectSeq: [[existing]] })

    await expect(
      projectsService.updateProject(
        TENANT_ID, PROJECT_ID, OTHER_ID,
        { name: 'Blocked' }, [], db as any,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 404 when project does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })

    await expect(
      projectsService.updateProject(
        TENANT_ID, PROJECT_ID, OWNER_ID,
        { name: 'X' }, [], db as any,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not throw 403 when user has PROJECT_UPDATE but is not owner (only ADMIN_MANAGE bypasses)', async () => {
    const existing = projectRow()
    const db = mockDb({ selectSeq: [[existing]] })

    await expect(
      projectsService.updateProject(
        TENANT_ID, PROJECT_ID, OTHER_ID,
        { name: 'Blocked' }, [Permission.PROJECT_UPDATE], db as any,
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ─── deleteProject ────────────────────────────────────────────────────────────

describe('projectsService.deleteProject', () => {
  it('calls db.update to set deletedAt when project exists', async () => {
    const db = mockDb({
      selectSeq: [[{ id: PROJECT_ID }]],
      updateReturn: [{ id: PROJECT_ID }],
    })

    await projectsService.deleteProject(TENANT_ID, PROJECT_ID, db as any)

    expect(db.update).toHaveBeenCalledOnce()
  })

  it('throws 404 when project does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })

    await expect(
      projectsService.deleteProject(TENANT_ID, PROJECT_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── getDocumentCount ─────────────────────────────────────────────────────────

describe('projectsService.getDocumentCount', () => {
  it('returns the count from the DB', async () => {
    const db = mockDb({ selectSeq: [[{ count: 9 }]] })
    const count = await projectsService.getDocumentCount(TENANT_ID, PROJECT_ID, db as any)
    expect(count).toBe(9)
  })

  it('returns 0 when select returns an empty array', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const count = await projectsService.getDocumentCount(TENANT_ID, PROJECT_ID, db as any)
    expect(count).toBe(0)
  })
})
