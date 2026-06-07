import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from '@/components/chat/MessageBubble'
import type { ChatMessage } from '@/stores/chatStore'

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}))

vi.mock('react-syntax-highlighter', () => ({
  default: ({ children }: { children: string }) => (
    <pre data-testid="syntax-highlighter">{children}</pre>
  ),
}))

vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({
  github: {},
}))

vi.mock('@/components/chat/StreamingCursor', () => ({
  StreamingCursor: () => <span data-testid="streaming-cursor" />,
}))

describe('MessageBubble', () => {
  it('renders markdown content for assistant messages', () => {
    const message: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '**Bold text** and more',
      isStreaming: false,
    }

    render(<MessageBubble message={message} />)

    const markdown = screen.getByTestId('markdown-content')
    expect(markdown).toBeInTheDocument()
    expect(markdown).toHaveTextContent('**Bold text** and more')
  })

  it('user messages are right-aligned', () => {
    const message: ChatMessage = {
      id: 'msg-2',
      role: 'user',
      content: 'Hello there',
    }

    const { container } = render(<MessageBubble message={message} />)

    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv).toHaveClass('justify-end')
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('streaming messages show cursor', () => {
    const message: ChatMessage = {
      id: 'msg-3',
      role: 'assistant',
      content: 'Typing…',
      isStreaming: true,
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByTestId('streaming-cursor')).toBeInTheDocument()
  })

  it('non-streaming messages do not show cursor', () => {
    const message: ChatMessage = {
      id: 'msg-4',
      role: 'assistant',
      content: 'Done',
      isStreaming: false,
    }

    render(<MessageBubble message={message} />)

    expect(screen.queryByTestId('streaming-cursor')).not.toBeInTheDocument()
  })
})
