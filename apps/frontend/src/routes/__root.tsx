import { Suspense, lazy } from 'react'
import { createRootRoute, Outlet, redirect } from '@tanstack/react-router'
import { RootLayout } from '@/components/layout/RootLayout'
import { useAuthStore } from '@/stores/authStore'

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import('@tanstack/react-router-devtools').then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )

const ReactQueryDevtools = import.meta.env.PROD
  ? () => null
  : lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )

function RootComponent() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <>
      {isAuthenticated ? <RootLayout /> : <Outlet />}
      <Suspense>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools initialIsOpen={false} />
      </Suspense>
    </>
  )
}

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    const isAuthenticated = useAuthStore.getState().isAuthenticated
    const publicPaths = ['/login', '/auth/callback']
    if (!isAuthenticated && !publicPaths.includes(location.pathname)) {
      throw redirect({ to: '/login' })
    }
  },
  component: RootComponent,
})
