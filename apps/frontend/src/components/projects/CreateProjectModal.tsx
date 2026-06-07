import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/lib/api'
import type { ProjectResponse } from '@repo/shared'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
})

interface CreateProjectModalProps {
  open: boolean
  onClose: () => void
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ProjectResponse>('/api/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      handleClose()
    },
  })

  function handleClose() {
    setName('')
    setDescription('')
    setFieldErrors({})
    mutation.reset()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = schema.safeParse({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    if (!result.success) {
      const errs: Record<string, string> = {}
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? 'name')
        errs[key] = issue.message
      }
      setFieldErrors(errs)
      return
    }
    setFieldErrors({})
    mutation.mutate()
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>

        <DialogContent>
          <div className="space-y-4">
            {mutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {mutation.error instanceof Error
                    ? mutation.error.message
                    : 'Failed to create project. Please try again.'}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="project-name">
                  Name <span className="text-destructive" aria-hidden>*</span>
                </label>
                <span className="text-xs text-muted-foreground">{name.length}/100</span>
              </div>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My project"
                maxLength={100}
                disabled={mutation.isPending}
                autoFocus
              />
              {fieldErrors.name && (
                <p className="text-xs text-destructive">{fieldErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="project-description">
                  Description
                </label>
                <span className="text-xs text-muted-foreground">
                  {description.length}/500
                </span>
              </div>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                maxLength={500}
                rows={3}
                disabled={mutation.isPending}
              />
              {fieldErrors.description && (
                <p className="text-xs text-destructive">{fieldErrors.description}</p>
              )}
            </div>
          </div>
        </DialogContent>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Creating…
              </>
            ) : (
              'Create project'
            )}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
