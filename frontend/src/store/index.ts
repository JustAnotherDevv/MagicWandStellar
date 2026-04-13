import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project, SessionSummary, ChatMessage, ToolUseEvent, Contract, FileNode, ChatAgentMode } from '../types'

export type PanelView = 'chat' | 'spec' | 'code' | 'tests' | 'logs' | 'contracts' | 'app'
export type ShellView = 'build' | 'apps'

interface WalletState {
  publicKey: string | null
  network: string
  isConnected: boolean
}

interface ChatTurn {
  sessionId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  streamingText: string
  streamingToolUses: ToolUseEvent[]
  abortController: AbortController | null
  error: string | null
  usage: { inputTokens: number; outputTokens: number } | null
  specNeedsApproval: boolean
  agentMode: ChatAgentMode
}

interface AppState {
  // Wallet
  wallet: WalletState
  setWallet: (w: Partial<WalletState>) => void

  // Projects
  projects: Project[]
  setProjects: (p: Project[]) => void
  activeProjectId: string | null
  setActiveProject: (id: string | null) => void
  activeProject: () => Project | null

  // Sessions
  sessions: SessionSummary[]
  setSessions: (s: SessionSummary[]) => void
  activeSessionId: string | null
  setActiveSession: (id: string | null) => void

  // Contracts
  contracts: Contract[]
  setContracts: (c: Contract[]) => void

  // Panel
  panelView: PanelView
  setPanelView: (v: PanelView) => void
  shellView: ShellView
  setShellView: (v: ShellView) => void

  // Spec editor
  specDraft: string
  setSpecDraft: (s: string) => void
  specEditing: boolean
  setSpecEditing: (b: boolean) => void

  // Code panel
  activeFile: string | null
  setActiveFile: (f: string | null) => void
  fileContents: Record<string, string>
  setFileContent: (path: string, content: string) => void
  // File tree — stored globally so ChatPanel can refresh it directly on file_written
  files: FileNode[]
  setFiles: (files: FileNode[]) => void
  filesProjectId: string | null   // which project the current files[] belongs to
  // Signal a freshly-written file so CodePanel can animate the reveal
  newlyWrittenFile: { path: string; content: string } | null
  signalFileWritten: (path: string, content: string) => void
  clearNewlyWrittenFile: () => void
  // Monotonic counter — increments on every signalFileWritten; CodePanel watches this
  // instead of newlyWrittenFile?.content (avoids large-string dep comparison)
  fileListRevision: number

  // Chat
  chat: ChatTurn
  resetChat: () => void
  setMessages: (messages: ChatMessage[]) => void
  appendMessage: (m: ChatMessage) => void
  updateStreamingText: (text: string) => void
  updateStreamingToolUses: (tools: ToolUseEvent[]) => void
  setStreaming: (b: boolean) => void
  setSessionId: (id: string | null) => void
  setAbortController: (ac: AbortController | null) => void
  setChatError: (e: string | null) => void
  finalizeStream: (usage: { inputTokens: number; outputTokens: number } | null) => void

  // Spec approval
  setSpecNeedsApproval: (b: boolean) => void
  setChatAgentMode: (mode: ChatAgentMode) => void

  // Logs (circular buffer)
  logs: string[]
  appendLog: (line: string) => void
  clearLogs: () => void

  // Landing page overlay
  showLanding: boolean
  setShowLanding: (v: boolean) => void
}

const DEFAULT_CHAT: ChatTurn = {
  sessionId: null,
  messages: [],
  isStreaming: false,
  streamingText: '',
  streamingToolUses: [],
  abortController: null,
  error: null,
  usage: null,
  specNeedsApproval: false,
  agentMode: 'contract',
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Wallet
      wallet: { publicKey: null, network: 'testnet', isConnected: false },
      setWallet: (w) => set((s) => ({ wallet: { ...s.wallet, ...w } })),

      // Projects
      projects: [],
      setProjects: (projects) => set({ projects }),
      activeProjectId: null,
      setActiveProject: (id) => {
        set({ activeProjectId: id, activeSessionId: null })
        // Reset chat when switching projects
        set({ chat: { ...DEFAULT_CHAT } })
        if (id) {
          const proj = get().projects.find((p) => p.id === id)
          if (proj) set({ specDraft: proj.spec || '' })
        }
      },
      activeProject: () => {
        const { projects, activeProjectId } = get()
        return projects.find((p) => p.id === activeProjectId) ?? null
      },

      // Sessions
      sessions: [],
      setSessions: (sessions) => set({ sessions }),
      activeSessionId: null,
      setActiveSession: (id) => set({ activeSessionId: id }),

      // Contracts
      contracts: [],
      setContracts: (contracts) => set({ contracts }),

      // Panel
      panelView: 'chat',
      setPanelView: (panelView) => set({ panelView }),
      shellView: 'build',
      setShellView: (shellView) => set({ shellView }),

      // Spec
      specDraft: '',
      setSpecDraft: (specDraft) => set({ specDraft }),
      specEditing: false,
      setSpecEditing: (specEditing) => set({ specEditing }),

      // Code
      activeFile: null,
      setActiveFile: (activeFile) => set({ activeFile }),
      fileContents: {},
      setFileContent: (path, content) =>
        set((s) => ({ fileContents: { ...s.fileContents, [path]: content } })),
      files: [],
      setFiles: (files) => set({ files }),
      filesProjectId: null,
      newlyWrittenFile: null,
      signalFileWritten: (path, content) =>
        set((s) => ({
          newlyWrittenFile: { path, content },
          activeFile: path,
          fileContents: { ...s.fileContents, [path]: content },
          fileListRevision: s.fileListRevision + 1,
        })),
      clearNewlyWrittenFile: () => set({ newlyWrittenFile: null }),
      fileListRevision: 0,

      // Chat
      chat: { ...DEFAULT_CHAT },
      resetChat: () => set({ chat: { ...DEFAULT_CHAT } }),
      setMessages: (messages) =>
        set((s) => ({ chat: { ...s.chat, messages } })),
      appendMessage: (m) =>
        set((s) => ({ chat: { ...s.chat, messages: [...s.chat.messages, m] } })),
      updateStreamingText: (text) =>
        set((s) => ({ chat: { ...s.chat, streamingText: text } })),
      updateStreamingToolUses: (streamingToolUses) =>
        set((s) => ({ chat: { ...s.chat, streamingToolUses } })),
      setStreaming: (isStreaming) =>
        set((s) => ({ chat: { ...s.chat, isStreaming } })),
      setSessionId: (sessionId) =>
        set((s) => ({ chat: { ...s.chat, sessionId }, activeSessionId: sessionId })),
      setAbortController: (abortController) =>
        set((s) => ({ chat: { ...s.chat, abortController } })),
      setChatError: (error) =>
        set((s) => ({ chat: { ...s.chat, error } })),
      finalizeStream: (usage) =>
        set((s) => ({
          chat: {
            ...s.chat,
            isStreaming: false,
            streamingText: '',
            streamingToolUses: [],
            abortController: null,
            usage,
          },
        })),

      // Spec approval
      setSpecNeedsApproval: (specNeedsApproval) =>
        set((s) => ({ chat: { ...s.chat, specNeedsApproval } })),
      setChatAgentMode: (agentMode) =>
        set((s) => ({ chat: { ...s.chat, agentMode } })),

      // Logs
      logs: [],
      appendLog: (line) =>
        set((s) => ({ logs: [...s.logs.slice(-499), line] })),
      clearLogs: () => set({ logs: [] }),

      // Landing page
      showLanding: false,
      setShowLanding: (showLanding) => set({ showLanding }),
    }),
    {
      name: 'stellar-agents-ui',
      partialize: (s) => ({
        wallet: s.wallet,
        activeProjectId: s.activeProjectId,
        activeSessionId: s.activeSessionId,
        panelView: s.panelView,
        shellView: s.shellView,
      }),
    },
  ),
)
