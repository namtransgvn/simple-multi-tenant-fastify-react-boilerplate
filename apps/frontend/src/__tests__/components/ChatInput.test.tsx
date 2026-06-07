import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatInput } from '@/components/chat/ChatInput'

const defaultProps = {
  onSend: vi.fn(),
  onRetry: vi.fn(),
  isStreaming: false,
  canSend: true,
  error: null,
}

describe('ChatInput', () => {
  it('Enter key calls onSend with trimmed content', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    render(<ChatInput {...defaultProps} onSend={onSend} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hello World')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith('Hello World')
  })

  it('Shift+Enter does not submit', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    render(<ChatInput {...defaultProps} onSend={onSend} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hello World')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('textarea is disabled while isStreaming', () => {
    render(<ChatInput {...defaultProps} isStreaming={true} />)

    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('shows error alert and retry button when error is set', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(<ChatInput {...defaultProps} error="Connection failed" onRetry={onRetry} />)

    expect(screen.getByText('Connection failed')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: /retry/i })
    expect(retryButton).toBeInTheDocument()

    await user.click(retryButton)
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
