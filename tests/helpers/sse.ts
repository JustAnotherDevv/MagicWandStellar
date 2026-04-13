/** Parse all SSE events from a streaming POST /chat response */
export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

export async function collectSSE(
  url: string,
  body: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<SSEEvent[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 90_000,
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    if (!response.body) throw new Error('No response body');

    const events: SSEEvent[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                // ignore malformed
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      // On timeout abort, return whatever events arrived before cut-off
      const name = err instanceof Error ? err.name : '';
      if (name !== 'AbortError') throw err;
    }

    return events;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Extract concatenated text from all text_delta events */
export function extractText(events: SSEEvent[]): string {
  return events
    .filter((e) => e.type === 'text_delta')
    .map((e) => e.text as string)
    .join('');
}

/** Extract tool_use event names */
export function extractToolNames(events: SSEEvent[]): string[] {
  return events
    .filter((e) => e.type === 'tool_use')
    .map((e) => e.toolName as string);
}

/** Find the session_created event */
export function findSessionId(events: SSEEvent[]): string | undefined {
  return events.find((e) => e.type === 'session_created')?.sessionId as string | undefined;
}

/** Check whether the stream ended cleanly (done event present) */
export function streamDone(events: SSEEvent[]): boolean {
  return events.some((e) => e.type === 'done');
}

/** Check whether the stream ended with an error */
export function streamError(events: SSEEvent[]): string | undefined {
  return events.find((e) => e.type === 'error')?.message as string | undefined;
}
