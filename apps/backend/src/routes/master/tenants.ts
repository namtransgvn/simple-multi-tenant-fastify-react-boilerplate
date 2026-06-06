import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../../db/index.js'
import { tenantsService } from '../../services/tenants.service.js'
import { requirePermission } from '../../hooks/permission-guard.js'
import { Permission, CreateTenantRequestSchema } from '@repo/shared'
import { config } from '../../config.js'

async function masterTenantsRoutes(fastify: FastifyInstance): Promise<void> {
  const masterOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.tenantId !== config.masterTenantId) {
      return reply.forbidden('This endpoint is restricted to master-tenant users')
    }
  }

  const guard = {
    preHandler: [masterOnly, requirePermission(Permission.TENANT_MANAGE)],
  }

  fastify.post<{ Body: unknown }>('/', guard, async (request, reply) => {
    const parsed = CreateTenantRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
    }
    const tenant = await tenantsService.createTenant(parsed.data, db)
    return reply.status(201).send(tenant)
  })

  fastify.post<{ Params: { tenantId: string } }>(
    '/:tenantId/allow-fallback',
    guard,
    async (request, reply) => {
      await tenantsService.setFallbackAllowed(request.params.tenantId, true, db)
      return reply.status(204).send()
    },
  )

  fastify.post<{ Params: { tenantId: string } }>(
    '/:tenantId/deny-fallback',
    guard,
    async (request, reply) => {
      await tenantsService.setFallbackAllowed(request.params.tenantId, false, db)
      return reply.status(204).send()
    },
  )
}

export default masterTenantsRoutes
