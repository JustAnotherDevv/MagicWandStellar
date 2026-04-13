import { useEffect } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { useStore, type PanelView } from '@/store'
import { api } from '@/lib/api'
import { TopBar } from '@/components/layout/TopBar'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatPanel } from '@/components/panels/ChatPanel'
import { SpecPanel } from '@/components/panels/SpecPanel'
import { CodePanel } from '@/components/panels/CodePanel'
import { TestsPanel } from '@/components/panels/TestsPanel'
import { LogsPanel } from '@/components/panels/LogsPanel'
import { ContractPanel } from '@/components/panels/ContractPanel'
import { cn } from '@/lib/utils'
import { MessageSquare, FileText, Code2, FlaskConical, Terminal, Package } from 'lucide-react'

const TABS: { id: PanelView; label: string; Icon: React.ElementType }[] = [
  { id: 'chat',     label: 'Chat',     Icon: MessageSquare },
  { id: 'spec',     label: 'Spec',     Icon: FileText      },
  { id: 'code',     label: 'Code',     Icon: Code2         },
  { id: 'tests',    label: 'Tests',    Icon: FlaskConical  },
  { id: 'logs',     label: 'Logs',     Icon: Terminal      },
]

export function WorkspacePage() {
  const wallet = useStore((s) => s.wallet)
  const setProjects = useStore((s) => s.setProjects)
  const setSessions = useStore((s) => s.setSessions)
  const sessions = useStore((s) => s.sessions)
  const activeProject = useStore((s) => s.activeProject())
  const projects = useStore((s) => s.projects)
  const activeSessionId = useStore((s) => s.activeSessionId)
  const setSessionId = useStore((s) => s.setSessionId)
  const setMessages = useStore((s) => s.setMessages)
  const setSpecDraft = useStore((s) => s.setSpecDraft)
  const appendLog = useStore((s) => s.appendLog)
  const chatMessages = useStore((s) => s.chat.messages)
  const panelView = useStore((s) => s.panelView)
  const setPanelView = useStore((s) => s.setPanelView)
  const chat = useStore((s) => s.chat)

  // Load projects on mount
  useEffect(() => {
    if (!wallet.publicKey) return
    api.getProjects(wallet.publicKey)
      .then(setProjects)
      .catch(() => {})
  }, [wallet.publicKey])

  // Load sessions when active project changes
  useEffect(() => {
    if (!wallet.publicKey || !activeProject) return
    api.getSessions(wallet.publicKey, activeProject.id)
      .then(setSessions)
      .catch(() => {})
  }, [wallet.publicKey, activeProject?.id])

  // Restore chat history when sessions load (page refresh recovery)
  useEffect(() => {
    if (!sessions.length || chatMessages.length > 0) return
    // Prefer the last known session, otherwise pick the most recent one
    const sorted = [...sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const target = sorted.find((s) => s.id === activeSessionId) ?? sorted[0]
    if (!target) return
    api.getMessages(target.id)
      .then(({ messages, projectSpec }) => {
        if (messages.length === 0) return
        setSessionId(target.id)
        setMessages(messages)

        // Determine the spec to show. Priority:
        // 1. Backend already has a real spec saved → use it
        // 2. Backend backfilled from a Python-style call → use that
        // 3. Spec is still empty → scan assistant messages for plan/diagram content
        //    and use the first assistant message containing a mermaid block as the spec.
        const currentSpec = activeProject?.spec?.trim() ?? ''
        let resolvedSpec = projectSpec && projectSpec.trim() ? projectSpec : (currentSpec || undefined)

        if (!resolvedSpec) {
          // Auto-extract: find the first assistant message that contains a mermaid diagram.
          // The agent's DIAGRAM response is the spec content.
          const specMsg = messages.find(
            (m) => m.role === 'assistant' && m.content.includes('```mermaid')
          )
          if (specMsg) {
            // Strip the Python-style print(...) call if present, keeping the markdown above it
            const printIdx = specMsg.content.indexOf('print(default_api.')
            resolvedSpec = (printIdx !== -1
              ? specMsg.content.slice(0, printIdx).trim()
              : specMsg.content.trim()
            )
          }
        }

        if (resolvedSpec && activeProject && resolvedSpec !== currentSpec) {
          setProjects(projects.map((p) =>
            p.id === activeProject.id ? { ...p, spec: resolvedSpec! } : p
          ))
          setSpecDraft(resolvedSpec)
          // Persist to backend so it survives future loads
          api.updateProject(activeProject.id, { spec: resolvedSpec }).catch(() => {})
        }

        // Load persisted logs from DB; fall back to synthesis from toolUses if endpoint fails
        api.getLogs(target.id)
          .then((lines) => { for (const line of lines) appendLog(line) })
          .catch(() => {
            appendLog(`[session] restored ${target.id}`)
            for (const msg of messages) {
              if (msg.toolUses?.length) {
                for (const t of msg.toolUses) {
                  appendLog(`[tool] ${t.name} — ${t.status}`)
                  if (t.result !== undefined)
                    appendLog(`[tool_result] ${t.id.slice(0, 8)} — ${t.status === 'error' ? 'error' : 'ok'}`)
                }
              }
            }
          })
      })
      .catch(() => {})
  }, [sessions])

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <TopBar />

      <div className="flex flex-1 min-h-0">
        <Sidebar />

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeProject ? (
            <PanelGroup direction="horizontal" className="flex-1">
              {/* Left: Chat always visible */}
              <Panel defaultSize={35} minSize={25} maxSize={55}>
                <div className="h-full flex flex-col border-r border-white/[0.06]">
                  <PanelTabBar
                    tabs={[TABS[0]]}
                    active={panelView === 'chat' ? 'chat' : 'chat'}
                    onChange={setPanelView}
                    showSingle
                  />
                  <div className="flex-1 min-h-0">
                    <ChatPanel />
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="panel-resize-handle" />

              {/* Right: switching panel */}
              <Panel defaultSize={65} minSize={40}>
                <div className="h-full flex flex-col">
                  <PanelTabBar
                    tabs={TABS.slice(1)}
                    active={panelView}
                    onChange={setPanelView}
                  />
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {panelView === 'spec'     && <SpecPanel />}
                    {panelView === 'code'     && <CodePanel />}
                    {panelView === 'tests'    && <TestsPanel />}
                    {panelView === 'logs'     && <LogsPanel />}
                    {/* Default to spec when chat tab somehow selected here */}
                    {panelView === 'chat'     && <SpecPanel />}
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  )
}

function PanelTabBar({
  tabs,
  active,
  onChange,
  showSingle = false,
}: {
  tabs: typeof TABS
  active: PanelView
  onChange: (v: PanelView) => void
  showSingle?: boolean
}) {
  if (showSingle && tabs.length === 1) {
    const tab = tabs[0]
    return (
      <div className="flex items-center px-4 h-9 border-b border-white/[0.06] bg-bg-panel shrink-0">
        <tab.Icon size={13} className="text-accent mr-2" />
        <span className="text-[12px] font-medium text-ink">{tab.label}</span>
        {/* Show streaming dot */}
      </div>
    )
  }

  return (
    <div className="flex items-center border-b border-white/[0.06] bg-bg-panel shrink-0 px-2">
      {tabs.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium',
              'border-b-2 -mb-px transition-colors duration-100',
              isActive
                ? 'text-ink border-accent'
                : 'text-ink-muted border-transparent hover:text-ink hover:border-white/20',
            )}
          >
            <tab.Icon size={12} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-accent/5 border border-accent/15 flex items-center justify-center mx-auto mb-4">
          <Code2 size={28} className="text-accent/60" />
        </div>
        <h3 className="text-sm font-medium text-ink mb-2">No project selected</h3>
        <p className="text-[12px] text-ink-muted leading-relaxed">
          Create a new project from the sidebar or select an existing one to start building Soroban smart contracts.
        </p>
      </div>
    </div>
  )
}
