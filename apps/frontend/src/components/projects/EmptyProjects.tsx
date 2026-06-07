import { Button } from '@/components/ui/button'

interface EmptyProjectsProps {
  onCreateClick: () => void
}

export function EmptyProjects({ onCreateClick }: EmptyProjectsProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg
        className="mb-4 h-16 w-16 text-muted-foreground/40"
        fill="none"
        viewBox="0 0 64 64"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 20a4 4 0 0 1 4-4h12l5 5h23a4 4 0 0 1 4 4v19a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V20Z"
        />
      </svg>
      <h3 className="mb-2 text-lg font-semibold">No projects yet</h3>
      <p className="mb-6 max-w-xs text-sm text-muted-foreground">
        Projects let you organise documents and chat with your data in one place.
      </p>
      <Button onClick={onCreateClick}>Create your first project</Button>
    </div>
  )
}
