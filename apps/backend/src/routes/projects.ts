import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { projectsService } from '../services/projects.service.js'
import { requirePermission } from '../hooks/permission-guard.js'
import {
  CreateProjectRequestSchema,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  Permission,
  UpdateProjectRequestSchema,
} from '@repo/shared'
import documentsRoutes from './documents.js'

async function projectsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET / — list projects (paginated)
  fastify.get<{ Querystring: { page?: number; limit?: number } }>('/', async (request) => {
    const page = Math.max(1, Number(request.query.page ?? 1))
    const limit = Math.min(
      PAGINATION_MAX_LIMIT,
      Math.max(1, Number(request.query.limit ?? PAGINATION_DEFAULT_LIMIT)),
    )
    return projectsService.listProjects(request.tenantId!, { page, limit }, db)
  })

  // POST / — create a project
  fastify.post<{ Body: unknown }>(
    '/',
    { preHandler: [requirePermission(Permission.PROJECT_CREATE)] },
    async (request, reply) => {
      const parsed = CreateProjectRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      const result = await projectsService.createProject(
        request.tenantId!,
        request.user!.userId,
        parsed.data,
        db,
      )
      return reply.status(201).send(result)
    },
  )

  // GET /:projectId — get a single project
  fastify.get<{ Params: { projectId: string } }>('/:projectId', async (request, reply) => {
    try {
      return await projectsService.getProject(request.tenantId!, request.params.projectId, db)
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404) return reply.notFound('Project not found')
      throw err
    }
  })

  // PUT /:projectId — update a project (owner or admin:manage)
  fastify.put<{ Params: { projectId: string }; Body: unknown }>(
    '/:projectId',
    async (request, reply) => {
      const parsed = UpdateProjectRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.badRequest(parsed.error.errors[0]?.message ?? 'Invalid request body')
      }
      try {
        return await projectsService.updateProject(
          request.tenantId!,
          request.params.projectId,
          request.user!.userId,
          parsed.data,
          request.user!.permissions,
          db,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Project not found')
        if (statusCode === 403) return reply.forbidden('Only the project owner or an admin can update this project')
        throw err
      }
    },
  )

  // DELETE /:projectId — soft-delete a project
  fastify.delete<{ Params: { projectId: string } }>(
    '/:projectId',
    { preHandler: [requirePermission(Permission.PROJECT_DELETE)] },
    async (request, reply) => {
      try {
        await projectsService.deleteProject(request.tenantId!, request.params.projectId, db)
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404) return reply.notFound('Project not found')
        throw err
      }
      return reply.status(204).send()
    },
  )

  // Documents sub-routes inherit the :projectId param context
  await fastify.register(documentsRoutes, { prefix: '/:projectId/documents' })
}

export default projectsRoutes
