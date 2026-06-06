import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ulid } from 'ulid'
import { db } from '../db/index.js'
import { ChatRequestSchema, Permission } from '@repo/shared'
import { aiProviderFactory } from '../providers/ai/factory.js'
import { tenantAiProvidersService } from '../services/tenant-ai-providers.service.js'
import { documentsService } from '../services/documents.service.js'
import { projectsService } from '../services/projects.service.js'
import { chatService } from '../services/chat.service.js'
import { requirePermission } from '../hooks/permission-guard.js'

const SYSTEM_PROMPT_PREFIX =
  'You are an AI assistant. Use the following documents as context for your responses.\n\n'

async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: unknown }>(
    '/',
    { preHandler: [requirePermission(Permission.CHAT_USE)] },
    async (request, reply) => {
      const parsed = ChatRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }

      const { projectId, messages, provider: providerType, model } = parsed.data
      const tenantId = request.tenantId!

      // 1. Verify project belongs to tenant
      try {
        await projectsService.getProject(tenantId, projectId, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Project not found')
        throw err
      }

      // 2. Permission is enforced by preHandler requirePermission(CHAT_USE)

      // 3. Resolve provider implementation — 400 if unrecognised
      let provider
      try {
        provider = aiProviderFactory.resolve(providerType)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 400) return reply.badRequest((err as Error).message)
        throw err
      }

      // 4. Resolve API key + keySource — 400 if not configured/enabled
      let apiKey: string
      let keySource: 'tenant' | 'platform'
      try {
        const resolved = await tenantAiProvidersService.resolveApiKey(tenantId, providerType, db)
        apiKey = resolved.apiKey
        keySource = resolved.keySource
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 400) return reply.badRequest((err as Error).message)
        throw err
      }

      // 5. Validate model is in tenant's allowedModels list — 400 if not permitted
      try {
        await tenantAiProvidersService.validateModelAllowed(tenantId, providerType, model, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 400) return reply.badRequest((err as Error).message)
        throw err
      }

      // 6. Build system prompt from project documents
      const context = await documentsService.getProjectContext(tenantId, projectId, db)
      const systemPrompt = SYSTEM_PROMPT_PREFIX + context

      // 7. Take ownership of the raw response for SSE
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sessionId = randomUUID()
      const chunks: string[] = []
      let aborted = false

      const onClose = () => {
        aborted = true
      }
      request.raw.socket?.on('close', onClose)

      // 8. Iterate the AI stream, emitting each chunk as an SSE event
      try {
        const stream = provider.streamChat(apiKey, messages, systemPrompt, model)
        for await (const chunk of stream) {
          if (aborted) break
          chunks.push(chunk)
          reply.raw.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`)
        }

        // 9. On completion: emit done, end stream, fire-and-forget persist
        if (!aborted) {
          reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`)
          reply.raw.end()

          const fullContent = chunks.join('')
          chatService
            .saveMessage(tenantId, projectId, sessionId, 'assistant', fullContent, providerType, model, keySource, db)
            .catch((saveErr) => {
              const errorId = `err_${ulid()}`
              request.log.error({ err: saveErr, errorId }, 'Failed to persist chat message')
            })
        } else {
          reply.raw.end()
        }
      } catch (err) {
        // 10. On provider error: emit error event, end stream
        if (!aborted) {
          const errorId = `err_${ulid()}`
          request.log.error({ err, errorId }, 'Chat stream error')
          reply.raw.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
          reply.raw.end()
        }
      } finally {
        request.raw.socket?.off('close', onClose)
      }
    },
  )
}

export default chatRoutes
