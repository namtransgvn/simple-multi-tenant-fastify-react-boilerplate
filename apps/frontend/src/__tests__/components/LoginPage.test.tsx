import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { LoginPage } from '@/components/auth/LoginPage'

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('LoginPage', () => {
  it('renders provider buttons from mock API', async () => {
    renderWithQuery(<LoginPage />)

    await waitFor(() => {
      expect(screen.getByText('Continue with Google')).toBeInTheDocument()
      expect(screen.getByText('Continue with Keycloak')).toBeInTheDocument()
    })
  })

  it('shows skeleton while loading', () => {
    server.use(
      http.get('http://localhost/auth/tenants', () => new Promise(() => {})),
    )

    renderWithQuery(<LoginPage />)

    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument()
  })

  it('shows error alert on API failure', async () => {
    server.use(
      http.get('http://localhost/auth/tenants', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    renderWithQuery(<LoginPage />)

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load sign-in options/i),
      ).toBeInTheDocument()
    })
  })
})
