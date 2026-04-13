import type { StellarNetwork } from '../config/index.js';

export type { StellarNetwork };

// Re-export Anthropic types used throughout the codebase
export type {
  MessageParam,
  Tool,
  ToolUseBlock,
  ToolResultBlockParam,
  ContentBlock,
  ContentBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

// ─── Session ───────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  projectId: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
  workspaceDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[]; // MessageParam[] — typed as any to avoid Anthropic union complexity
  network: StellarNetwork;
  thinkingBudget?: number;
  phase: 'design' | 'code';   // explicit phase — NOT derived from spec presence
  projectSpec?: string;        // spec content, injected into code-phase system prompt
  contractDir?: string;        // subdir created by contract_init, e.g. "token_contract" — write_file uses this as base
  _messagesLoaded?: boolean;   // lazy hydration flag
  _persistedMsgCount?: number; // watermark for incremental persist
  agentMode?: 'contract' | 'ui';
}

export interface SessionSummary {
  id: string;
  projectId: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
  workspaceDir: string;
  network: StellarNetwork;
  messageCount: number;
}

// ─── API shapes ────────────────────────────────────────────────────────────

export interface ChatRequest {
  sessionId?: string;
  projectId?: string;
  userId?: string;
  message: string;
  network?: StellarNetwork;
  thinkingBudget?: number;
  agentMode?: 'contract' | 'ui';
}

export type SSEEvent =
  | { type: 'session_created'; sessionId: string }
  | { type: 'thinking'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean }
  | { type: 'file_written'; path: string; content: string }  // reliable file-written signal for live reveal
  | { type: 'spec_updated'; spec: string }
  | { type: 'needs_approval' }   // design phase complete — frontend shows Accept/Edit buttons
  | { type: 'done'; usage: UsageSummary }
  | { type: 'error'; message: string };

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

// ─── RAG ───────────────────────────────────────────────────────────────────

export interface DocFile {
  filename: string;
  content: string;
  isSkillDoc: boolean;
}

export interface DocChunk {
  docFilename: string;
  chunkIndex: number;
  text: string;
  terms: string[];
}

export interface SearchResult {
  docFilename: string;
  chunkIndex: number;
  score: number;
  text: string;
}

// ─── Tools ─────────────────────────────────────────────────────────────────

export interface ToolResult {
  content: string;
  isError: boolean;
  writtenPath?: string;  // workspace-relative path actually written (write_file only)
}
