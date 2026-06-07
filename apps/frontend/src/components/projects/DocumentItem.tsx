import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDate } from '@/lib/utils'
import type { DocumentListResponse, DocumentResponse } from '@repo/shared'

interface DocumentItemProps {
  doc: DocumentResponse
  projectId: string
}

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const colorClass =
    ext === 'pdf'
      ? 'text-red-500'
      : ext === 'docx'
        ? 'text-blue-500'
        : ext === 'md'
          ? 'text-purple-500'
          : 'text-muted-foreground'

  return (
    <svg
      className={`h-8 w-8 shrink-0 ${colorClass}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  )
}

export function DocumentItem({ doc, projectId }: DocumentItemProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () =>
      api.delete<void>(`/api/projects/${projectId}/documents/${doc.id}`),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['documents', projectId] })
      const previous = queryClient.getQueryData<DocumentListResponse>([
        'documents',
        projectId,
      ])
      queryClient.setQueryData<DocumentListResponse>(
        ['documents', projectId],
        (old) => (old ? { items: old.items.filter((d) => d.id !== doc.id) } : old),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['documents', projectId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId] })
    },
  })

  return (
    <>
      <div className="group flex items-center gap-3 rounded-md p-2 hover:bg-accent/50">
        <FileIcon filename={doc.filename} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={doc.filename}>
            {doc.filename}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(doc.sizeBytes)} &middot; {formatDate(doc.createdAt)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${doc.filename}`}
          className="h-7 w-7 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={mutation.isPending}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
            />
          </svg>
        </Button>
      </div>

      <AlertDialog
        open={confirmOpen}
        title="Delete document"
        description={`"${doc.filename}" will be permanently removed and can no longer be used as AI context.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmOpen(false)
          mutation.mutate()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
