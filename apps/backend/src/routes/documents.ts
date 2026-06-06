import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { documentsService } from '../services/documents.service.js'
import { requirePermission } from '../hooks/permission-guard.js'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, Permission } from '@repo/shared'

async function documentsRoutes(fastify: FastifyInstance): Promise<void> {
  const writeGuard = { preHandler: [requirePermission(Permission.DOCUMENT_MANAGE)] }

  // GET / — list documents for this project
  fastify.get<{ Params: { projectId: string } }>('/', async (request) => {
    const items = await documentsService.listDocuments(
      request.tenantId!,
      request.params.projectId,
      db,
    )
    return { items }
  })

  // POST / — upload a document
  fastify.post<{ Params: { projectId: string } }>('/', writeGuard, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.badRequest('No file provided')

    const mimeType = data.mimetype
    if (!ALLOWED_MIME_TYPES.includes(mimeType as (typeof ALLOWED_MIME_TYPES)[number])) {
      return reply.badRequest(`Unsupported file type: ${mimeType}`)
    }

    const buffer = await data.toBuffer()
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      return reply.badRequest(`File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes`)
    }

    const result = await documentsService.saveDocument(
      request.tenantId!,
      request.params.projectId,
      { filename: data.filename, mimeType, sizeBytes: buffer.byteLength, buffer },
      db,
    )
    return reply.status(201).send(result)
  })

  // DELETE /:docId — delete a document
  fastify.delete<{ Params: { projectId: string; docId: string } }>(
    '/:docId',
    writeGuard,
    async (request, reply) => {
      try {
        await documentsService.deleteDocument(
          request.tenantId!,
          request.params.projectId,
          request.params.docId,
          db,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Document not found')
        throw err
      }
      return reply.status(204).send()
    },
  )
}

export default documentsRoutes
