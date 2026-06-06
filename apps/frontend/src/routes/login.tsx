import { createFileRoute, redirect } from '@tanstack/react-router'
import { LoginPage } from '@/components/auth/LoginPage'
import { useAuthStore } from '@/stores/authStore'

export const Route = createFileRoute('/login')({
  beforeLoad: () => {
    const isAuthenticated = useAuthStore.getState().isAuthenticated
    if (isAuthenticated) throw redirect({ to: '/projects' })
  },
  component: LoginPage,
})
