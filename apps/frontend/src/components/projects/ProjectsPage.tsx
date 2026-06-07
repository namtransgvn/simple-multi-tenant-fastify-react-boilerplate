import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ProjectCard } from './ProjectCard'
import { EmptyProjects } from './EmptyProjects'
import { CreateProjectModal } from './CreateProjectModal'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectListResponse } from '@repo/shared'

const LIMIT = 12

export function ProjectsPage() {
  const [showModal, setShowModal] = useState(false)
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const selectProject = useProjectStore((s) => s.selectProject)
  const tenantId = user?.tenantId ?? ''

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['projects', tenantId, page],
    queryFn: () =>
      api.get<ProjectListResponse>(`/api/projects?page=${page}&limit=${LIMIT}`),
    enabled: !!tenantId,
    placeholderData: (prev) => prev,
  })

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0

  function handleCardClick(projectId: string) {
    selectProject(projectId)
    navigate({ to: '/projects/$projectId/chat', params: { projectId } })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button onClick={() => setShowModal(true)}>New project</Button>
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-6 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              {error instanceof Error ? error.message : 'Failed to load projects'}
            </span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !isError && data?.items.length === 0 && (
        <EmptyProjects onCreateClick={() => setShowModal(true)} />
      )}

      {!isLoading && !isError && data && data.items.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => handleCardClick(project.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      <CreateProjectModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  )
}
