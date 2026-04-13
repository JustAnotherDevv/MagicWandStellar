import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '@/store'
import { streamChat } from '@/lib/sse'
import { api } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Send, Square, Loader2, ChevronDown, ChevronRight, Terminal, Wrench, CheckCircle, PencilLine } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage, ToolUseEvent } from '@/types'
import { MermaidBlock } from '@/components/MermaidBlock'

export function ChatPanel() {
  const wallet = useStore((s) => s.wallet)
  const activeProject = useStore((s) => s.activeProject())
  const chat = useStore((s) => s.chat)
  const sessions = useStore((s) => s.sessions)
  const setSessions = useStore((s) => s.setSessions)
  const setProjects = useStore((s) => s.setProjects)
  const setSpecDraft = useStore((s) => s.setSpecDraft)
  const setPanelView = useStore((s) => s.setPanelView)
  const signalFileWritten = useStore((s) => s.signalFileWritten)
  const {
    appendMessage,
    updateStreamingText,
    updateStreamingToolUses,
    setStreaming,
    setSessionId,
    setAbortController,
    setChatError,
    finalizeStream,
    resetChat,
    setSpecNeedsApproval,
  } = useStore((s) => s)
  const appendLog = useStore((s) => s.appendLog)
  const setChatAgentMode = useStore((s) => s.setChatAgentMode)

  const [input, setInput] = useState('')
  const [acceptingSpec, setAcceptingSpec] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Core streaming helper — sends a message and processes SSE events.
  // Extracted so both sendMessage and handleAcceptSpec can share the same logic.
  const sendText = useCallback(async (text: string, sessionIdOverride?: string) => {
    if (!activeProject) return

    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    appendMessage(userMsg)
    setStreaming(true)
    setChatError(null)

    const ac = new AbortController()
    setAbortController(ac)

    let currentText = ''
    let currentTools: ToolUseEvent[] = []

    try {
      const stream = streamChat(
        {
          userId: wallet.publicKey!,
          projectId: activeProject.id,
          sessionId: sessionIdOverride ?? chat.sessionId ?? undefined,
          message: text,
          network: wallet.network as 'testnet' | 'mainnet',
          agentMode: chat.agentMode,
        },
        ac.signal,
      )

      for await (const event of stream) {
        if (event.type === 'session_created') {
          setSessionId(event.sessionId)
          appendLog(`[session] created ${event.sessionId}`)
          api.getSessions(wallet.publicKey!, activeProject.id)
            .then((s) => setSessions(s))
            .catch(() => {})
        } else if (event.type === 'text_delta') {
          currentText += event.text
          updateStreamingText(currentText)
        } else if (event.type === 'tool_use') {
          // Switch to code panel as soon as write_file starts so the user sees it live
          if (event.toolName === 'write_file') {
            setPanelView('code')
          }
          const toolEvent = {
            id: event.toolUseId,
            name: event.toolName,
            input: event.input,
            status: 'running' as const,
          }
          currentTools = [...currentTools, toolEvent]
          updateStreamingToolUses(currentTools)
          appendLog(`[tool] ${event.toolName} — running`)
        } else if (event.type === 'file_written') {
          // Reliable file-written signal — emitted after successful write_file with full content.
          // 1. Triggers the live reveal animation in CodePanel.
          signalFileWritten(event.path, event.content)
          // 2. Refresh file tree — write direct to store state so CodePanel sees the update.
          if (activeProject) {
            api.getFiles(activeProject.id)
              .then((result) => useStore.setState({ files: result }))
              .catch(() => {})
          }
        } else if (event.type === 'tool_result') {
          currentTools = currentTools.map((t) =>
            t.id === event.toolUseId
              ? { ...t, status: (event.isError ? 'error' : 'success') as 'success' | 'error', result: event.result }
              : t
          )
          updateStreamingToolUses(currentTools)
          appendLog(`[tool_result] ${event.toolUseId.slice(0, 8)} — ${event.isError ? 'error' : 'ok'}`)
        } else if (event.type === 'spec_updated') {
          if (activeProject) {
            setProjects(useStore.getState().projects.map((p) =>
              p.id === activeProject.id ? { ...p, spec: event.spec } : p
            ))
            setSpecDraft(event.spec)
          }
        } else if (event.type === 'needs_approval') {
          setSpecNeedsApproval(true)
        } else if (event.type === 'done') {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: currentText,
            timestamp: new Date().toISOString(),
            toolUses: currentTools.length > 0 ? currentTools : undefined,
          }
          appendMessage(assistantMsg)
          finalizeStream(event.usage ?? null)
          currentText = ''
          currentTools = []
          appendLog(`[chat] done — ${event.usage?.outputTokens ?? 0} output tokens`)
        } else if (event.type === 'error') {
          setChatError(event.message)
          finalizeStream(null)
          appendLog(`[chat] error — ${event.message}`)
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setChatError(err?.message ?? 'Unknown error')
        appendLog(`[chat] fetch error — ${err?.message}`)
      }
      finalizeStream(null)
    }
  }, [chat.sessionId, chat.agentMode, activeProject, wallet, setPanelView, signalFileWritten])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || chat.isStreaming) return
    setInput('')
    await sendText(text)
  }, [input, chat.isStreaming, sendText])

  const handleAcceptSpec = useCallback(async () => {
    if (!chat.sessionId || chat.isStreaming) return
    setAcceptingSpec(true)
    try {
      await api.acceptSpec(chat.sessionId)
      setSpecNeedsApproval(false)
      // Update project phase in store so approval banner disappears immediately
      const pid = useStore.getState().activeProjectId
      if (pid) {
        setProjects(useStore.getState().projects.map((p) =>
          p.id === pid ? { ...p, phase: 'code' as const } : p
        ))
      }
      appendLog('[spec] accepted — switching to code phase')
    } catch (err: any) {
      appendLog(`[spec] accept failed — ${err?.message}`)
      setAcceptingSpec(false)
      return
    }
    setAcceptingSpec(false)
    // Immediately trigger implementation — user clicked Accept, start coding now
    await sendText(
      'Implement the full contract code as described in the approved spec.',
      chat.sessionId,
    )
  }, [chat.sessionId, chat.isStreaming, setProjects, setSpecNeedsApproval, appendLog, sendText])

  const handleEditSpec = useCallback(() => {
    setSpecNeedsApproval(false)
    appendLog('[spec] edit requested — staying in design phase')
  }, [setSpecNeedsApproval, appendLog])

  const handleStop = () => {
    chat.abortController?.abort()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        Select or create a project to start
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session info */}
      <div className="px-4 py-2 border-b-2 border-[rgba(245,234,216,0.08)] flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-ink-muted">
          {chat.sessionId ? (
            <>Session: <span className="font-mono text-ink-muted/70">{chat.sessionId.slice(0, 12)}…</span></>
          ) : 'New session'}
        </span>
        {chat.sessionId && (
          <button
            onClick={resetChat}
            className="text-[10px] text-ink-muted hover:text-ink"
          >
            New chat
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setChatAgentMode('contract')}
            className={cn(
              'text-[10px] px-2 py-1 rounded border',
              chat.agentMode === 'contract'
                ? 'border-accent/60 text-ink bg-accent/10'
                : 'border-white/10 text-ink-muted hover:text-ink',
            )}
            disabled={chat.isStreaming}
          >
            Contract Agent
          </button>
          <button
            onClick={() => setChatAgentMode('ui')}
            className={cn(
              'text-[10px] px-2 py-1 rounded border',
              chat.agentMode === 'ui'
                ? 'border-accent/60 text-ink bg-accent/10'
                : 'border-white/10 text-ink-muted hover:text-ink',
            )}
            disabled={chat.isStreaming}
          >
            UI Agent
          </button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3 min-h-0">
        {chat.messages.length === 0 && !chat.isStreaming && (
          <WelcomePrompts project={activeProject} onSelect={setInput} />
        )}

        {chat.messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Spec approval banner — shown whenever spec exists and project is still in design phase.
            Uses phase from the project (persistent across refresh) OR the ephemeral SSE flag. */}
        {!chat.isStreaming && (chat.specNeedsApproval || (activeProject?.phase === 'design' && !!activeProject?.spec?.trim())) && (
          <div className="mb-4 rounded-2xl border-2 border-accent/40 bg-accent/5 px-4 py-4">
            <p className="text-sm font-semibold text-ink mb-1">Spec ready for review</p>
            <p className="text-[12px] text-ink-muted mb-3">
              Review the spec in the Spec panel. Accept to start implementing, or continue editing.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAcceptSpec}
                disabled={acceptingSpec}
                className="gap-1.5"
              >
                {acceptingSpec ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Accept & Start Coding
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleEditSpec}
                className="gap-1.5"
              >
                <PencilLine size={12} />
                Keep Editing
              </Button>
            </div>
          </div>
        )}

        {/* Streaming response */}
        {chat.isStreaming && (
          <div className="mb-3">
            {chat.streamingToolUses.length > 0 && (
              <ToolUsesBlock tools={chat.streamingToolUses} />
            )}
            {chat.streamingText && (
              <div className="rounded-2xl bg-bg-surface border-2 border-[rgba(245,234,216,0.08)] px-4 py-3">
                <div className="prose-dark text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {chat.streamingText}
                  </ReactMarkdown>
                </div>
                <span className="cursor-blink" />
              </div>
            )}
            {!chat.streamingText && chat.streamingToolUses.length === 0 && (
              <div className="flex items-center gap-2 text-ink-muted text-sm">
                <Loader2 size={13} className="animate-spin" />
                <span>Thinking…</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {chat.error && (
          <div className="mb-3 px-4 py-3 rounded-2xl bg-status-error/10 border-2 border-status-error/30 text-status-error text-sm font-semibold">
            {chat.error}
          </div>
        )}

        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t-2 border-[rgba(245,234,216,0.08)] shrink-0">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={chat.agentMode === 'ui'
              ? 'Describe the frontend UI you want (screens, components, styling)...'
              : 'Describe the smart contract you want to build…'}
            className="pr-12 min-h-[72px] max-h-48"
            disabled={chat.isStreaming}
          />
          <div className="absolute bottom-2.5 right-2.5">
            {chat.isStreaming ? (
              <Button variant="danger" size="icon" onClick={handleStop}>
                <Square size={13} />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={!input.trim()}
              >
                <Send size={13} />
              </Button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-ink-muted mt-1.5">
          <kbd className="bg-bg-elevated px-1.5 rounded-full text-[9px] font-bold border border-[rgba(245,234,216,0.12)]">Enter</kbd> to send &nbsp;·&nbsp;
          <kbd className="bg-bg-elevated px-1.5 rounded-full text-[9px] font-bold border border-[rgba(245,234,216,0.12)]">Shift+Enter</kbd> for newline
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const hasTextContent = !!String(message.content ?? '').trim()

  return (
    <div className={cn('mb-4', isUser ? 'flex justify-end' : '')}>
      {!isUser && message.toolUses && message.toolUses.length > 0 && (
        <ToolUsesBlock tools={message.toolUses} />
      )}
      {/* Skip empty content bubbles — happens when model only makes tool calls with no text */}
      {(isUser || hasTextContent) && (
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm max-w-[85%]',
            isUser
              ? 'bg-accent/15 border-2 border-accent/30 text-ink ml-auto shadow-hard-sm font-semibold'
              : 'bg-bg-surface border-2 border-[rgba(245,234,216,0.08)] text-ink',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content as string}</p>
          ) : (
            <div className="prose-dark">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  code({ className, children, ...props }: any) {
                    const lang = /language-(\w+)/.exec(className || '')?.[1]
                    if (lang === 'mermaid') {
                      return <MermaidBlock code={String(children).trim()} />
                    }
                    return <code className={className} {...props}>{children}</code>
                  },
                }}
              >
                {message.content as string}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolUsesBlock({ tools }: { tools: ToolUseEvent[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2 rounded-2xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-panel text-[11px] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-ink-muted hover:text-ink transition-colors"
      >
        <Wrench size={11} />
        <span>{tools.length} tool call{tools.length !== 1 ? 's' : ''}</span>
        {expanded ? <ChevronDown size={11} className="ml-auto" /> : <ChevronRight size={11} className="ml-auto" />}
      </button>
      {expanded && (
        <div className="border-t-2 border-[rgba(245,234,216,0.08)] divide-y divide-[rgba(245,234,216,0.05)]">
          {tools.map((t, i) => (
            <div key={i} className="px-3 py-2 flex items-center gap-2">
              <Terminal size={10} className="text-ink-muted shrink-0" />
              <span className="font-mono text-ink-muted">{t.name}</span>
              {t.status && (
                <Badge
                  variant={t.status === 'success' ? 'success' : t.status === 'error' ? 'error' : 'muted'}
                  className="ml-auto"
                >
                  {t.status}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WelcomePrompts({
  project,
  onSelect,
}: {
  project: { name: string }
  onSelect: (s: string) => void
}) {
  const prompts = [
    'Generate a token contract with mint, burn and transfer functions',
    'Build a simple escrow contract that releases funds on approval',
    'Create a voting contract with proposal creation and tallying',
    'Write a multi-sig wallet contract requiring 2-of-3 signatures',
  ]

  return (
    <div className="py-6 text-center">
      <h3 className="text-sm font-extrabold text-ink mb-1">{project.name}</h3>
      <p className="text-[12px] text-ink-muted mb-5">
        Describe a Soroban smart contract to get started
      </p>
      <div className="grid grid-cols-1 gap-2 text-left">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="px-4 py-3 rounded-2xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-surface text-[12px] font-semibold text-ink-muted hover:text-ink hover:border-accent/40 hover:bg-accent/5 text-left transition-colors duration-100 shadow-hard-sm"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
