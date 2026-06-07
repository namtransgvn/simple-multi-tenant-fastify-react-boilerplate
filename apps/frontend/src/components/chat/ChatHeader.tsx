import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'
import { useProjectStore } from '@/stores/projectStore'
import { ProviderSelector } from './ProviderSelector'
import type { ProjectResponse } from '@repo/shared'

export function ChatHeader() {
  const newSession = useChatStore((s) => s.newSession)
  const projectId = useProjectStore((s) => s.selectedProjectId)

  const { data: project } = useQuery({
    queryKey: ['projects', projectId],
    queryFn: () => api.get<ProjectResponse>(`/api/projects/${projectId}`),
    enabled: !!projectId,
  })

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <span className="min-w-0 truncate text-sm font-semibold">
        {project?.name ?? 'Chat'}
      </span>
      <div className="flex items-center gap-3">
        <ProviderSelector />
        <Button variant="outline" size="sm" onClick={newSession}>
          New chat
        </Button>
      </div>
    </div>
  )
}
