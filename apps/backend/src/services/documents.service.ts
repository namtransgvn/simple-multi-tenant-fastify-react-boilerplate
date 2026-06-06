import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import { config } from '../config.js'
import type { DocumentResponse } from '@repo/shared'

type Db = PostgresJsDatabase<typeof schema>

function toResponse(doc: typeof schema.documents.$inferSelect): DocumentResponse {
  return {
    id: doc.id,
    projectId: doc.projectId,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

async function extractText(mimeType: string, buffer: Buffer): Promise<string> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return buffer.toString('utf-8')
  }
  if (mimeType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    return result.text
  }
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  return ''
}

async function listDocuments(
  tenantId: string,
  projectId: string,
  db: Db,
): Promise<DocumentResponse[]> {
  const docs = await db
    .select()
    .from(schema.documents)
    .where(
      and(eq(schema.documents.tenantId, tenantId), eq(schema.documents.projectId, projectId)),
    )
  return docs.map(toResponse)
}

async function saveDocument(
  tenantId: string,
  projectId: string,
  file: { filename: string; mimeType: string; sizeBytes: number; buffer: Buffer },
  db: Db,
): Promise<DocumentResponse> {
  const contentText = await extractText(file.mimeType, file.buffer)

  const [doc] = await db
    .insert(schema.documents)
    .values({
      tenantId,
      projectId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      contentText,
    })
    .returning()

  const dir = join(config.uploadDir, tenantId, projectId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, doc!.id), file.buffer)

  return toResponse(doc!)
}

async function deleteDocument(
  tenantId: string,
  projectId: string,
  docId: string,
  db: Db,
): Promise<void> {
  const [doc] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.projectId, projectId),
        eq(schema.documents.id, docId),
      ),
    )
    .limit(1)

  if (!doc) {
    throw Object.assign(new Error('Document not found'), { statusCode: 404 })
  }

  await db.delete(schema.documents).where(eq(schema.documents.id, docId))

  try {
    await rm(join(config.uploadDir, tenantId, projectId, docId))
  } catch {
    // File may not exist on disk; DB row is the source of truth
  }
}

async function getProjectContext(tenantId: string, projectId: string, db: Db): Promise<string> {
  const docs = await db
    .select({ filename: schema.documents.filename, contentText: schema.documents.contentText })
    .from(schema.documents)
    .where(
      and(eq(schema.documents.tenantId, tenantId), eq(schema.documents.projectId, projectId)),
    )

  return docs
    .filter((d) => d.contentText)
    .map((d) => `=== ${d.filename} ===\n${d.contentText}\n\n`)
    .join('')
}

export const documentsService = {
  listDocuments,
  saveDocument,
  deleteDocument,
  getProjectContext,
}
