import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'

function CallbackPage() {
  const navigate = useNavigate()
  const setToken = useAuthStore((s) => s.setToken)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      setToken(token)
      void navigate({ to: '/projects' })
    } else {
      void navigate({ to: '/login' })
    }
  }, [navigate, setToken])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/auth/callback')({
  component: CallbackPage,
})
