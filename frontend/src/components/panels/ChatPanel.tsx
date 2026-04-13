import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '@/store'
import { streamChat } from '@/lib/sse'
import { api } from '@/lib/api'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Send, Square, Loader2, ChevronDown, ChevronRight, Terminal, Wrench } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage, ToolUseEvent } from '@/types'
import { MermaidBlock } from '@/components/MermaidBlock'

export function ChatPanel() {
  const wallet = useStore((s) => s.wallet)
  const activeProject = useStore((s) => s.activeProject())
  const projects = useStore((s) => s.projects)
  const chat = useStore((s) => s.chat)
  const sessions = useStore((s) => s.sessions)
  const setSessions = useStore((s) => s.setSessions)
  const setProjects = useStore((s) => s.setProjects)
  const setSpecDraft = useStore((s) => s.setSpecDraft)
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
  } = useStore((s) => s)
  const appendLog = useStore((s) => s.appendLog)

  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages, chat.streamingText])

  // Reset chat when project changes (already done in store but guard here too)
  useEffect(() => {
    // nothing needed — store handles it
  }, [activeProject?.id])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || chat.isStreaming || !activeProject) return
    setInput('')

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
          sessionId: chat.sessionId ?? undefined,
          message: text,
          network: wallet.network as 'testnet' | 'mainnet',
        },
        ac.signal,
      )

      for await (const event of stream) {
        if (event.type === 'session_created') {
          setSessionId(event.sessionId)
          appendLog(`[session] created ${event.sessionId}`)
          // Refresh sessions list
          api.getSessions(wallet.publicKey!, activeProject.id)
            .then((s) => setSessions(s))
            .catch(() => {})
        } else if (event.type === 'text_delta') {
          currentText += event.text
          updateStreamingText(currentText)
        } else if (event.type === 'tool_use') {
          const toolEvent = {
            id: event.toolUseId,
            name: event.toolName,
            input: event.input,
            status: 'running' as const,
          }
          currentTools = [...currentTools, toolEvent]
          updateStreamingToolUses(currentTools)
          appendLog(`[tool] ${event.toolName} — running`)
        } else if (event.type === 'tool_result') {
          // Update the matching pending tool's status
          currentTools = currentTools.map((t) =>
            t.id === event.toolUseId
              ? { ...t, status: (event.isError ? 'error' : 'success') as 'success' | 'error', result: event.result }
              : t
          )
          updateStreamingToolUses(currentTools)
          appendLog(`[tool_result] ${event.toolUseId.slice(0, 8)} — ${event.isError ? 'error' : 'ok'}`)
        } else if (event.type === 'spec_updated') {
          // Update spec in the active project so SpecPanel refreshes live
          if (activeProject) {
            setProjects(projects.map((p) =>
              p.id === activeProject.id ? { ...p, spec: event.spec } : p
            ))
            setSpecDraft(event.spec)
          }
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
  }, [input, chat.isStreaming, chat.sessionId, activeProject, wallet])

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
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-ink-muted">
          {chat.sessionId ? (
            <>Session: <span className="font-mono text-ink-muted/70">{chat.sessionId.slice(0, 12)}…</span></>
          ) : 'New session'}
        </span>
        {chat.sessionId && (
          <button
            onClick={resetChat}
            className="text-[10px] text-ink-muted hover:text-ink ml-auto"
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3 min-h-0">
        {chat.messages.length === 0 && !chat.isStreaming && (
          <WelcomePrompts project={activeProject} onSelect={setInput} />
        )}

        {chat.messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Streaming response */}
        {chat.isStreaming && (
          <div className="mb-3">
            {chat.streamingToolUses.length > 0 && (
              <ToolUsesBlock tools={chat.streamingToolUses} />
            )}
            {chat.streamingText && (
              <div className="rounded bg-bg-surface border border-white/[0.06] px-4 py-3">
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
          <div className="mb-3 px-4 py-3 rounded bg-status-error/10 border border-status-error/20 text-status-error text-sm">
            {chat.error}
          </div>
        )}

        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t border-white/[0.06] shrink-0">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the smart contract you want to build…"
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
          <kbd className="bg-bg-elevated px-1 rounded text-[9px]">Enter</kbd> to send &nbsp;·&nbsp;
          <kbd className="bg-bg-elevated px-1 rounded text-[9px]">Shift+Enter</kbd> for newline
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('mb-4', isUser ? 'flex justify-end' : '')}>
      {!isUser && message.toolUses && message.toolUses.length > 0 && (
        <ToolUsesBlock tools={message.toolUses} />
      )}
      <div
        className={cn(
          'rounded px-4 py-3 text-sm max-w-[85%]',
          isUser
            ? 'bg-accent/10 border border-accent/20 text-ink ml-auto'
            : 'bg-bg-surface border border-white/[0.06] text-ink',
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
    </div>
  )
}

function ToolUsesBlock({ tools }: { tools: ToolUseEvent[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2 rounded border border-white/[0.06] bg-bg-panel text-[11px]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-ink-muted hover:text-ink transition-colors"
      >
        <Wrench size={11} />
        <span>{tools.length} tool call{tools.length !== 1 ? 's' : ''}</span>
        {expanded ? <ChevronDown size={11} className="ml-auto" /> : <ChevronRight size={11} className="ml-auto" />}
      </button>
      {expanded && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
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
      <h3 className="text-sm font-medium text-ink mb-1">{project.name}</h3>
      <p className="text-[12px] text-ink-muted mb-5">
        Describe a Soroban smart contract to get started
      </p>
      <div className="grid grid-cols-1 gap-2 text-left">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="px-3 py-2.5 rounded border border-white/[0.06] bg-bg-surface text-[12px] text-ink-muted hover:text-ink hover:border-accent/30 hover:bg-accent/5 text-left transition-colors duration-100"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
