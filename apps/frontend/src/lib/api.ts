import type { ChatRequest, ChatStreamChunk } from '@repo/shared'
import { ChatStreamChunkSchema } from '@repo/shared'
import { useAuthStore } from '@/stores/authStore'

const BASE_URL = import.meta.env.VITE_API_BASE_URL

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (response.status === 401) {
    if (!isRetry) {
      const refreshed = await useAuthStore.getState().silentRefresh()
      if (refreshed) return request<T>(method, path, body, true)
    }
    useAuthStore.getState().logout()
    return Promise.reject(new Error('Unauthorized'))
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: response.statusText }))
    throw Object.assign(
      new Error((err as { message?: string }).message ?? 'Request failed'),
      { statusCode: response.status },
    )
  }

  return response.json() as Promise<T>
}

async function requestForm<T>(path: string, body: FormData, isRetry = false): Promise<T> {
  // Omit Content-Type — browser sets multipart/form-data with correct boundary
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body,
  })

  if (response.status === 401) {
    if (!isRetry) {
      const refreshed = await useAuthStore.getState().silentRefresh()
      if (refreshed) return requestForm<T>(path, body, true)
    }
    useAuthStore.getState().logout()
    return Promise.reject(new Error('Unauthorized'))
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: response.statusText }))
    throw Object.assign(
      new Error((err as { message?: string }).message ?? 'Request failed'),
      { statusCode: response.status },
    )
  }

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: <T>(path: string, body: FormData) => requestForm<T>(path, body),
}

export async function* streamChat(chatBody: ChatRequest): AsyncGenerator<ChatStreamChunk> {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(chatBody),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return

        try {
          const chunk = ChatStreamChunkSchema.parse(JSON.parse(data))
          yield chunk
          if (chunk.error) return
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
