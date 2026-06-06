import { createFileRoute } from '@tanstack/react-router'
import { GroupsPage } from '@/pages/admin/GroupsPage'

export const Route = createFileRoute('/admin/groups')({
  component: GroupsPage,
})
