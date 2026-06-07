import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { FileUploadZone } from './FileUploadZone'
import { DocumentItem } from './DocumentItem'
import type { DocumentListResponse } from '@repo/shared'

interface DocumentPanelProps {
  projectId: string
}

export function DocumentPanel({ projectId }: DocumentPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn: () => api.get<DocumentListResponse>(`/api/projects/${projectId}/documents`),
  })

  const count = data?.items.length ?? 0

  return (
    <div className="flex flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Documents</span>
          {!isLoading && <Badge variant="secondary">{count}</Badge>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={collapsed ? 'Expand documents panel' : 'Collapse documents panel'}
          className="h-7 w-7 p-0"
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              collapsed && '-rotate-90',
            )}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </Button>
      </div>

      {/* Collapsible content */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          collapsed ? 'max-h-0' : 'max-h-[50rem]',
        )}
      >
        <div className="flex flex-col gap-3 overflow-y-auto p-3">
          <FileUploadZone projectId={projectId} onUploaded={() => {}} />

          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <Skeleton className="h-8 w-8 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4 rounded" />
                    <Skeleton className="h-3 w-1/2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && count === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No documents yet. Upload files for AI context.
            </p>
          )}

          {!isLoading && data && count > 0 && (
            <div className="space-y-0.5">
              {data.items.map((doc) => (
                <DocumentItem key={doc.id} doc={doc} projectId={projectId} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
