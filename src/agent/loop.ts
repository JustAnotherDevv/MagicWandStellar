import OpenAI from 'openai';
import * as httpsModule from 'node:https';
import * as httpModule from 'node:http';
import { Readable } from 'node:stream';
import type { Session, SSEEvent, UsageSummary } from '../types/index.js';
import type { RAGStore } from '../rag/index.js';
import type { DatabaseStore } from '../db/index.js';
import { TOOLS, type OAITool } from '../tools/definitions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { executeToolSafe } from './executor.js';
import { MINIMAX_API_KEY, MINIMAX_BASE_URL, MODEL } from '../config/index.js';

// Do NOT create a module-level OpenAI singleton.
// MiniMax closes the underlying TCP connection after a long streaming response, but Node.js's
// undici connection pool doesn't detect it immediately. The next request (step 2 after step 1)
// reuses the stale connection and gets 0 bytes back. Creating a new client per agent-loop call
// ensures each session uses a fresh HTTP connection without reuse issues.

const MAX_TURNS = 20;

import { appendFileSync } from 'node:fs';
const DEBUG_LOG_FILE = '/tmp/stellar-agents-loop.log';

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data) : '';
  const line = `[${ts}][${level}][loop] ${msg}${extra}\n`;
  console.log(line.trim());
  try { appendFileSync(DEBUG_LOG_FILE, line); } catch { /* never break on log failure */ }
}
const MAX_RETRIES = 2;              // up to 2 retries per LLM turn
const RATE_LIMIT_WAIT_MS = 63_000;  // 63s for actual 429s (per-minute quota window)
const PROVIDER_ERROR_WAIT_MS = 8_000; // 8s for 5xx/provider errors (transient)
const EMPTY_RESPONSE_WAIT_MS = 2_000; // 2s for empty 200s — paid model, just retry fast

/** Classify the error to determine retry wait time. Returns 0 if not retryable. */
function retryWaitMs(err: unknown): number {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // 400 = bad request — permanent client error, never retry
    if (msg.includes('400')) return 0;
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit')) {
      return RATE_LIMIT_WAIT_MS;
    }
    // MiniMax commonly throws 500 "unknown error, 999" — transient, retry with backoff
    if (msg.includes('500') || msg.includes('server_error') ||
        msg.includes('provider returned error') || msg.includes('502') || msg.includes('503')) {
      return PROVIDER_ERROR_WAIT_MS;
    }
  }
  return 0;
}

/** Return true if the error is transient and worth retrying */
function isRateLimit(err: unknown): boolean {
  return retryWaitMs(err) > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Some models (e.g. Gemini) output tool calls as Python-style prose instead of
 * using the function-calling API. Detect `update_project_spec(spec="...")` in
 * the assistant's text content and return the spec string if found.
 * Exported so chat.ts can backfill specs from existing message history.
 */
export function extractPythonSpec(content: string): string | null {
  const marker = 'update_project_spec(spec=';
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  const after = content.slice(idx + marker.length);
  const quote = after[0];
  if (quote !== '"' && quote !== "'") return null;
  let spec = '';
  let i = 1;
  while (i < after.length) {
    const ch = after[i];
    if (ch === '\\' && i + 1 < after.length) {
      const next = after[i + 1];
      if (next === 'n') spec += '\n';
      else if (next === 't') spec += '\t';
      else if (next === '\\') spec += '\\';
      else if (next === quote) spec += quote;
      else spec += next;
      i += 2;
    } else if (ch === quote) {
      break;
    } else {
      spec += ch;
      i++;
    }
  }
  return spec.trim() || null;
}

/**
 * Extract the structured spec document from a full model response.
 * Skips IDEATE/DIAGRAM narrative preamble — takes content from the first # heading.
 * If no heading is found, returns the full response as-is.
 */
function extractSpecDoc(response: string): string {
  const idx = response.search(/^#\s/m);
  return idx > 0 ? response.slice(idx) : response;
}

/**
 * Scan balanced braces to extract a complete JSON object starting at `start`.
 * Handles nested objects and string escapes correctly.
 */
function extractBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Sanitize a JSON string that may contain raw control characters (newlines, tabs)
 * inside string literals — models sometimes output these instead of `\n` / `\t`.
 */
function sanitizeJsonControlChars(str: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.charCodeAt(0);
    if (escape) { escape = false; result += ch; continue; }
    if (inString) {
      if (ch === '\\') { escape = true; result += ch; continue; }
      if (ch === '"') { inString = false; result += ch; continue; }
      if (code < 0x20) {
        // Replace raw control chars with JSON escape sequences
        if (ch === '\n') result += '\\n';
        else if (ch === '\r') result += '\\r';
        else if (ch === '\t') result += '\\t';
        else result += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
      result += ch;
    } else {
      if (ch === '"') { inString = true; result += ch; continue; }
      result += ch;
    }
  }
  return result;
}

/**
 * Detect JSON-style `functions.write_file({...})` or `write_file({...})` calls
 * in model text output and return all `{ path, content }` pairs found.
 * Used when a model emits tool calls as text rather than via the function-calling API.
 * Handles raw newlines inside JSON string values (common model output quirk).
 */
function extractJsonWriteFileCalls(content: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const patterns = ['functions.write_file({', 'write_file({'];
  const seenPaths = new Set<string>();

  for (const pattern of patterns) {
    let searchFrom = 0;
    while (true) {
      const idx = content.indexOf(pattern, searchFrom);
      if (idx === -1) break;
      const jsonStart = idx + pattern.length - 1; // points to the opening `{`
      const rawJson = extractBalancedObject(content, jsonStart);
      if (!rawJson) { searchFrom = idx + 1; continue; }
      try {
        const jsonStr = sanitizeJsonControlChars(rawJson);
        const parsed = JSON.parse(jsonStr) as { path?: string; content?: string };
        if (parsed.path && parsed.content && !seenPaths.has(parsed.path)) {
          seenPaths.add(parsed.path);
          results.push({ path: parsed.path, content: parsed.content });
        }
      } catch { /* malformed JSON — skip */ }
      searchFrom = jsonStart + rawJson.length;
    }
  }
  return results;
}

/**
 * Detect JSON-style pseudo tool calls in assistant text, e.g.
 * `functions.contract_build({...})` or `contract_build({...})`.
 * Only parses tools listed in `toolNames`.
 */
function extractJsonToolCalls(
  content: string,
  toolNames: string[],
): Array<{ toolName: string; input: Record<string, unknown> }> {
  const results: Array<{ toolName: string; input: Record<string, unknown> }> = [];
  const prefixes = ['functions.', ''];
  const seen = new Set<string>();

  for (const toolName of toolNames) {
    for (const prefix of prefixes) {
      const pattern = `${prefix}${toolName}({`;
      let searchFrom = 0;
      while (true) {
        const idx = content.indexOf(pattern, searchFrom);
        if (idx === -1) break;
        const jsonStart = idx + pattern.length - 1; // opening "{"
        const rawJson = extractBalancedObject(content, jsonStart);
        if (!rawJson) { searchFrom = idx + 1; continue; }
        try {
          const jsonStr = sanitizeJsonControlChars(rawJson);
          const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
          const key = `${toolName}:${jsonStr}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ toolName, input: parsed });
          }
        } catch { /* malformed JSON — skip */ }
        searchFrom = jsonStart + rawJson.length;
      }
    }
  }

  return results;
}

function toolResultSucceeded(toolName: string, resultContent: string): boolean {
  if (/unknown tool|tool execution error|error:/i.test(resultContent)) return false;

  const exitMatch = resultContent.match(/Exit code:\s*(-?\d+)/i);
  if (exitMatch) return parseInt(exitMatch[1] ?? '1', 10) === 0;

  // CLI-backed tools should always include an exit code in formatted output.
  if (toolName === 'contract_init' || toolName === 'contract_build' || toolName === 'run_cargo_test') {
    return false;
  }

  return true;
}

/**
 * Build a set of tools that have at least one successful result in history.
 * Uses assistant.tool_calls IDs + subsequent tool messages.
 */
function getSuccessfulToolNames(messages: OAIMessage[]): Set<string> {
  const toolNameById = new Map<string, string>();
  const successful = new Set<string>();

  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).tool_calls) {
      const calls = (m as any).tool_calls as Array<{ id?: string; function?: { name?: string } }>;
      for (const tc of calls) {
        if (tc.id && tc.function?.name) {
          toolNameById.set(tc.id, tc.function.name);
        }
      }
      continue;
    }

    if (m.role === 'tool') {
      const toolCallId = (m as any).tool_call_id as string | undefined;
      if (!toolCallId) continue;
      const toolName = toolNameById.get(toolCallId);
      if (!toolName) continue;
      const content = typeof m.content === 'string' ? m.content : '';
      if (toolResultSucceeded(toolName, content)) {
        successful.add(toolName);
      }
    }
  }

  return successful;
}

function getLastToolOutcome(messages: OAIMessage[]): { toolName: string; success: boolean; content: string } | null {
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).tool_calls) {
      const calls = (m as any).tool_calls as Array<{ id?: string; function?: { name?: string } }>;
      for (const tc of calls) {
        if (tc.id && tc.function?.name) toolNameById.set(tc.id, tc.function.name);
      }
      continue;
    }
    if (m.role === 'tool') {
      const toolCallId = (m as any).tool_call_id as string | undefined;
      if (!toolCallId) continue;
      const toolName = toolNameById.get(toolCallId);
      if (!toolName) continue;
      const content = typeof m.content === 'string' ? m.content : '';
      return { toolName, success: toolResultSucceeded(toolName, content), content };
    }
  }
  return null;
}

function getConsecutiveFailedToolCount(messages: OAIMessage[], toolName: string): number {
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).tool_calls) {
      const calls = (m as any).tool_calls as Array<{ id?: string; function?: { name?: string } }>;
      for (const tc of calls) {
        if (tc.id && tc.function?.name) toolNameById.set(tc.id, tc.function.name);
      }
    }
  }

  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    const toolCallId = (m as any).tool_call_id as string | undefined;
    if (!toolCallId) continue;
    const name = toolNameById.get(toolCallId);
    if (name !== toolName) break;
    const content = typeof m.content === 'string' ? m.content : '';
    if (!toolResultSucceeded(toolName, content)) count++;
    else break;
  }
  return count;
}

function shouldBlockRetryUntilWrite(
  messages: OAIMessage[],
  retryTool: 'contract_build' | 'run_cargo_test',
): boolean {
  const toolNameById = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).tool_calls) {
      const calls = (m as any).tool_calls as Array<{ id?: string; function?: { name?: string } }>;
      for (const tc of calls) {
        if (tc.id && tc.function?.name) toolNameById.set(tc.id, tc.function.name);
      }
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    const toolCallId = (m as any).tool_call_id as string | undefined;
    if (!toolCallId) continue;
    const name = toolNameById.get(toolCallId);
    if (!name) continue;
    const content = typeof m.content === 'string' ? m.content : '';

    if (name === 'write_file' && toolResultSucceeded(name, content)) {
      return false;
    }

    if (name === retryTool) {
      return !toolResultSucceeded(name, content);
    }
  }

  return false;
}

export const __loopGuardsForTests = {
  toolResultSucceeded,
  shouldBlockRetryUntilWrite,
};

/** Persist any new messages since last watermark */
function persistTurn(session: Session, db: DatabaseStore): void {
  const from = session._persistedMsgCount ?? 0;
  if (session.messages.length > from) {
    db.persistMessages(session.id, session.projectId, session.messages, from);
    session._persistedMsgCount = session.messages.length;
    db.updateSessionActivity(session.id, session.lastActivityAt);
  }
}

/**
 * Trim conversation history to avoid context-window overload.
 * Keeps the first 2 messages (original request + first response) for context,
 * then the most recent messages up to `maxMessages` total.
 * Ensures we never start mid-tool-exchange by scanning for the first user message
 * in the tail window.
 */
const MAX_TOOL_RESULT_CHARS = 4_000;     // truncate huge build outputs / file reads
const MAX_ASSISTANT_CONTENT_CHARS = 1_200;

function trimHistory(messages: OAIMessage[], maxMessages = 32): OAIMessage[] {
  // Truncate oversized messages — a single design response or build output can be 10k+ tokens
  const capped = messages.map((m) => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_RESULT_CHARS) {
      return { ...m, content: m.content.slice(0, MAX_TOOL_RESULT_CHARS) + '\n[...truncated]' };
    }
    // Replace long assistant TEXT messages (no tool_calls) with a concise placeholder.
    // MiniMax returns 0 chunks when a prior assistant message contains a truncated mermaid block
    // (the model tries to "continue" the malformed markdown instead of processing the new request).
    // Replacing with a short summary avoids this — the spec is already in the system prompt.
    if (
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.length > MAX_ASSISTANT_CONTENT_CHARS &&
      !(m as any).tool_calls
    ) {
      const isDesign = (m.content as string).includes('mermaid') || (m.content as string).includes('IDEATE');
      const placeholder = isDesign
        ? '[Architecture design complete — mermaid diagram and full spec saved to project. Awaiting user approval to proceed to implementation.]'
        : `[Previous response summarized — ${(m.content as string).length} chars — proceeding.]`;
      return { ...m, content: placeholder };
    }
    // Sanitize mermaid blocks out of tool_call arguments — MiniMax returns empty
    // response when its context contains ```mermaid syntax anywhere, including in
    // tool_calls[].function.arguments JSON strings stored in session history.
    if (m.role === 'assistant' && (m as any).tool_calls) {
      const calls = (m as any).tool_calls as Array<{ function?: { name?: string; arguments?: string } }>;
      const hasMermaid = calls.some(
        (tc) =>
          tc.function?.arguments?.includes('```mermaid') ||
          tc.function?.arguments?.includes('graph TD') ||
          tc.function?.arguments?.includes('sequenceDiagram'),
      );
      if (hasMermaid) {
        const sanitized = calls.map((tc) => {
          if (!tc.function?.arguments) return tc;
          const hasMermaidInArg =
            tc.function.arguments.includes('```mermaid') ||
            tc.function.arguments.includes('graph TD') ||
            tc.function.arguments.includes('sequenceDiagram');
          if (!hasMermaidInArg) return tc;
          try {
            const args = JSON.parse(tc.function.arguments);
            if (typeof args.spec === 'string') {
              args.spec = args.spec.replace(/```mermaid[\s\S]*?```/g, '[diagram omitted]');
            }
            return { ...tc, function: { ...tc.function, arguments: JSON.stringify(args) } };
          } catch {
            return tc;
          }
        });
        return { ...m, tool_calls: sanitized } as OAIMessage;
      }
    }
    return m;
  });

  if (capped.length <= maxMessages) return capped;

  // Take only a contiguous tail — never splice head+tail, which creates orphaned
  // tool_call_id references that Claude rejects with a 400 bad-request error.
  const tail = capped.slice(-maxMessages);
  // Don't start mid-tool-exchange — skip forward to the first user message
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}

// ── Direct MiniMax streaming (bypasses OpenAI SDK entirely) ──────────────────
// The OpenAI SDK + fetchWithFreshConnection path returns 0 SSE chunks for step 2.
// Direct HTTPS (proven working in test scripts) is used for all API calls.

interface MiniMaxDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface MiniMaxStreamChunk {
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    delta?: MiniMaxDelta;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Make a streaming chat request to MiniMax, yielding parsed SSE chunks as they arrive.
 *  Uses a direct HTTPS request (bypasses the OpenAI SDK which returns 0 chunks for step 2).
 *  Uses an event queue so SSE events are yielded as they arrive without buffering. */
async function* callMiniMaxStream(
  messages: OAIMessage[],
  tools: OAITool[],
  signal: AbortSignal,
  toolChoice: 'auto' | 'required' = 'auto',
): AsyncGenerator<MiniMaxStreamChunk> {
  const urlParsed = new URL(MINIMAX_BASE_URL + '/chat/completions');
  const isHttps = urlParsed.protocol === 'https:';

  const payload = {
    model: MODEL,
    max_tokens: 16000,
    messages,
    ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
    stream: true,
  };
  const body = JSON.stringify(payload);

  log('INFO', 'callMiniMaxStream: sending request', {
    bodyLen: body.length,
    msgCount: messages.length,
    toolCount: tools.length,
    lastMsgRole: messages[messages.length - 1]?.role,
    signalAborted: signal.aborted,
  });

  if (signal.aborted) {
    log('WARN', 'callMiniMaxStream: signal already aborted at entry — skipping');
    return;
  }

  // Event queue: parsed SSE chunks are pushed here by the HTTP callbacks.
  // The async generator reads from this queue incrementally.
  const queue: Array<MiniMaxStreamChunk | Error | null> = []; // null = done
  let waitResolve: (() => void) | null = null;
  const push = (item: MiniMaxStreamChunk | Error | null) => {
    queue.push(item);
    if (waitResolve) { waitResolve(); waitResolve = null; }
  };

  // agent: false → no connection pooling; Node.js creates a fresh socket per request.
  // This bypasses both keepAlive reuse AND any global/per-agent TLS session issues.
  const httpLib = isHttps ? httpsModule : httpModule;
  const req = httpLib.request({
    hostname: urlParsed.hostname,
    port: urlParsed.port || (isHttps ? 443 : 80),
    path: urlParsed.pathname + urlParsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      'Content-Length': Buffer.byteLength(body),
      'Connection': 'close',
    },
    agent: false,  // fresh socket, no agent pooling
  } as httpsModule.RequestOptions, (res) => {
    log('INFO', 'callMiniMaxStream: HTTP response', {
      status: res.statusCode,
      contentType: res.headers['content-type'],
    });

    // Non-200: drain and push error
    if ((res.statusCode ?? 200) >= 400) {
      const bufs: Buffer[] = [];
      res.on('data', (c: Buffer) => bufs.push(c));
      res.on('end', () => {
        const body = Buffer.concat(bufs).toString('utf8');
        push(new Error(`MiniMax HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
      });
      return;
    }

    let buffer = '';
    let totalBytes = 0;
    let rawPreview = '';  // capture first 500 bytes for diagnosis
    res.on('data', (chunk: Buffer) => {
      if (signal.aborted) return;
      totalBytes += chunk.length;
      const str = chunk.toString('utf8');
      if (rawPreview.length < 500) rawPreview += str;
      buffer += str;
      // Parse complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('data:')) continue;
        const data = trimmedLine.slice(5).trim();
        if (data === '[DONE]') {
          log('INFO', 'callMiniMaxStream: [DONE]', { totalBytes });
          push(null); // signal end
          return;
        }
        try {
          push(JSON.parse(data) as MiniMaxStreamChunk);
        } catch { /* skip malformed */ }
      }
    });
    res.on('end', () => {
      log('INFO', 'callMiniMaxStream: response end', {
        totalBytes,
        rawPreview: rawPreview.slice(0, 500),
      });
      push(null); // ensure done
    });
    res.on('error', (err: Error) => push(err));
  });

  req.on('error', (err: Error) => {
    log('ERROR', 'callMiniMaxStream: req error', { message: err.message, code: (err as any).code });
    push(err);
  });
  const onAbort = () => {
    log('WARN', 'callMiniMaxStream: abort signal fired — destroying request');
    req.destroy();
    push(null);
  };
  signal.addEventListener('abort', onAbort);
  req.write(body);
  req.end();

  // Drain the queue, waiting for new items when empty
  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((r) => { waitResolve = r; });
      }
      const item = queue.shift();
      if (item === null || item === undefined) break; // done
      if (item instanceof Error) throw item;
      yield item;
    }
  } finally {
    // Always remove the abort listener — prevents accumulation across retries/turns
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Core agentic loop using OpenRouter (OpenAI-compatible API).
 * Streams SSE events via the emit callback.
 * Handles streaming tool calls, which arrive in chunks across deltas.
 */
export async function* agentLoop(
  session: Session,
  userMessage: string,
  ragStore: RAGStore,
  db: DatabaseStore,
  emit: (event: SSEEvent) => void,
  signal: AbortSignal,
  agentMode: 'contract' | 'ui' = 'contract',
): AsyncGenerator<void> {
  // Append user message to session history
  session.messages.push({ role: 'user', content: userMessage } satisfies OAIMessage);
  session.lastActivityAt = Date.now();

  log('INFO', 'agent loop started', { sessionId: session.id, msgLen: userMessage.length, model: MODEL });

  // Use node:https with keepAlive:false to bypass undici's connection pool.
  // Without this, undici reuses the TCP connection from step 1's long SSE stream,
  // which MiniMax has already closed — causing step 2 to get 0 SSE chunks.
  // Readable.toWeb() converts Node.js IncomingMessage to a proper WHATWG ReadableStream,
  // compatible with Node.js 24's native Symbol.asyncIterator used by the OpenAI SDK.
  const fetchWithFreshConnection = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Promise((resolve, reject) => {
      const urlStr = url instanceof Request ? url.url : String(url);
      const parsed = new URL(urlStr);
      const isHttps = parsed.protocol === 'https:';
      const agent = isHttps
        ? new httpsModule.Agent({ keepAlive: false })
        : new httpModule.Agent({ keepAlive: false });

      const headers: Record<string, string> = { 'Connection': 'close' };
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
      }

      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: init?.method ?? 'GET',
        headers,
        agent,
      };

      const req = (isHttps ? httpsModule : httpModule).request(opts, (res) => {
        const status = res.statusCode ?? 200;
        const responseHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
        // Log headers only — do NOT add res.on('data') listeners here.
        // Adding data listeners before Readable.toWeb() would consume the stream
        // and leave the web stream empty, which is exactly the bug we're debugging.
        log('INFO', 'MiniMax HTTP response', {
          status,
          contentType: res.headers['content-type'],
          transferEncoding: res.headers['transfer-encoding'],
          contentLength: res.headers['content-length'],
        });

        // Convert Node.js Readable (IncomingMessage) to WHATWG ReadableStream.
        const webStream = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(new Response(webStream, { status, headers: responseHeaders }));
      });

      req.on('error', (err) => {
        log('ERROR', 'MiniMax request error', { error: err.message });
        reject(err);
      });
      if (init?.body) {
        const bodyStr = typeof init.body === 'string' ? init.body : String(init.body);
        log('INFO', 'MiniMax request body', {
          bodyType: typeof init.body,
          isObj: typeof init.body !== 'string',
          bodyLen: bodyStr.length,
          snippet: bodyStr.slice(0, 200),
        });
        req.write(init.body);
      } else {
        log('WARN', 'MiniMax request has NO body');
      }
      req.end();
    });
  };

  const openai = new OpenAI({
    apiKey: MINIMAX_API_KEY,
    baseURL: MINIMAX_BASE_URL,
    maxRetries: 0, // disable SDK auto-retry — we handle 429s ourselves with user-visible backoff
    fetch: fetchWithFreshConnection,
  });

  log('INFO', 'session context for this call', {
    sessionId: session.id,
    hasSpec: !!session.projectSpec?.trim(),
    specLen: session.projectSpec?.length ?? 0,
    historyLen: session.messages.length,
  });

  let doneSent = false;

  let narrativeContinuations = 0; // track consecutive text-narration turns in CREATE phase

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) break;
    const effectivePhase: 'design' | 'code' = agentMode === 'ui' ? 'code' : session.phase;

    // Rebuild system prompt each turn so spec changes (from update_project_spec in turn 1)
    // are reflected in turn 2's system prompt without needing a new agentLoop invocation.
    // Only inject the spec into the system prompt when in code phase — design phase never
    // sees the spec section, which keeps the model focused on producing/refining the spec.
    const systemPrompt = buildSystemPrompt(
      ragStore,
      session.workspaceDir,
      effectivePhase === 'code' ? session.projectSpec : undefined,
      effectivePhase,
      agentMode,
    );

    // Snapshot whether we're in CREATE phase at the START of this turn.
    // Uses explicit session.phase — NOT inferred from spec presence.
    // Design phase never auto-saves code blocks even if the model narrates Rust/TOML.
    const inCreatePhaseAtTurnStart = effectivePhase === 'code';

    // Compute CREATE phase tool-call state from current session messages (turn-level).
    // This is used both in the attempt loop (directive injection) and in the natural-stop
    // handler (continuation injection when model narrates code instead of calling tools).
    const historyMsgs = session.messages as OAIMessage[];
    const turnDone = getSuccessfulToolNames(historyMsgs);
    const lastToolOutcome = getLastToolOutcome(historyMsgs);
    let turnNextTool = 'contract_init';
    if (turnDone.has('contract_init')) turnNextTool = 'write_file';
    if (turnDone.has('contract_init') && turnDone.has('write_file')) turnNextTool = 'contract_build';
    if (turnDone.has('contract_build') && !turnDone.has('run_cargo_test')) turnNextTool = 'run_cargo_test';
    const createSequenceDone = turnDone.has('contract_build') && turnDone.has('run_cargo_test');

    log('INFO', `turn ${turn + 1}/${MAX_TURNS}`, { sessionId: session.id, phase: session.phase, nextTool: turnNextTool, createSequenceDone });

    // ── Call the model via OpenRouter (with 429 retry) ───────────────────
    type ToolCallAccum = { id: string; name: string; argumentsJson: string };
    const toolCallsById = new Map<number, ToolCallAccum>();
    let fullContent = '';
    let finishReason: string | null = null;
    let usage: UsageSummary | null = null;
    let streamError = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) break;

      log('INFO', `LLM call attempt ${attempt + 1}/${MAX_RETRIES + 1}`, { model: MODEL, historyLen: session.messages.length });

      // Build the message list for this API call — always pass full history so the
      // model can see which tool calls already succeeded and continue from there.
      const msgsForApi: OAIMessage[] = [...(session.messages as OAIMessage[])];
      const trimmed = trimHistory(msgsForApi);

      // Guard: if there are no user messages at all in the trimmed history, skip.
      // NOTE: do NOT check trimmed[last].role === 'user' — after tool call execution,
      // the last message is a 'tool' result, which is a valid state for calling the model.
      const hasUserMsg = trimmed.some((m) => m.role === 'user');
      if (trimmed.length === 0 || !hasUserMsg) {
        log('INFO', 'no user messages — skipping LLM call', { sessionId: session.id });
        emit({
          type: 'done',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
        });
        doneSent = true;
        break;
      }

      // Phase-specific tool filtering:
      // - DESIGN phase: hide implementation tools so the model MUST call update_project_spec
      // - CODE phase: hide update_project_spec so the model can't redo the design
      const CREATE_TOOLS = ['contract_init', 'write_file', 'contract_build', 'run_cargo_test', 'contract_deploy', 'contract_invoke'];
      const inCreatePhase = effectivePhase === 'code';
      const toolsForCall = inCreatePhase
        ? TOOLS.filter((t) => (t as any).function?.name !== 'update_project_spec')
        : TOOLS.filter((t) => !CREATE_TOOLS.includes((t as any).function?.name ?? ''));

      const lastRole = trimmed[trimmed.length - 1]?.role;

      // Force tool use in CREATE/BUILD/TEST phase when there's still work to do.
      // Fires on BOTH user messages (user sends a request) and tool results
      // (model should chain to the next tool, not narrate).
      const forceToolUse = effectivePhase === 'code' &&
        (lastRole === 'user' || lastRole === 'tool') &&
        toolsForCall.length > 0;
      const toolChoice: 'auto' | 'required' = forceToolUse ? 'required' : 'auto';

      // Inject explicit tool-call directive for the API call (NOT persisted to session.messages).
      // MiniMax ignores tool_choice:'required' but DOES follow instructions in the messages.
      // - If last msg is user: append directive to that user message
      // - If last msg is tool result: append a synthetic user message with the directive
      //   so the model has a clear "next action" prompt.
      let trimmedForApi: OAIMessage[] = trimmed;
      if (forceToolUse) {
        let directive: string;
        if (lastToolOutcome && !lastToolOutcome.success && lastToolOutcome.toolName === 'contract_build') {
          const failCount = getConsecutiveFailedToolCount(historyMsgs, 'contract_build');
          directive = `[AGENT DIRECTIVE: contract_build just failed${failCount > 1 ? ` (${failCount} times in a row)` : ''}. DO NOT call contract_build again immediately. First call read_file on the failing source files, then call write_file to fix compile errors, then call contract_build. NO text output.]`;
        } else if (lastToolOutcome && !lastToolOutcome.success && lastToolOutcome.toolName === 'run_cargo_test') {
          const failCount = getConsecutiveFailedToolCount(historyMsgs, 'run_cargo_test');
          directive = `[AGENT DIRECTIVE: run_cargo_test just failed${failCount > 1 ? ` (${failCount} times in a row)` : ''}. DO NOT call run_cargo_test again immediately. First call read_file on failing test/contract files, then call write_file to fix them, then rerun run_cargo_test. NO text output.]`;
        } else if (!createSequenceDone) {
          directive = `[AGENT DIRECTIVE: You MUST call a tool right now. NO text output. Call ${turnNextTool} immediately. Do not explain or narrate — just make the tool call.]`;
        } else {
          directive = `[AGENT DIRECTIVE: You MUST call a tool right now. NO text output. For follow-up edits, use read_file/write_file to modify existing files, then run contract_build and run_cargo_test to validate. Do not explain or narrate — just make the next tool call.]`;
        }
        if (lastRole === 'user') {
          const lastIdx = trimmed.length - 1;
          const lastMsg = trimmed[lastIdx];
          trimmedForApi = [
            ...trimmed.slice(0, lastIdx),
            { ...lastMsg, content: (typeof lastMsg.content === 'string' ? lastMsg.content : '') + `\n\n${directive}` },
          ];
        } else if (lastRole === 'tool') {
          // After a tool result: inject a synthetic follow-up user message
          trimmedForApi = [
            ...trimmed,
            { role: 'user', content: directive } as OAIMessage,
          ];
        }
      }

      // In code phase, replace the update_project_spec tool call exchange in the API
      // messages with a simple assistant text. MiniMax gets confused when the history
      // contains calls to a tool (update_project_spec) that's no longer in the tools list.
      if (effectivePhase === 'code') {
        const specCallIds = new Set<string>();
        trimmedForApi = trimmedForApi.reduce<OAIMessage[]>((acc, m) => {
          if (m.role === 'assistant' && (m as any).tool_calls) {
            const calls = (m as any).tool_calls as Array<{ id?: string; function?: { name?: string } }>;
            const hasSpecCall = calls.some((tc) => tc.function?.name === 'update_project_spec');
            if (hasSpecCall) {
              calls.forEach((tc) => tc.id && specCallIds.add(tc.id));
              // Replace entire tool_call exchange with a clean text marker
              acc.push({ role: 'assistant', content: 'Architecture design complete. Contract spec saved.' } as OAIMessage);
              return acc;
            }
          }
          if (m.role === 'tool' && specCallIds.has((m as any).tool_call_id)) {
            // Skip orphaned tool result for update_project_spec
            return acc;
          }
          acc.push(m);
          return acc;
        }, []);
      }

      log('INFO', 'sending to MiniMax (direct)', {
        msgCount: trimmedForApi.length + 1, // +1 for system
        toolCount: toolsForCall.length,
        syspromptLen: systemPrompt.length,
        lastMsgRole: lastRole,
        toolChoice,
        forceToolUse,
      });

      // Use direct HTTPS streaming (bypasses OpenAI SDK which returns 0 chunks for step 2).
      // The direct path is proven to work in test scripts and is identical to what
      // the raw HTTPS test calls that successfully return content.
      const allMsgsForCall: OAIMessage[] = [
        { role: 'system', content: systemPrompt } as OAIMessage,
        ...trimmedForApi,
      ];

      let chunkError = false;
      let chunkCount = 0;
      try {
        for await (const chunk of callMiniMaxStream(allMsgsForCall, toolsForCall, signal, toolChoice)) {
          if (signal.aborted) break;
          chunkCount++;

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Stream text content
          if (delta.content) {
            fullContent += delta.content;
            emit({ type: 'text_delta', text: delta.content });
          }

          // Accumulate tool call chunks
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallsById.has(idx)) {
                toolCallsById.set(idx, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  argumentsJson: '',
                });
                if (tc.id && tc.function?.name) {
                  emit({
                    type: 'tool_use',
                    toolName: tc.function.name,
                    toolUseId: tc.id,
                    input: {},
                  });
                }
              }
              if (tc.function?.arguments) {
                toolCallsById.get(idx)!.argumentsJson += tc.function.arguments;
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              cacheReadTokens: null,
              cacheCreationTokens: null,
            };
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === 'AbortError' || signal.aborted) {
          chunkError = true;
        } else if (isRateLimit(err) && attempt < MAX_RETRIES) {
          const waitMs = retryWaitMs(err);
          log('WARN', 'stream error — retrying', { waitMs, attempt, error: errMsg });
          emit({ type: 'text_delta', text: `\n[Retrying in ${Math.round(waitMs / 1000)}s…]\n` });
          toolCallsById.clear();
          fullContent = '';
          finishReason = null;
          usage = null;
          await sleep(waitMs);
          continue;
        } else {
          log('ERROR', 'stream error', { error: errMsg });
          emit({ type: 'error', message: `Stream error: ${errMsg}` });
          chunkError = true;
        }
      }

      if (chunkError) {
        streamError = true;
        break;
      }

      log('INFO', 'stream complete', { totalChunks: chunkCount, fullContentLen: fullContent.length, toolCallsAccum: toolCallsById.size, finishReason });

      // Detect empty completion: model returned no text and no tool calls.
      // On a paid model this is a transient glitch — retry quickly.
      if (fullContent === '' && toolCallsById.size === 0 && attempt < MAX_RETRIES) {
        log('WARN', 'empty response — retrying', { attempt, waitMs: EMPTY_RESPONSE_WAIT_MS, finishReason, inputTokens: usage?.inputTokens ?? null });
        await sleep(EMPTY_RESPONSE_WAIT_MS);
        continue;
      }

      log('INFO', 'LLM response received', {
        finishReason,
        contentLen: fullContent.length,
        toolCalls: toolCallsById.size,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
      break; // success — exit retry loop
    }

    if (streamError) break;
    if (doneSent) break; // guard triggered (e.g. empty msgsForApi after filter)

    // If all retries produced empty content, emit an error rather than pushing
    // a null message that would corrupt future context.
    if (fullContent === '' && toolCallsById.size === 0) {
      log('ERROR', 'model returned empty response after all retries', { sessionId: session.id, historyLen: session.messages.length });
      emit({ type: 'error', message: 'Model returned empty response — try sending your message again.' });
      break;
    }

    // ── Append assistant message to history ───────────────────────────────
    const toolCalls = [...toolCallsById.values()];
    const assistantMessage: OAIMessage = {
      role: 'assistant',
      content: fullContent || '',
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.argumentsJson },
            })),
          }
        : {}),
    };
    session.messages.push(assistantMessage);
    session.lastActivityAt = Date.now();

    // Done — no tool calls pending
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      let specSavedThisTurn = false;

      // Detect Python-style update_project_spec calls that some models (Gemini)
      // incorrectly emit as text content instead of real function calls.
      if (fullContent?.includes('update_project_spec(')) {
        const pythonSpec = extractPythonSpec(fullContent);
        if (pythonSpec) {
          log('INFO', 'detected Python-style update_project_spec — executing', { sessionId: session.id });
          db.updateProjectSpec(session.projectId, pythonSpec);
          session.projectSpec = pythonSpec;
          specSavedThisTurn = true;
          emit({ type: 'spec_updated', spec: pythonSpec });
        }
      }

      // MiniMax and similar models may produce the architecture diagram in text without
      // ever calling update_project_spec. Auto-save if the response contains a mermaid
      // block and the project spec is still empty.
      if (fullContent?.includes('```mermaid')) {
        const currentSpec = db.getProject(session.projectId)?.spec ?? '';
        if (!currentSpec.trim()) {
          log('INFO', 'auto-saving mermaid spec from text response', { sessionId: session.id });
          // Extract only the structured spec doc (from the first # heading) — skip the
          // IDEATE/DIAGRAM narrative preamble that would pollute system-prompt injection.
          const specDoc = extractSpecDoc(fullContent);
          db.updateProjectSpec(session.projectId, specDoc);
          session.projectSpec = specDoc;
          specSavedThisTurn = true;
          emit({ type: 'spec_updated', spec: specDoc });
        }

        // Replace the text design response in history with a synthetic update_project_spec
        // tool call exchange. MiniMax returns an empty response for step 2 when it sees its own
        // text design response in history — the model treats the text as still being in the
        // IDEATE/DIAGRAM stage rather than moving to CREATE.
        // Converting the history to a tool-call exchange (the expected workflow shape) fixes this.
        // IMPORTANT: the spec argument must NOT contain "### IDEATE" or other workflow stage markers
        // (e.g. "### DIAGRAM") — MiniMax sees those as triggers to stay in the design phase and
        // returns an empty completion. Use a clean architectural summary instead.
        // CRITICAL: do NOT put mermaid or any design-stage content in the synthetic spec
        // argument. MiniMax pattern-matches on mermaid/diagram content anywhere in context
        // (including inside JSON tool-call arguments) and returns an empty completion for
        // the next turn when it finds it.
        const cleanSpec = 'Architecture design complete. Contract spec and diagram saved to project. Ready for implementation.';
        const syntheticId = `spec_${Date.now()}`;
        session.messages[session.messages.length - 1] = {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: syntheticId,
            type: 'function',
            function: {
              name: 'update_project_spec',
              arguments: JSON.stringify({ spec: cleanSpec }),
            },
          }],
        } as OAIMessage;
        session.messages.push({
          role: 'tool',
          tool_call_id: syntheticId,
          content: 'Project specification updated successfully.',
        } as OAIMessage);
        log('INFO', 'converted text design to synthetic tool call (clean spec)', { sessionId: session.id, cleanSpecLen: cleanSpec.length });
      }

      // Detect JSON-style functions.write_file({...}) calls that some models (Claude Sonnet)
      // emit as text instead of using the function-calling API — CREATE phase only.
      let writeFileSavedThisTurn = false;
      if (inCreatePhaseAtTurnStart && fullContent &&
          (fullContent.includes('functions.write_file({') || fullContent.includes('write_file({'))) {
        const jsonWriteCalls = extractJsonWriteFileCalls(fullContent);
        if (jsonWriteCalls.length > 0) {
          log('INFO', `detected ${jsonWriteCalls.length} JSON-style write_file call(s) in text`, { sessionId: session.id });
          const fileSaves: Array<{ syntheticId: string; path: string; content: string }> = [];
          for (let wi = 0; wi < jsonWriteCalls.length; wi++) {
            fileSaves.push({ syntheticId: `wf_json_${Date.now()}_${wi}`, ...jsonWriteCalls[wi] });
          }
          const toolResultsForHistory: Array<{ syntheticId: string; path: string; resultContent: string }> = [];
          for (const { syntheticId, path, content } of fileSaves) {
            emit({ type: 'tool_use', toolName: 'write_file', toolUseId: syntheticId, input: { path } });
            const result = await executeToolSafe('write_file', { path, content }, session, ragStore, db);
            const emitPath = result.writtenPath ?? path;
            if (!result.isError) {
              emit({ type: 'file_written', path: emitPath, content });
            }
            emit({ type: 'tool_result', toolUseId: syntheticId, result: result.content, isError: result.isError });
            toolResultsForHistory.push({ syntheticId, path, resultContent: result.content });
            log('INFO', `executed JSON-style write_file → ${emitPath}`, { sessionId: session.id, ok: !result.isError });
          }
          // Replace the text message with a synthetic write_file tool-call exchange so the
          // next turn sees the correct history shape (no stray text with function calls).
          session.messages[session.messages.length - 1] = {
            role: 'assistant' as const,
            content: '',
            tool_calls: fileSaves.map(({ syntheticId, path }) => ({
              id: syntheticId,
              type: 'function' as const,
              function: { name: 'write_file', arguments: JSON.stringify({ path, content: '[content written]' }) },
            })),
          } as OAIMessage;
          session.messages.push(...toolResultsForHistory.map(({ syntheticId, path, resultContent }) => ({
            role: 'tool' as const,
            tool_call_id: syntheticId,
            content: resultContent || `File written: ${path}`,
          } as OAIMessage)));
          writeFileSavedThisTurn = true;
        }
      }

      // Auto-save rust/toml code blocks from model text output — CREATE phase only.
      // GATE: only fires when spec was already set at turn start (inCreatePhaseAtTurnStart).
      // Skip if JSON-style write_file calls were already handled above (same files, different format).
      // Design phase (no spec yet) MUST NOT save code blocks even if the model outputs them —
      // design responses always precede user approval of the spec. Removing this gate causes
      // code to be written to disk on the first message before the user approves the design.
      const codeBlockMatches = inCreatePhaseAtTurnStart && !writeFileSavedThisTurn
        ? [...(fullContent ?? '').matchAll(/```(?:rust|toml)\n([\s\S]+?)```/g)]
        : [];

      if (codeBlockMatches.length > 0) {
        log('INFO', `auto-saving ${codeBlockMatches.length} code block(s) from text`, { sessionId: session.id, inCreatePhase: inCreatePhaseAtTurnStart });

        // Determine contract name from history (contract_init arguments or workspace)
        const initCall = (session.messages as OAIMessage[])
          .flatMap((m) => (m as any).tool_calls ?? [])
          .find((tc: any) => tc.function?.name === 'contract_init');
        let contractName = 'contract';
        if (initCall) {
          try {
            const a = JSON.parse(initCall.function.arguments ?? '{}');
            if (a.contractName) contractName = (a.contractName as string).replace(/[^a-z0-9_]/gi, '_');
          } catch { /* use default */ }
        }

        // Build a list of synthetic write_file calls from the code blocks
        const fileSaves: Array<{ syntheticId: string; path: string; content: string }> = [];
        let rustBlockCount = 0;
        let tomlBlockCount = 0;
        for (const match of codeBlockMatches) {
          const content = match[1];
          const lang = (match[0].match(/^```([a-z]*)\n/) ?? [])[1] ?? '';
          let filePath: string;
          if (lang === 'toml') {
            // Determine if it's workspace or per-crate Cargo.toml by content
            const isCdylib = content.includes('cdylib') || content.includes('[package]');
            if (isCdylib && tomlBlockCount === 0) {
              filePath = `contracts/${contractName}/Cargo.toml`;
            } else {
              filePath = tomlBlockCount === 0 ? 'Cargo.toml' : `contracts/${contractName}/Cargo.toml`;
            }
            tomlBlockCount++;
          } else {
            // Rust code
            const isTest = content.includes('#[cfg(test)]') || content.includes('mod tests');
            filePath = isTest && rustBlockCount > 0
              ? `contracts/${contractName}/src/test.rs`
              : `contracts/${contractName}/src/lib.rs`;
            rustBlockCount++;
          }

          const syntheticId = `wf_${Date.now()}_${fileSaves.length}`;
          fileSaves.push({ syntheticId, path: filePath, content });
        }

        // Execute write_file for each code block and build synthetic history.
        // Emit tool_use BEFORE executing so extractToolNames() in tests finds 'write_file'.
        const toolResultsForHistory: Array<{ syntheticId: string; path: string; resultContent: string }> = [];
        for (const { syntheticId, path, content } of fileSaves) {
          emit({ type: 'tool_use', toolName: 'write_file', toolUseId: syntheticId, input: { path } });
          const result = await executeToolSafe('write_file', { path, content }, session, ragStore, db);
          const emitPath = result.writtenPath ?? path;
          if (!result.isError) {
            emit({ type: 'file_written', path: emitPath, content });
          }
          emit({ type: 'tool_result', toolUseId: syntheticId, result: result.content, isError: result.isError });
          toolResultsForHistory.push({ syntheticId, path, resultContent: result.content });
          log('INFO', `auto-saved code block to ${emitPath}`, { sessionId: session.id, ok: !result.isError });
        }

        // Append or replace the assistant message with a synthetic write_file exchange.
        // - When mermaid was processed earlier, the text message was already swapped for a
        //   synthetic spec exchange → APPEND the write_file exchange after it.
        // - Otherwise the last message is still the text response → REPLACE it.
        if (fileSaves.length > 0) {
          const firstSave = fileSaves[0];
          const mermaidAlreadyProcessed = !!(fullContent?.includes('```mermaid'));
          const writeFileAssistantMsg = {
            role: 'assistant' as const,
            content: '',
            tool_calls: fileSaves.map(({ syntheticId, path }) => ({
              id: syntheticId,
              type: 'function' as const,
              function: { name: 'write_file', arguments: JSON.stringify({ path, content: '[content written]' }) },
            })),
          } as OAIMessage;
          const writeFileResultMsgs = toolResultsForHistory.map(({ syntheticId, path, resultContent }) => ({
            role: 'tool' as const,
            tool_call_id: syntheticId,
            content: resultContent || `File written: ${path}`,
          } as OAIMessage));

          if (mermaidAlreadyProcessed) {
            // Text message was already replaced by spec exchange — APPEND write_file after it
            session.messages.push(writeFileAssistantMsg, ...writeFileResultMsgs);
          } else {
            // Last message is still the text response — REPLACE it with write_file exchange
            session.messages[session.messages.length - 1] = writeFileAssistantMsg;
            session.messages.push(...writeFileResultMsgs);
          }
          log('INFO', `${mermaidAlreadyProcessed ? 'appended' : 'replaced with'} synthetic write_file exchange`, {
            sessionId: session.id, files: fileSaves.map((s) => s.path), firstFile: firstSave.path,
          });
        }
        narrativeContinuations = 0;
      } else {
        narrativeContinuations = 0;
      }

      // Detect JSON-style pseudo tool calls in plain text output and execute them
      // as real tool calls so recovery flows (e.g. functions.contract_build(...))
      // continue automatically in the same loop.
      if (inCreatePhaseAtTurnStart && fullContent) {
        const pseudoCalls = extractJsonToolCalls(fullContent, ['contract_init', 'contract_build', 'run_cargo_test']);
        if (pseudoCalls.length > 0) {
          log('INFO', `detected ${pseudoCalls.length} JSON-style pseudo tool call(s)`, { sessionId: session.id });
          const syntheticCalls = pseudoCalls.map((c, idx) => ({
            ...c,
            syntheticId: `pseudo_${Date.now()}_${idx}`,
          }));

          const toolResultMessages: OAIMessage[] = [];
          for (const call of syntheticCalls) {
            emit({ type: 'tool_use', toolName: call.toolName, toolUseId: call.syntheticId, input: call.input });
            const result = await executeToolSafe(call.toolName, call.input, session, ragStore, db);
            emit({ type: 'tool_result', toolUseId: call.syntheticId, result: result.content, isError: result.isError });
            toolResultMessages.push({
              role: 'tool',
              tool_call_id: call.syntheticId,
              content: result.content,
            } as OAIMessage);
          }

          // Replace the text pseudo-call with synthetic structured tool exchange.
          session.messages[session.messages.length - 1] = {
            role: 'assistant',
            content: '',
            tool_calls: syntheticCalls.map((c) => ({
              id: c.syntheticId,
              type: 'function' as const,
              function: {
                name: c.toolName,
                arguments: JSON.stringify(c.input),
              },
            })),
          } as OAIMessage;
          session.messages.push(...toolResultMessages);

          try { persistTurn(session, db); } catch (dbErr) { log('WARN', 'persistTurn failed (pseudo tool calls)', { error: String(dbErr) }); }
          // Continue loop instead of stopping so model can react to tool results.
          yield;
          continue;
        }
      }

      try { persistTurn(session, db); } catch (dbErr) { log('WARN', 'persistTurn failed (natural stop)', { error: String(dbErr) }); }
      log('INFO', 'loop done — natural stop', { turn: turn + 1, finishReason, sessionId: session.id });
      // Signal frontend to show Accept/Edit buttons when design phase just saved a spec
      if (specSavedThisTurn && effectivePhase === 'design') {
        emit({ type: 'needs_approval' });
      }
      emit({
        type: 'done',
        usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
      });
      doneSent = true;
      break;
    }

    // ── Execute all tool calls in parallel ────────────────────────────────
    const toolNames = toolCalls.map((tc) => tc.name);
    log('INFO', `dispatching ${toolCalls.length} tool call(s)`, { tools: toolNames, sessionId: session.id });
    const toolResultMessages: OAIMessage[] = [];
    for (const tc of toolCalls) {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.argumentsJson ? JSON.parse(tc.argumentsJson) : {};
        } catch {
          parsedInput = {};
        }

        if (tc.name === 'contract_build' && shouldBlockRetryUntilWrite(session.messages as OAIMessage[], 'contract_build')) {
          const blockedMsg = 'Blocked repetitive contract_build: previous build failed and no successful write_file has happened since. Read failing files, write fixes, then build again.';
          emit({
            type: 'tool_result',
            toolUseId: tc.id,
            result: blockedMsg,
            isError: true,
          });
          toolResultMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: blockedMsg,
          } satisfies OAIMessage);
          continue;
        }

        if (tc.name === 'run_cargo_test' && shouldBlockRetryUntilWrite(session.messages as OAIMessage[], 'run_cargo_test')) {
          const blockedMsg = 'Blocked repetitive run_cargo_test: previous test run failed and no successful write_file has happened since. Read failing files, write fixes, then run tests again.';
          emit({
            type: 'tool_result',
            toolUseId: tc.id,
            result: blockedMsg,
            isError: true,
          });
          toolResultMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: blockedMsg,
          } satisfies OAIMessage);
          continue;
        }

        const result = await executeToolSafe(tc.name, parsedInput, session, ragStore, db);

        // Emit file_written for successful write_file calls so the frontend can
        // trigger the live reveal animation without a separate API fetch.
        if (tc.name === 'write_file' && !result.isError) {
          const args = parsedInput as { path?: string; content?: string };
          if (args.path && args.content) {
            const emitPath = result.writtenPath ?? args.path;
            emit({ type: 'file_written', path: emitPath, content: args.content });
          }
        }

        emit({
          type: 'tool_result',
          toolUseId: tc.id,
          result: result.content,
          isError: result.isError,
        });

        toolResultMessages.push({
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result.content,
        } satisfies OAIMessage);
      }

    // If the spec was updated, notify the frontend so it can refresh live.
    // Track whether this turn completed the design phase so we can stop the loop
    // immediately rather than continuing to turn 2 with an empty message history.
    let designPhaseComplete = false;
    for (const tc of toolCalls) {
      if (tc.name === 'update_project_spec') {
        designPhaseComplete = true;
        // Use session.projectSpec (set by executor in project-ops.ts) — always correct.
        // Avoids JSON.parse on argumentsJson which can silently fail for large specs.
        if (session.projectSpec) emit({ type: 'spec_updated', spec: session.projectSpec });
      }
    }

    // Append all tool results to history and persist
    session.messages.push(...toolResultMessages);
    try { persistTurn(session, db); } catch (dbErr) { log('WARN', 'persistTurn failed (tool results)', { error: String(dbErr) }); }

    // Design phase complete — terminate the loop here. The spec is now in the system
    // prompt for subsequent user messages. Continuing to turn 2 would call MiniMax with
    // zero user messages (my history filter strips the entire design exchange), which
    // triggers an empty response and corrupts conversation state.
    if (designPhaseComplete) {
      log('INFO', 'design phase complete — stopping loop after update_project_spec', { sessionId: session.id });
      // Signal frontend to show Accept/Edit buttons — user must accept before code phase starts
      if (effectivePhase === 'design') {
        emit({ type: 'needs_approval' });
      }
      emit({
        type: 'done',
        usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
      });
      doneSent = true;
      break;
    }

    yield; // allow SSE writes to flush between turns
  }

  // If MAX_TURNS exhausted without a natural stop, close the stream so callers don't hang
  if (!doneSent && !signal.aborted) {
    log('WARN', `max turns (${MAX_TURNS}) exhausted`, { sessionId: session.id });
    emit({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: null, cacheCreationTokens: null },
    });
  } else if (signal.aborted) {
    log('INFO', 'loop aborted by client disconnect', { sessionId: session.id });
  }
}
