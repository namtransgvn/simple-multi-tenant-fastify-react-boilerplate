import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '@repo/shared'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DocumentResponse } from '@repo/shared'

interface FileUploadZoneProps {
  projectId: string
  onUploaded: () => void
}

function validateFile(file: File): string | null {
  const ext = ('.' + (file.name.split('.').pop() ?? '')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File too large. Maximum is ${MAX_FILE_SIZE_BYTES / 1_048_576} MB`
  }
  return null
}

export function FileUploadZone({ projectId, onUploaded }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.postForm<DocumentResponse>(`/api/projects/${projectId}/documents`, formData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId] })
      onUploaded()
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    },
  })

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    mutation.mutate(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a document"
        className={cn(
          'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50 hover:bg-accent/50',
          mutation.isPending && 'pointer-events-none opacity-60',
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragOver(false)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <svg
          className="h-6 w-6 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Click to upload</span> or drag &amp; drop
        </p>
        <p className="text-[11px] text-muted-foreground">
          {ALLOWED_EXTENSIONS.join(', ')} &middot; up to {MAX_FILE_SIZE_BYTES / 1_048_576} MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_EXTENSIONS.join(',')}
        disabled={mutation.isPending}
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {mutation.isPending && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-1/3 rounded-full bg-primary [animation:indeterminate-progress_1.5s_ease-in-out_infinite]" />
        </div>
      )}

      {error && !mutation.isPending && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
