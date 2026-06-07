import { createFileRoute } from '@tanstack/react-router'
import { AiProvidersPage } from '@/pages/admin/AiProvidersPage'

export const Route = createFileRoute('/admin/ai-providers')({
  component: AiProvidersPage,
})
