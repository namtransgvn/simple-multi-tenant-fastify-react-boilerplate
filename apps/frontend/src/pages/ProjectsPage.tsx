import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/lib/api'
import type { ProjectListResponse } from '@repo/shared'

export function ProjectsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectListResponse>('/api/projects'),
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId/chat"
              params={{ projectId: project.id }}
              className="block p-4 border border-border rounded-md hover:bg-accent transition-colors"
            >
              <div className="font-medium">{project.name}</div>
              {project.description && (
                <div className="text-sm text-muted-foreground mt-1">
                  {project.description}
                </div>
              )}
            </Link>
          ))}
          {data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No projects yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
