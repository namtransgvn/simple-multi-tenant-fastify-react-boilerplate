import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema/index.js'
import { Permission } from '@repo/shared'
import type { CreateProjectRequest, ProjectResponse, UpdateProjectRequest } from '@repo/shared'

type Db = PostgresJsDatabase<typeof schema>

function toResponse(
  project: typeof schema.projects.$inferSelect,
  documentCount: number,
): ProjectResponse {
  return {
    id: project.id,
    tenantId: project.tenantId,
    ownerId: project.ownerId,
    name: project.name,
    description: project.description ?? null,
    documentCount,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

async function getDocumentCount(tenantId: string, projectId: string, db: Db): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(schema.documents)
    .where(and(eq(schema.documents.tenantId, tenantId), eq(schema.documents.projectId, projectId)))
  return result?.count ?? 0
}

async function listProjects(
  tenantId: string,
  { page, limit }: { page: number; limit: number },
  db: Db,
): Promise<{ items: ProjectResponse[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.tenantId, tenantId), isNull(schema.projects.deletedAt)))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: count() })
      .from(schema.projects)
      .where(and(eq(schema.projects.tenantId, tenantId), isNull(schema.projects.deletedAt))),
  ])

  const total = totalRows[0]?.count ?? 0

  let docCountMap = new Map<string, number>()
  if (rows.length > 0) {
    const projectIds = rows.map((p) => p.id)
    const docCounts = await db
      .select({ projectId: schema.documents.projectId, count: count() })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, tenantId),
          inArray(schema.documents.projectId, projectIds),
        ),
      )
      .groupBy(schema.documents.projectId)
    docCountMap = new Map(docCounts.map((d) => [d.projectId, d.count]))
  }

  return {
    items: rows.map((p) => toResponse(p, docCountMap.get(p.id) ?? 0)),
    total,
    page,
    limit,
  }
}

async function getProject(tenantId: string, projectId: string, db: Db): Promise<ProjectResponse> {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.tenantId, tenantId),
        eq(schema.projects.id, projectId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1)

  if (!project) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 })
  }

  const docCount = await getDocumentCount(tenantId, projectId, db)
  return toResponse(project, docCount)
}

async function createProject(
  tenantId: string,
  ownerId: string,
  data: CreateProjectRequest,
  db: Db,
): Promise<ProjectResponse> {
  const [project] = await db
    .insert(schema.projects)
    .values({ tenantId, ownerId, name: data.name, description: data.description })
    .returning()

  return toResponse(project!, 0)
}

async function updateProject(
  tenantId: string,
  projectId: string,
  requestUserId: string,
  data: UpdateProjectRequest,
  userPermissions: string[],
  db: Db,
): Promise<ProjectResponse> {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.tenantId, tenantId),
        eq(schema.projects.id, projectId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1)

  if (!project) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 })
  }

  if (project.ownerId !== requestUserId && !userPermissions.includes(Permission.ADMIN_MANAGE)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  }

  const [updated] = await db
    .update(schema.projects)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId))
    .returning()

  const docCount = await getDocumentCount(tenantId, projectId, db)
  return toResponse(updated!, docCount)
}

async function deleteProject(tenantId: string, projectId: string, db: Db): Promise<void> {
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.tenantId, tenantId),
        eq(schema.projects.id, projectId),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1)

  if (!project) {
    throw Object.assign(new Error('Project not found'), { statusCode: 404 })
  }

  await db
    .update(schema.projects)
    .set({ deletedAt: new Date() })
    .where(eq(schema.projects.id, projectId))
}

export const projectsService = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getDocumentCount,
}
