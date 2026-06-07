import { useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ChatInputProps {
  onSend: (content: string) => void
  onRetry: () => void
  isStreaming: boolean
  canSend: boolean
  error: string | null
}

export function ChatInput({ onSend, onRetry, isStreaming, canSend, error }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  let placeholder = 'Ask anything… (Shift+Enter for newline)'
  if (!canSend) placeholder = 'No AI provider configured…'
  else if (isStreaming) placeholder = 'Waiting for response…'

  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // cap at 6 lines (~1.5rem line-height per line + padding)
    el.style.height = `${Math.min(el.scrollHeight, 6 * 28)}px`
  }

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="shrink-0 border-t border-border p-4 space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            <span className="flex-1 text-sm">{error}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={placeholder}
          disabled={isStreaming || !canSend}
          className="min-h-0 resize-none overflow-hidden"
          onChange={(e) => {
            setValue(e.target.value)
            resize()
          }}
          onKeyDown={handleKeyDown}
        />
        <Button
          onClick={submit}
          disabled={isStreaming || !canSend || !value.trim()}
          className="shrink-0"
        >
          Send
        </Button>
      </div>
    </div>
  )
}
