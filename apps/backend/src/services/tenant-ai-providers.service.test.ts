import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — must precede any import that transitively loads config.ts or crypto.ts.
vi.mock('../config.js', () => ({
  config: {
    masterTenantId: '00000000-0000-0000-0000-000000000001',
    aiKeyEncryptionSecret: 'a'.repeat(64),
  },
}))

vi.mock('../lib/crypto.js', () => ({
  encryptApiKey: vi.fn((key: string) => `enc:${key}`),
  decryptApiKey: vi.fn((enc: string) => enc.replace(/^enc:/, '')),
}))

import { tenantAiProvidersService } from './tenant-ai-providers.service.js'
import { encryptApiKey } from '../lib/crypto.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-0001'
const MASTER_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Builds a chainable thenable that resolves to `value`.
 * All intermediate Drizzle query builder methods return `self`,
 * and `.returning()` resolves to the same `value`.
 */
function thenable(value: unknown): any {
  const self: any = {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      Promise.resolve(value).then(resolve, reject)
    },
    returning: vi.fn().mockResolvedValue(value),
  }
  for (const m of ['from', 'innerJoin', 'where', 'limit', 'set', 'values', 'onConflictDoUpdate']) {
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

/** Minimal provider row returned from Drizzle select */
function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-uuid-001',
    tenantId: TENANT_ID,
    providerType: 'anthropic',
    encryptedApiKey: 'enc:sk-ant-test',
    enabled: true,
    allowedModels: [] as string[],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

// ─── listProviders ────────────────────────────────────────────────────────────

describe('tenantAiProvidersService.listProviders', () => {
  it('returns an empty array when no providers are configured', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const result = await tenantAiProvidersService.listProviders(TENANT_ID, db as any)
    expect(result).toEqual([])
  })

  it('maps rows to response objects with hasKey: true and no encryptedApiKey', async () => {
    const row = providerRow({ allowedModels: ['claude-sonnet-4-5'] })
    const db = mockDb({ selectSeq: [[row]] })

    const [item] = await tenantAiProvidersService.listProviders(TENANT_ID, db as any)

    expect(item.id).toBe(row.id)
    expect(item.providerType).toBe('anthropic')
    expect(item.enabled).toBe(true)
    expect(item.allowedModels).toEqual(['claude-sonnet-4-5'])
    expect(item.hasKey).toBe(true)
    expect(item).not.toHaveProperty('encryptedApiKey')
    expect(item.createdAt).toBe(row.createdAt.toISOString())
    expect(item.updatedAt).toBe(row.updatedAt.toISOString())
  })

  it('returns all provider rows for the tenant', async () => {
    const rows = [
      providerRow({ providerType: 'anthropic' }),
      providerRow({ id: 'prov-uuid-002', providerType: 'openai' }),
    ]
    const db = mockDb({ selectSeq: [rows] })

    const result = await tenantAiProvidersService.listProviders(TENANT_ID, db as any)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.providerType)).toEqual(['anthropic', 'openai'])
  })
})

// ─── getEffectiveProviders ────────────────────────────────────────────────────

describe('tenantAiProvidersService.getEffectiveProviders', () => {
  it('returns providerTypes for enabled tenant providers', async () => {
    const db = mockDb({
      selectSeq: [
        [{ allowPlatformKeyFallback: false }],            // tenant row
        [{ providerType: 'anthropic' }, { providerType: 'openai' }], // tenant providers
      ],
    })

    const result = await tenantAiProvidersService.getEffectiveProviders(TENANT_ID, db as any)
    expect(result).toEqual(expect.arrayContaining(['anthropic', 'openai']))
    expect(result).toHaveLength(2)
  })

  it('returns empty array when no enabled providers and fallback is false', async () => {
    const db = mockDb({
      selectSeq: [
        [{ allowPlatformKeyFallback: false }],
        [],
      ],
    })

    const result = await tenantAiProvidersService.getEffectiveProviders(TENANT_ID, db as any)
    expect(result).toEqual([])
  })

  it('includes platform providers when allowPlatformKeyFallback is true', async () => {
    const db = mockDb({
      selectSeq: [
        [{ allowPlatformKeyFallback: true }],             // tenant row
        [{ providerType: 'anthropic' }],                  // tenant providers
        [{ providerType: 'anthropic' }, { providerType: 'gemini' }], // platform providers
      ],
    })

    const result = await tenantAiProvidersService.getEffectiveProviders(TENANT_ID, db as any)
    expect(result).toEqual(expect.arrayContaining(['anthropic', 'gemini']))
    expect(result).toHaveLength(2) // 'anthropic' deduplicated
  })

  it('does not query platform providers when allowPlatformKeyFallback is false', async () => {
    const db = mockDb({
      selectSeq: [
        [{ allowPlatformKeyFallback: false }],
        [],
      ],
    })

    await tenantAiProvidersService.getEffectiveProviders(TENANT_ID, db as any)
    // Only 2 selects: tenant row + tenant providers
    expect(db.select).toHaveBeenCalledTimes(2)
  })
})

// ─── resolveApiKey ──────────────────────────────────────────────────────────��─

describe('tenantAiProvidersService.resolveApiKey', () => {
  it('returns decrypted key with keySource "tenant" when tenant has enabled provider', async () => {
    const db = mockDb({
      selectSeq: [[providerRow({ encryptedApiKey: 'enc:sk-ant-secret', enabled: true })]],
    })

    const result = await tenantAiProvidersService.resolveApiKey(TENANT_ID, 'anthropic', db as any)

    expect(result.keySource).toBe('tenant')
    expect(result.apiKey).toBe('sk-ant-secret')
  })

  it('falls back to platform key when tenant has no config and allowPlatformKeyFallback is true', async () => {
    const db = mockDb({
      selectSeq: [
        [],                                                            // no tenant config
        [{ allowPlatformKeyFallback: true }],                         // tenant fallback enabled
        [providerRow({ tenantId: MASTER_ID, encryptedApiKey: 'enc:sk-platform', enabled: true })],
      ],
    })

    const result = await tenantAiProvidersService.resolveApiKey(TENANT_ID, 'anthropic', db as any)

    expect(result.keySource).toBe('platform')
    expect(result.apiKey).toBe('sk-platform')
  })

  it('falls back to platform key when tenant config is disabled and fallback is true', async () => {
    const db = mockDb({
      selectSeq: [
        [providerRow({ enabled: false })],                            // disabled tenant config
        [{ allowPlatformKeyFallback: true }],
        [providerRow({ tenantId: MASTER_ID, encryptedApiKey: 'enc:sk-platform', enabled: true })],
      ],
    })

    const result = await tenantAiProvidersService.resolveApiKey(TENANT_ID, 'anthropic', db as any)
    expect(result.keySource).toBe('platform')
  })

  it('throws 400 when no tenant config and fallback is false', async () => {
    const db = mockDb({
      selectSeq: [
        [],
        [{ allowPlatformKeyFallback: false }],
      ],
    })

    await expect(
      tenantAiProvidersService.resolveApiKey(TENANT_ID, 'anthropic', db as any),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("'anthropic'") })
  })

  it('throws 400 when fallback is enabled but platform has no matching provider', async () => {
    const db = mockDb({
      selectSeq: [
        [],
        [{ allowPlatformKeyFallback: true }],
        [],                                                           // platform has no provider
      ],
    })

    await expect(
      tenantAiProvidersService.resolveApiKey(TENANT_ID, 'gemini', db as any),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ─── validateModelAllowed ─────────────────────────────────────────────────────

describe('tenantAiProvidersService.validateModelAllowed', () => {
  it('does not throw when allowedModels is empty (all models permitted)', async () => {
    const db = mockDb({ selectSeq: [[{ allowedModels: [] }]] })

    await expect(
      tenantAiProvidersService.validateModelAllowed(TENANT_ID, 'anthropic', 'any-model', db as any),
    ).resolves.toBeUndefined()
  })

  it('does not throw when model is in allowedModels', async () => {
    const db = mockDb({ selectSeq: [[{ allowedModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'] }]] })

    await expect(
      tenantAiProvidersService.validateModelAllowed(TENANT_ID, 'anthropic', 'claude-sonnet-4-5', db as any),
    ).resolves.toBeUndefined()
  })

  it('throws 400 when model is not in allowedModels', async () => {
    const db = mockDb({ selectSeq: [[{ allowedModels: ['claude-haiku-4-5'] }]] })

    await expect(
      tenantAiProvidersService.validateModelAllowed(TENANT_ID, 'anthropic', 'claude-opus-4-5', db as any),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("'claude-opus-4-5'"),
    })
  })

  it('does not throw when no config row exists (no restriction)', async () => {
    const db = mockDb({ selectSeq: [[]] })

    await expect(
      tenantAiProvidersService.validateModelAllowed(TENANT_ID, 'anthropic', 'any-model', db as any),
    ).resolves.toBeUndefined()
  })
})

// ─── upsertProvider ───────────────────────────────────────────────────────────

describe('tenantAiProvidersService.upsertProvider', () => {
  beforeEach(() => {
    vi.mocked(encryptApiKey).mockClear()
  })

  it('encrypts the key and inserts/upserts the row when apiKey is non-empty', async () => {
    const row = providerRow()
    const db = mockDb({ insertReturn: [row] })

    const result = await tenantAiProvidersService.upsertProvider(
      TENANT_ID,
      { providerType: 'anthropic', apiKey: 'sk-new-key' },
      db as any,
    )

    expect(encryptApiKey).toHaveBeenCalledWith('sk-new-key')
    expect(db.insert).toHaveBeenCalledOnce()
    expect(result.providerType).toBe('anthropic')
    expect(result.hasKey).toBe(true)
    expect(result).not.toHaveProperty('encryptedApiKey')
  })

  it('sets allowedModels correctly when provided', async () => {
    const row = providerRow({ allowedModels: ['gpt-4o'] })
    const db = mockDb({ insertReturn: [row] })

    const result = await tenantAiProvidersService.upsertProvider(
      TENANT_ID,
      { providerType: 'openai', apiKey: 'sk-openai', allowedModels: ['gpt-4o'] },
      db as any,
    )

    expect(result.allowedModels).toEqual(['gpt-4o'])
  })

  it('updates without touching encrypted key when apiKey is empty string', async () => {
    const row = providerRow()
    const db = mockDb({ updateReturn: [row] })

    await tenantAiProvidersService.upsertProvider(
      TENANT_ID,
      { providerType: 'anthropic', apiKey: '' },
      db as any,
    )

    expect(encryptApiKey).not.toHaveBeenCalled()
    expect(db.update).toHaveBeenCalledOnce()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('throws 404 when updating a non-existent provider with empty apiKey', async () => {
    const db = mockDb({ updateReturn: [] }) // returning() resolves to []

    await expect(
      tenantAiProvidersService.upsertProvider(
        TENANT_ID,
        { providerType: 'gemini', apiKey: '' },
        db as any,
      ),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── setEnabled ───────────────────────────────────────────────────────────────

describe('tenantAiProvidersService.setEnabled', () => {
  it('resolves without error when the row exists', async () => {
    const db = mockDb({ updateReturn: [{ id: 'prov-uuid-001' }] })

    await expect(
      tenantAiProvidersService.setEnabled(TENANT_ID, 'anthropic', true, db as any),
    ).resolves.toBeUndefined()

    expect(db.update).toHaveBeenCalledOnce()
  })

  it('throws 404 when the provider row does not exist', async () => {
    const db = mockDb({ updateReturn: [] })

    await expect(
      tenantAiProvidersService.setEnabled(TENANT_ID, 'anthropic', false, db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ─── deleteProvider ───────────────────────────────────────────────────────────

describe('tenantAiProvidersService.deleteProvider', () => {
  it('resolves without error when the row exists', async () => {
    const db = mockDb({ deleteReturn: [{ id: 'prov-uuid-001' }] })

    await expect(
      tenantAiProvidersService.deleteProvider(TENANT_ID, 'anthropic', db as any),
    ).resolves.toBeUndefined()

    expect(db.delete).toHaveBeenCalledOnce()
  })

  it('throws 404 when the provider row does not exist', async () => {
    const db = mockDb({ deleteReturn: [] })

    await expect(
      tenantAiProvidersService.deleteProvider(TENANT_ID, 'openai', db as any),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
