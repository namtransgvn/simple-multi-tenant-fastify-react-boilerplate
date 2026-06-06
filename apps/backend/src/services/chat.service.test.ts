import { describe, it, expect, vi } from 'vitest'
import { chatService } from './chat.service.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-0001'
const PROJECT_ID = 'proj-uuid-0001'
const SESSION_ID = '00000000-0000-0000-0000-000000000099'

function thenable(value: unknown): any {
  const self: any = {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      Promise.resolve(value).then(resolve, reject)
    },
    returning: vi.fn().mockResolvedValue(value),
  }
  for (const m of ['values', 'from', 'where', 'limit']) {
    self[m] = vi.fn().mockReturnValue(self)
  }
  return self
}

function mockDb(opts: { insertReturn?: unknown } = {}) {
  const { insertReturn = [{ id: 'msg-uuid-001' }] } = opts
  return {
    insert: vi.fn().mockReturnValue(thenable(insertReturn)),
  }
}

// ─── saveMessage ─────────────────────────────────────────────────────────────

describe('chatService.saveMessage', () => {
  it('inserts a row with all provided fields', async () => {
    const db = mockDb()

    await chatService.saveMessage(
      TENANT_ID, PROJECT_ID, SESSION_ID,
      'assistant', 'Hello world', 'anthropic', 'claude-sonnet-4-5',
      'tenant', db as any,
    )

    expect(db.insert).toHaveBeenCalledOnce()
    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall).toMatchObject({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      role: 'assistant',
      content: 'Hello world',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      keySource: 'tenant',
    })
  })

  it('persists keySource "platform" when the platform key was used', async () => {
    const db = mockDb()

    await chatService.saveMessage(
      TENANT_ID, PROJECT_ID, SESSION_ID,
      'assistant', 'Platform response', 'openai', 'gpt-4o',
      'platform', db as any,
    )

    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall?.keySource).toBe('platform')
  })

  it('resolves with undefined (void)', async () => {
    const db = mockDb()

    await expect(
      chatService.saveMessage(
        TENANT_ID, PROJECT_ID, SESSION_ID,
        'assistant', 'Test', 'gemini', 'gemini-1.5-pro', 'tenant', db as any,
      ),
    ).resolves.toBeUndefined()
  })
})
