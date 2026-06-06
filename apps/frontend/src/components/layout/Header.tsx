import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useProjectStore } from '@/stores/projectStore'
import { api } from '@/lib/api'
import type { ProjectResponse } from '@repo/shared'

export function Header() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId)

  const { data: project } = useQuery({
    queryKey: ['projects', selectedProjectId],
    queryFn: () => api.get<ProjectResponse>(`/api/projects/${selectedProjectId}`),
    enabled: selectedProjectId !== null,
  })

  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="text-sm font-medium truncate">{project?.name ?? ''}</div>
      <div className="flex items-center gap-3 shrink-0">
        {user && (
          <span className="text-sm text-muted-foreground truncate max-w-[200px]">
            {user.userId}
          </span>
        )}
        <button
          onClick={logout}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
