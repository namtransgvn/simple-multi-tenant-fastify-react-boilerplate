import { createFileRoute, redirect } from '@tanstack/react-router'
import { queryClient } from '@/lib/queryClient'
import { api } from '@/lib/api'
import { useProjectStore } from '@/stores/projectStore'
import { ChatPage } from '@/pages/ChatPage'
import type { ProjectResponse } from '@repo/shared'

export const Route = createFileRoute('/projects/$projectId/chat')({
  loader: async ({ params }) => {
    try {
      await queryClient.ensureQueryData({
        queryKey: ['projects', params.projectId],
        queryFn: () =>
          api.get<ProjectResponse>(`/api/projects/${params.projectId}`),
      })
    } catch {
      throw redirect({ to: '/projects' })
    }
    useProjectStore.getState().selectProject(params.projectId)
  },
  component: ChatPage,
})
