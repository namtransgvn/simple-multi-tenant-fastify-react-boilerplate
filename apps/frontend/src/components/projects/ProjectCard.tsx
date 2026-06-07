import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ProjectResponse } from '@repo/shared'

interface ProjectCardProps {
  project: ProjectResponse
  onClick: () => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <p className="font-semibold truncate">{project.name}</p>
      </CardHeader>
      <CardContent>
        {project.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {project.description}
          </p>
        )}
        <div className="flex items-center justify-between text-xs">
          <Badge variant="secondary">{project.documentCount} documents</Badge>
          <span className="text-muted-foreground">{formatDate(project.updatedAt)}</span>
        </div>
      </CardContent>
    </Card>
  )
}
