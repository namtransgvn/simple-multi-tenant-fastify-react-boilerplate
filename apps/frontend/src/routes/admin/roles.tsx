import { createFileRoute } from '@tanstack/react-router'
import { RolesPage } from '@/pages/admin/RolesPage'

export const Route = createFileRoute('/admin/roles')({
  component: RolesPage,
})
