import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectCard } from '@/components/projects/ProjectCard'
import type { ProjectResponse } from '@repo/shared'

const MOCK_PROJECT: ProjectResponse = {
  id: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  ownerId: '00000000-0000-0000-0000-000000000003',
  name: 'My Project',
  description: 'A test project description',
  documentCount: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-06-01T00:00:00.000Z',
}

describe('ProjectCard', () => {
  it('renders project name and description', () => {
    render(<ProjectCard project={MOCK_PROJECT} onClick={vi.fn()} />)

    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByText('A test project description')).toBeInTheDocument()
  })

  it('renders document count badge', () => {
    render(<ProjectCard project={MOCK_PROJECT} onClick={vi.fn()} />)

    expect(screen.getByText('3 documents')).toBeInTheDocument()
  })

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(<ProjectCard project={MOCK_PROJECT} onClick={handleClick} />)

    await user.click(screen.getByText('My Project'))
    expect(handleClick).toHaveBeenCalledOnce()
  })
})
