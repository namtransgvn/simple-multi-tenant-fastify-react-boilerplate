import type { FastifyInstance } from 'fastify'
import { db } from '../../db/index.js'
import { tenantAiProvidersService } from '../../services/tenant-ai-providers.service.js'
import { requirePermission } from '../../hooks/permission-guard.js'
import { Permission, UpsertAiProviderRequestSchema, UpdateAiProviderRequestSchema } from '@repo/shared'

async function adminAiProvidersRoutes(fastify: FastifyInstance): Promise<void> {
  const guard = { preHandler: [requirePermission(Permission.ADMIN_MANAGE)] }

  // GET / — list all configured providers for the tenant (no keys returned)
  fastify.get('/', guard, async (request) => {
    return tenantAiProvidersService.listProviders(request.tenantId!, db)
  })

  // POST / — create or replace a provider entry
  fastify.post<{ Body: unknown }>('/', guard, async (request, reply) => {
    const parsed = UpsertAiProviderRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
    }
    const { providerType, apiKey, allowedModels } = parsed.data
    const result = await tenantAiProvidersService.upsertProvider(
      request.tenantId!,
      { providerType, apiKey, allowedModels },
      db,
    )
    return reply.status(201).send(result)
  })

  // PUT /:providerType — update an existing provider entry
  fastify.put<{ Params: { providerType: string }; Body: unknown }>(
    '/:providerType',
    guard,
    async (request, reply) => {
      const parsed = UpdateAiProviderRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      const { apiKey, allowedModels } = parsed.data
      let result
      try {
        result = await tenantAiProvidersService.upsertProvider(
          request.tenantId!,
          {
            providerType: request.params.providerType,
            apiKey: apiKey ?? '',
            allowedModels,
          },
          db,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Provider not found')
        throw err
      }
      return reply.send(result)
    },
  )

  // DELETE /:providerType — remove a provider entry
  fastify.delete<{ Params: { providerType: string } }>(
    '/:providerType',
    guard,
    async (request, reply) => {
      try {
        await tenantAiProvidersService.deleteProvider(request.tenantId!, request.params.providerType, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Provider not found')
        throw err
      }
      return reply.status(204).send()
    },
  )

  // PATCH /:providerType/enable — enable a provider
  fastify.patch<{ Params: { providerType: string } }>(
    '/:providerType/enable',
    guard,
    async (request, reply) => {
      try {
        await tenantAiProvidersService.setEnabled(request.tenantId!, request.params.providerType, true, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Provider not found')
        throw err
      }
      return reply.status(204).send()
    },
  )

  // PATCH /:providerType/disable — disable a provider
  fastify.patch<{ Params: { providerType: string } }>(
    '/:providerType/disable',
    guard,
    async (request, reply) => {
      try {
        await tenantAiProvidersService.setEnabled(request.tenantId!, request.params.providerType, false, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Provider not found')
        throw err
      }
      return reply.status(204).send()
    },
  )
}

export default adminAiProvidersRoutes
