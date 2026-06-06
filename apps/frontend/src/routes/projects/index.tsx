import { createFileRoute } from '@tanstack/react-router'
import { queryClient } from '@/lib/queryClient'
import { api } from '@/lib/api'
import { ProjectsPage } from '@/pages/ProjectsPage'
import type { ProjectListResponse } from '@repo/shared'

export const Route = createFileRoute('/projects/')({
  loader: () =>
    queryClient.ensureQueryData({
      queryKey: ['projects'],
      queryFn: () => api.get<ProjectListResponse>('/api/projects'),
    }),
  component: ProjectsPage,
})
