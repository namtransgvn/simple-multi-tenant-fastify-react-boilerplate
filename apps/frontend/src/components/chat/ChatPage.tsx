import { useParams } from '@tanstack/react-router'
import { DocumentPanel } from '@/components/projects/DocumentPanel'
import { useStreamingChat } from '@/hooks/useStreamingChat'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'

export function ChatPage() {
  const { projectId } = useParams({ from: '/projects/$projectId/chat' })
  const { sendMessage, isStreaming, canSend, error, retry } = useStreamingChat()

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main chat column */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader />
        <MessageList />
        <ChatInput onSend={sendMessage} onRetry={retry} isStreaming={isStreaming} canSend={canSend} error={error} />
      </div>

      {/* Document sidebar */}
      <div className="w-72 shrink-0 overflow-y-auto">
        <DocumentPanel projectId={projectId} />
      </div>
    </div>
  )
}
