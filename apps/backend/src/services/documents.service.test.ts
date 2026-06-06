import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — must precede any import that transitively loads config.ts or fs.
vi.mock('../config.js', () => ({
  config: {
    uploadDir: '/tmp/test-uploads',
    masterTenantId: '00000000-0000-0000-0000-000000000001',
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: vi.fn().mockResolvedValue({ text: 'extracted pdf text' }),
  })),
}))

vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'extracted docx text' }),
}))

import { documentsService } from './documents.service.js'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import * as mammoth from 'mammoth'

// ─── helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-0001'
const PROJECT_ID = 'proj-uuid-0001'
const DOC_ID = 'doc-uuid-0001'

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

function docRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    tenantId: TENANT_ID,
    projectId: PROJECT_ID,
    filename: 'test.txt',
    mimeType: 'text/plain',
    sizeBytes: 11,
    contentText: 'hello world',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ─── listDocuments ────────────────────────────────────────────────────────────

describe('documentsService.listDocuments', () => {
  it('returns an empty array when no documents exist', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const result = await documentsService.listDocuments(TENANT_ID, PROJECT_ID, db as any)
    expect(result).toEqual([])
  })

  it('maps rows to DocumentResponse objects (no contentText exposed)', async () => {
    const row = docRow()
    const db = mockDb({ selectSeq: [[row]] })

    const [item] = await documentsService.listDocuments(TENANT_ID, PROJECT_ID, db as any)

    expect(item.id).toBe(DOC_ID)
    expect(item.projectId).toBe(PROJECT_ID)
    expect(item.filename).toBe('test.txt')
    expect(item.mimeType).toBe('text/plain')
    expect(item.sizeBytes).toBe(11)
    expect(item.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(item).not.toHaveProperty('contentText')
    expect(item).not.toHaveProperty('tenantId')
  })

  it('returns all documents for the project', async () => {
    const rows = [docRow(), docRow({ id: 'doc-uuid-0002', filename: 'two.txt' })]
    const db = mockDb({ selectSeq: [rows] })
    const result = await documentsService.listDocuments(TENANT_ID, PROJECT_ID, db as any)
    expect(result).toHaveLength(2)
  })
})

// ─── saveDocument — text extraction ──────────────────────────────────────────

describe('documentsService.saveDocument — text extraction', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockClear()
    vi.mocked(writeFile).mockClear()
  })

  it('extracts text from text/plain by decoding buffer as utf-8', async () => {
    const content = 'hello world'
    const buffer = Buffer.from(content, 'utf-8')
    const db = mockDb({ insertReturn: [docRow({ contentText: content })] })

    const result = await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: buffer.byteLength, buffer },
      db as any,
    )

    const insertCall = vi.mocked(db.insert).mock.calls[0]
    expect(insertCall).toBeDefined()
    // values() is called on the thenable; verify the inserted contentText
    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall?.contentText).toBe(content)
    expect(result.id).toBe(DOC_ID)
  })

  it('extracts text from text/markdown the same way as text/plain', async () => {
    const content = '# Heading\n\nParagraph.'
    const buffer = Buffer.from(content, 'utf-8')
    const db = mockDb({ insertReturn: [docRow({ contentText: content, mimeType: 'text/markdown' })] })

    await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      { filename: 'readme.md', mimeType: 'text/markdown', sizeBytes: buffer.byteLength, buffer },
      db as any,
    )

    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall?.contentText).toBe(content)
  })

  it('calls PDFParse for application/pdf and stores extracted text', async () => {
    const buffer = Buffer.from('%PDF-1.4 fake')
    const db = mockDb({
      insertReturn: [docRow({ filename: 'doc.pdf', mimeType: 'application/pdf', contentText: 'extracted pdf text' })],
    })

    const result = await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      { filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: buffer.byteLength, buffer },
      db as any,
    )

    expect(result.mimeType).toBe('application/pdf')
    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall?.contentText).toBe('extracted pdf text')
  })

  it('calls mammoth.extractRawText for docx and stores extracted text', async () => {
    const buffer = Buffer.from('PK fake docx bytes')
    const db = mockDb({
      insertReturn: [docRow({
        filename: 'doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        contentText: 'extracted docx text',
      })],
    })

    await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      {
        filename: 'doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: buffer.byteLength,
        buffer,
      },
      db as any,
    )

    expect(vi.mocked(mammoth.extractRawText)).toHaveBeenCalledWith({ buffer })
    const valuesCall = vi.mocked(db.insert().values as any).mock.calls[0]?.[0]
    expect(valuesCall?.contentText).toBe('extracted docx text')
  })
})

// ─── saveDocument — file persistence ─────────────────────────────────────────

describe('documentsService.saveDocument — file persistence', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockClear()
    vi.mocked(writeFile).mockClear()
  })

  it('creates the upload directory and writes the raw file buffer', async () => {
    const buffer = Buffer.from('test content')
    const db = mockDb({ insertReturn: [docRow()] })

    await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: buffer.byteLength, buffer },
      db as any,
    )

    expect(mkdir).toHaveBeenCalledWith(
      `/tmp/test-uploads/${TENANT_ID}/${PROJECT_ID}`,
      { recursive: true },
    )
    expect(writeFile).toHaveBeenCalledWith(
      `/tmp/test-uploads/${TENANT_ID}/${PROJECT_ID}/${DOC_ID}`,
      buffer,
    )
  })

  it('returns a DocumentResponse with correct fields', async () => {
    const buffer = Buffer.from('x')
    const row = docRow({ sizeBytes: 1 })
    const db = mockDb({ insertReturn: [row] })

    const result = await documentsService.saveDocument(
      TENANT_ID, PROJECT_ID,
      { filename: 'test.txt', mimeType: 'text/plain', sizeBytes: 1, buffer },
      db as any,
    )

    expect(result.id).toBe(DOC_ID)
    expect(result.projectId).toBe(PROJECT_ID)
    expect(result.sizeBytes).toBe(1)
    expect(result).not.toHaveProperty('contentText')
  })
})

// ─── deleteDocument ───────────────────────────────────────────────────────────

describe('documentsService.deleteDocument', () => {
  beforeEach(() => {
    vi.mocked(rm).mockClear()
  })

  it('deletes the DB row and removes the file from disk', async () => {
    const db = mockDb({
      selectSeq: [[{ id: DOC_ID }]],
      deleteReturn: [{ id: DOC_ID }],
    })

    await documentsService.deleteDocument(TENANT_ID, PROJECT_ID, DOC_ID, db as any)

    expect(db.delete).toHaveBeenCalledOnce()
    expect(rm).toHaveBeenCalledWith(`/tmp/test-uploads/${TENANT_ID}/${PROJECT_ID}/${DOC_ID}`)
  })

  it('throws 404 when the document does not exist', async () => {
    const db = mockDb({ selectSeq: [[]] })

    await expect(
      documentsService.deleteDocument(TENANT_ID, PROJECT_ID, DOC_ID, db as any),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Document not found' })
  })

  it('suppresses errors from rm when file is missing from disk', async () => {
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const db = mockDb({
      selectSeq: [[{ id: DOC_ID }]],
      deleteReturn: [{ id: DOC_ID }],
    })

    await expect(
      documentsService.deleteDocument(TENANT_ID, PROJECT_ID, DOC_ID, db as any),
    ).resolves.toBeUndefined()
  })
})

// ─── getProjectContext ────────────────────────────────────────────────────────

describe('documentsService.getProjectContext', () => {
  it('returns an empty string when there are no documents', async () => {
    const db = mockDb({ selectSeq: [[]] })
    const result = await documentsService.getProjectContext(TENANT_ID, PROJECT_ID, db as any)
    expect(result).toBe('')
  })

  it('formats each document as "=== filename ===\\ncontent\\n\\n"', async () => {
    const db = mockDb({
      selectSeq: [[
        { filename: 'a.txt', contentText: 'Content A' },
        { filename: 'b.txt', contentText: 'Content B' },
      ]],
    })

    const result = await documentsService.getProjectContext(TENANT_ID, PROJECT_ID, db as any)

    expect(result).toBe('=== a.txt ===\nContent A\n\n=== b.txt ===\nContent B\n\n')
  })

  it('skips documents with null contentText', async () => {
    const db = mockDb({
      selectSeq: [[
        { filename: 'a.txt', contentText: 'Has content' },
        { filename: 'b.txt', contentText: null },
      ]],
    })

    const result = await documentsService.getProjectContext(TENANT_ID, PROJECT_ID, db as any)

    expect(result).toBe('=== a.txt ===\nHas content\n\n')
    expect(result).not.toContain('b.txt')
  })
})
