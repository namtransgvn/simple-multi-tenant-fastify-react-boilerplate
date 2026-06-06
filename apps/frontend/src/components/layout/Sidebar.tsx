import { Link } from '@tanstack/react-router'
import { usePermission } from '@/hooks/usePermission'
import { Permission } from '@repo/shared'

export function Sidebar() {
  const canManageAdmin = usePermission(Permission.ADMIN_MANAGE)

  return (
    <aside className="w-64 border-r border-border flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <h1 className="font-semibold text-sm">AI Chatbot Platform</h1>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        <Link
          to="/projects"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
        >
          Projects
        </Link>
        {canManageAdmin && (
          <Link
            to="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
          >
            Admin
          </Link>
        )}
      </nav>
    </aside>
  )
}
