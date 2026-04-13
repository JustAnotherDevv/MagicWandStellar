import type { SSEEvent } from '../types'

export async function* streamChat(
  body: Parameters<typeof import('./api').api.chat>[0],
  signal: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Chat API error ${res.status}: ${text}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Split on double newlines (SSE event delimiter)
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        const json = line.slice(5).trim()
        if (!json || json === '[DONE]') continue
        try {
          yield JSON.parse(json) as SSEEvent
        } catch {
          // skip malformed
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const line = buffer.trim()
      if (line.startsWith('data:')) {
        const json = line.slice(5).trim()
        if (json && json !== '[DONE]') {
          try { yield JSON.parse(json) as SSEEvent } catch { /* skip */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
