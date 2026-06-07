import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Roles', to: '/admin/roles' as const },
  { label: 'Groups', to: '/admin/groups' as const },
  { label: 'Users', to: '/admin/users' as const },
  { label: 'AI Providers', to: '/admin/ai-providers' as const },
]

interface AdminLayoutProps {
  children: React.ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold">Admin</h1>
        <nav className="flex gap-1 mt-3">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                '[&.active]:bg-accent [&.active]:text-accent-foreground',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  )
}
