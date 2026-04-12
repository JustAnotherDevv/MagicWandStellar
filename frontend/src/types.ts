export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet' | 'local'

// ── Domain objects (camelCase, normalized from backend snake_case) ─────────

export interface Project {
  id: string
  userId: string
  name: string
  spec: string
  network: string
  workspaceDir: string
  createdAt: number
  updatedAt: number
  contractCount?: number
}

export interface SessionSummary {
  id: string
  projectId: string
  userId: string
  createdAt: number
  lastActivityAt: number
  workspaceDir: string
  network: StellarNetwork
  messageCount: number
}

export interface Contract {
  id: number
  contractId: string
  projectId: string
  sessionId: string
  userId: string
  network: string
  wasmPath: string | null
  sourceAccount: string | null
  name: string | null     // maps to contract_alias in DB
  deployedAt: number
  status: 'deployed' | 'failed' | 'pending'
}

// ── UI-only chat types ─────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolUses?: ToolUseEvent[]
}

export interface ToolUseEvent {
  id: string       // toolUseId
  name: string     // toolName
  input: unknown
  status: 'running' | 'success' | 'error'
  result?: string
}

// ── SSE events (match backend exactly) ────────────────────────────────────

export type SSEEvent =
  | { type: 'session_created'; sessionId: string }
  | { type: 'thinking'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; toolName: string; toolUseId: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean }
  | { type: 'spec_updated'; spec: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } | null }
  | { type: 'error'; message: string }

// ── File tree ──────────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

// ── API responses ──────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok'
  docsLoaded: number
  sessionsActive: number
  uptimeSeconds: number
  model: string
  tools: number
}

export interface Stats {
  users: { total: number }
  projects: { total: number; byNetwork: Record<string, number> }
  sessions: { active: number; total: number }
  contracts: { total: number; byNetwork: Record<string, number>; recentDeployments: Contract[] }
}

export interface BuildResult {
  success: boolean
  output: string
}
