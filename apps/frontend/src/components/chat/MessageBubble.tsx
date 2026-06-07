import ReactMarkdown from 'react-markdown'
import SyntaxHighlighter from 'react-syntax-highlighter'
import { github } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import { StreamingCursor } from './StreamingCursor'
import type { ChatMessage } from '@/stores/chatStore'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm">
        <div className="prose prose-sm max-w-none break-words">
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? '')
                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={github}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ borderRadius: '0.375rem', fontSize: '0.8125rem' }}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  )
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              },
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                )
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.isStreaming && <StreamingCursor />}
      </div>
    </div>
  )
}
