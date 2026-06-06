import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── SDK mock ────────────────────────────────────────────────────────────────

const mockStream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: mockStream },
  })),
}))

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from './anthropic.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function* asyncEvents(events: object[]): AsyncIterable<object> {
  for (const e of events) yield e
}

function textDelta(text: string) {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } }
}

function otherEvent() {
  return { type: 'message_start' }
}

async function collect(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('AnthropicProvider', () => {
  const provider = new AnthropicProvider()
  const key = 'sk-ant-test'
  const messages = [{ role: 'user' as const, content: 'Hello' }]
  const system = 'You are a test assistant.'

  beforeEach(() => {
    vi.mocked(Anthropic).mockClear()
    mockStream.mockClear()
  })

  it('has providerType "anthropic"', () => {
    expect(provider.providerType).toBe('anthropic')
  })

  it('declares supported models', () => {
    expect(provider.supportedModels).toEqual([
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ])
  })

  it('yields text from content_block_delta events', async () => {
    mockStream.mockReturnValue(
      asyncEvents([textDelta('Hello'), textDelta(', '), textDelta('world!')])
    )

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'claude-sonnet-4-5')
    )

    expect(chunks).toEqual(['Hello', ', ', 'world!'])
  })

  it('skips non-text-delta events', async () => {
    mockStream.mockReturnValue(
      asyncEvents([otherEvent(), textDelta('hi'), otherEvent()])
    )

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'claude-haiku-4-5')
    )

    expect(chunks).toEqual(['hi'])
  })

  it('constructs a new Anthropic client with the provided apiKey', async () => {
    mockStream.mockReturnValue(asyncEvents([]))

    await collect(provider.streamChat('my-key', messages, system, 'claude-sonnet-4-5'))

    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'my-key' })
  })

  it('passes model, system, messages, and default max_tokens to stream()', async () => {
    mockStream.mockReturnValue(asyncEvents([]))

    await collect(
      provider.streamChat(key, messages, system, 'claude-opus-4-5')
    )

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-5',
        system,
        messages,
        max_tokens: 8192,
      })
    )
  })

  it('uses options.maxTokens when provided', async () => {
    mockStream.mockReturnValue(asyncEvents([]))

    await collect(
      provider.streamChat(key, messages, system, 'claude-sonnet-4-5', { maxTokens: 1024 })
    )

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 1024 })
    )
  })

  it('passes temperature when provided in options', async () => {
    mockStream.mockReturnValue(asyncEvents([]))

    await collect(
      provider.streamChat(key, messages, system, 'claude-sonnet-4-5', { temperature: 0.5 })
    )

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.5 })
    )
  })

  it('does not include temperature key when not provided', async () => {
    mockStream.mockReturnValue(asyncEvents([]))

    await collect(provider.streamChat(key, messages, system, 'claude-sonnet-4-5'))

    const call = mockStream.mock.calls[0][0]
    expect(call).not.toHaveProperty('temperature')
  })

  it('handles AbortError gracefully without rethrowing', async () => {
    async function* abortingStream(): AsyncIterable<object> {
      yield textDelta('partial')
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    mockStream.mockReturnValue(abortingStream())

    const chunks = await collect(
      provider.streamChat(key, messages, system, 'claude-sonnet-4-5')
    )

    expect(chunks).toEqual(['partial'])
  })

  it('propagates non-abort errors', async () => {
    async function* failingStream(): AsyncIterable<object> {
      throw new Error('network failure')
      yield textDelta('never')
    }
    mockStream.mockReturnValue(failingStream())

    await expect(
      collect(provider.streamChat(key, messages, system, 'claude-sonnet-4-5'))
    ).rejects.toThrow('network failure')
  })
})
