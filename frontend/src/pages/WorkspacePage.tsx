import { useEffect, useMemo, useState } from 'react'
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
import { AppPanel } from '@/components/panels/AppPanel'
import { LandingPage } from '@/components/LandingPage'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MessageSquare, FileText, Code2, FlaskConical, Terminal, Package, LayoutDashboard, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { Project } from '@/types'

const TABS: { id: PanelView; label: string; Icon: React.ElementType }[] = [
  { id: 'chat',     label: 'Chat',     Icon: MessageSquare },
  { id: 'spec',     label: 'Spec',     Icon: FileText      },
  { id: 'code',     label: 'Code',     Icon: Code2         },
  { id: 'tests',    label: 'Tests',    Icon: FlaskConical  },
  { id: 'logs',     label: 'Logs',     Icon: Terminal      },
  { id: 'contracts', label: 'Contracts', Icon: Package      },
  { id: 'app', label: 'App', Icon: LayoutDashboard },
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
  const panelView = useStore((s) => s.panelView)
  const setPanelView = useStore((s) => s.setPanelView)
  const shellView = useStore((s) => s.shellView)
  const setShellView = useStore((s) => s.setShellView)

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
    if (!sessions.length || useStore.getState().chat.messages.length > 0) return
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
      <LandingPage />

      {shellView === 'apps' ? (
        <AppsStoreView onOpenBuild={(projectId) => {
          useStore.getState().setActiveProject(projectId)
          setShellView('build')
        }} />
      ) : (
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
                    {/* All panels are always mounted — toggled via CSS visibility so
                        Monaco stays initialised and tab switches cause zero layout reflow. */}
                    <div className="relative flex-1 min-h-0 overflow-hidden">
                      <div className={cn('absolute inset-0', panelView !== 'spec' && panelView !== 'chat' && 'invisible pointer-events-none')}>
                        <SpecPanel />
                      </div>
                      <div className={cn('absolute inset-0', panelView !== 'code' && 'invisible pointer-events-none')}>
                        <CodePanel />
                      </div>
                      <div className={cn('absolute inset-0', panelView !== 'tests' && 'invisible pointer-events-none')}>
                        <TestsPanel />
                      </div>
                      <div className={cn('absolute inset-0', panelView !== 'logs' && 'invisible pointer-events-none')}>
                        <LogsPanel />
                      </div>
                      <div className={cn('absolute inset-0', panelView !== 'contracts' && 'invisible pointer-events-none')}>
                        <ContractPanel />
                      </div>
                      <div className={cn('absolute inset-0', panelView !== 'app' && 'invisible pointer-events-none')}>
                        <AppPanel />
                      </div>
                    </div>
                  </div>
                </Panel>
              </PanelGroup>
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AppsStoreView({ onOpenBuild }: { onOpenBuild: (projectId: string) => void }) {
  const projects = useStore((s) => s.projects)
  const setProjects = useStore((s) => s.setProjects)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'name'>('newest')
  const [category, setCategory] = useState<'all' | string>('all')
  const [heroIndex, setHeroIndex] = useState(0)
  const [selectedApp, setSelectedApp] = useState<Project | null>(null)
  const [runtimeApp, setRuntimeApp] = useState<Project | null>(null)
  const [runtimeFallbackUrl, setRuntimeFallbackUrl] = useState<string | null>(null)
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false)

  const published = useMemo(
    () =>
      projects
        .filter((p) => !!p.appPublishedAt)
        .sort((a, b) => (b.appPublishedAt ?? 0) - (a.appPublishedAt ?? 0)),
    [projects],
  )

  const categories = useMemo(() => {
    const values = new Set<string>()
    for (const app of published) {
      for (const t of (app.appTags ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
        values.add(t.toLowerCase())
      }
    }
    return ['all', ...Array.from(values).sort()]
  }, [published])

  const featured = useMemo(() => published.slice(0, 5), [published])

  useEffect(() => {
    if (featured.length <= 1) return
    const timer = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % featured.length)
    }, 4200)
    return () => window.clearInterval(timer)
  }, [featured.length])

  const filtered = useMemo(() => {
    let items = [...published]
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((a) =>
        [a.appName, a.name, a.appDescription, a.appTags]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    }
    if (category !== 'all') {
      items = items.filter((a) =>
        (a.appTags ?? '')
          .split(',')
          .map((v) => v.trim().toLowerCase())
          .includes(category),
      )
    }
    if (sort === 'name') items.sort((a, b) => (a.appName || a.name).localeCompare(b.appName || b.name))
    else items.sort((a, b) => (b.appPublishedAt ?? 0) - (a.appPublishedAt ?? 0))
    return items
  }, [published, search, category, sort])

  const react = async (appId: string, type: 'like' | 'dislike') => {
    const updated = await api.reactToApp(appId, type).catch(() => null)
    if (!updated) return
    setProjects(projects.map((p) => (p.id === updated.id ? updated : p)))
    if (selectedApp?.id === updated.id) setSelectedApp(updated)
    if (runtimeApp?.id === updated.id) setRuntimeApp(updated)
  }

  useEffect(() => {
    let active = true
    if (!runtimeApp) {
      setRuntimeFallbackUrl(null)
      setRuntimeUnavailable(false)
      return
    }
    if (runtimeApp.appRuntimeUrl?.trim()) {
      setRuntimeFallbackUrl(null)
      setRuntimeUnavailable(false)
      return
    }
    api.getRuntimeInfo(runtimeApp.id)
      .then((info) => {
        if (!active) return
        if (info.available && info.url) {
          setRuntimeFallbackUrl(info.url)
          setRuntimeUnavailable(false)
        } else {
          setRuntimeFallbackUrl(null)
          setRuntimeUnavailable(true)
        }
      })
      .catch(() => {
        if (!active) return
        setRuntimeFallbackUrl(null)
        setRuntimeUnavailable(true)
      })
    return () => { active = false }
  }, [runtimeApp?.id, runtimeApp?.appRuntimeUrl])

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,#2f2135_0%,#141019_44%,#0d0a13_100%)]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="rounded-3xl border border-white/15 bg-white/[0.03] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.45)] mb-6">
          <h2 className="text-2xl font-black text-ink">MagicWand App Store</h2>
          <p className="text-sm text-ink-muted mt-1">Published apps with handcrafted polish and modular UI composition.</p>
        </div>

        {featured.length > 0 && (
          <div className="mb-6 rounded-3xl border border-white/15 bg-gradient-to-r from-[#3b2538] to-[#251e33] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <p className="text-[11px] uppercase tracking-widest text-ink-muted mb-2">Featured</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setHeroIndex((i) => (i - 1 + featured.length) % featured.length)}
                className="w-8 h-8 rounded-full border border-white/20 text-ink-muted hover:text-ink"
                aria-label="Previous featured app"
              >
                <ChevronLeft size={14} className="mx-auto" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xl font-bold text-ink truncate">{featured[heroIndex]?.appName || featured[heroIndex]?.name}</p>
                <p className="text-sm text-ink-muted mt-1 line-clamp-2">{featured[heroIndex]?.appDescription || 'No description provided.'}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onOpenBuild(featured[heroIndex].id)}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold text-[#25170f] bg-gradient-to-b from-[#ffcf93] to-[#dd9e56] shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
                  >
                    Open Build
                  </button>
                  <button
                    onClick={() => setSelectedApp(featured[heroIndex])}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold border border-white/20 text-ink"
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setRuntimeApp(featured[heroIndex])}
                    className="rounded-xl px-3 py-1.5 text-[12px] font-semibold border border-accent/40 text-ink"
                  >
                    Open App
                  </button>
                </div>
              </div>
              <button
                onClick={() => setHeroIndex((i) => (i + 1) % featured.length)}
                className="w-8 h-8 rounded-full border border-white/20 text-ink-muted hover:text-ink"
                aria-label="Next featured app"
              >
                <ChevronRight size={14} className="mx-auto" />
              </button>
            </div>
          </div>
        )}

        <div className="mb-5 rounded-2xl border border-white/10 bg-bg-panel/80 p-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps, tags, descriptions..."
              className="md:max-w-sm"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'newest' | 'name')}
              className="h-10 rounded-2xl border border-white/10 bg-bg-surface px-3 text-sm text-ink"
            >
              <option value="newest">Sort: Newest</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((chip) => {
              const active = chip === category
              return (
                <button
                  key={chip}
                  onClick={() => setCategory(chip)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-[11px] border transition-colors',
                    active
                      ? 'bg-accent/20 border-accent/45 text-ink'
                      : 'bg-white/5 border-white/10 text-ink-muted hover:text-ink',
                  )}
                >
                  {chip === 'all' ? 'All' : chip}
                </button>
              )
            })}
          </div>
        </div>

        {published.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-bg-panel p-6 text-sm text-ink-muted">
            No published apps yet. Open a project, go to the `App` tab, and hit `Publish`.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((app) => (
              <div
                key={app.id}
                onClick={() => setRuntimeApp(app)}
                className="rounded-3xl border border-white/15 bg-gradient-to-b from-[#2b2033]/90 to-[#16121d]/95 p-4 shadow-[0_14px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.09)] cursor-pointer"
              >
                {app.appBannerUrl && (
                  <img
                    src={app.appBannerUrl}
                    alt={`${app.appName || app.name} banner`}
                    className="w-full h-28 rounded-2xl object-cover border border-white/15 mb-3"
                  />
                )}
                <div className="flex items-center gap-3 mb-3">
                  {app.appLogoUrl ? (
                    <img src={app.appLogoUrl} alt={app.appName || app.name} className="w-10 h-10 rounded-xl object-cover border border-white/20" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/35" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink truncate">{app.appName || app.name}</p>
                    <p className="text-[11px] text-ink-muted truncate">{app.name}</p>
                  </div>
                </div>
                <p className="text-[12px] text-ink-muted min-h-[40px]">{app.appDescription || 'No description provided.'}</p>
                {app.appTags?.trim() && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {app.appTags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5).map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-1 rounded-full bg-white/10 text-ink-muted border border-white/10">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenBuild(app.id) }}
                  className="mt-4 w-full rounded-xl py-2 text-[12px] font-semibold text-[#25170f] bg-gradient-to-b from-[#ffcf93] to-[#dd9e56] shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
                >
                  Open Build
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedApp(app) }}
                  className="mt-2 w-full rounded-xl py-2 text-[12px] font-semibold border border-white/15 text-ink"
                >
                  View Details
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setRuntimeApp(app) }}
                  className="mt-2 w-full rounded-xl py-2 text-[12px] font-semibold border border-accent/35 text-ink"
                >
                  Open App
                </button>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted">
                  <span className="inline-flex items-center gap-1"><ThumbsUp size={12} />{app.appLikeCount ?? 0}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsDown size={12} />{app.appDislikeCount ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selectedApp} onClose={() => setSelectedApp(null)}>
        <DialogContent title={selectedApp?.appName || selectedApp?.name || 'App Details'} onClose={() => setSelectedApp(null)} className="max-w-xl">
          {selectedApp && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {selectedApp.appLogoUrl ? (
                  <img src={selectedApp.appLogoUrl} alt={selectedApp.appName || selectedApp.name} className="w-14 h-14 rounded-2xl object-cover border border-white/20" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-accent/20 border border-accent/35" />
                )}
                <div>
                  <p className="text-sm text-ink-muted">{selectedApp.name}</p>
                  <p className="text-[12px] text-ink-muted">
                    Published {selectedApp.appPublishedAt ? new Date(selectedApp.appPublishedAt).toLocaleDateString() : 'Unknown'}
                  </p>
                </div>
              </div>
              <p className="text-sm text-ink">{selectedApp.appDescription || 'No description provided.'}</p>
              {selectedApp.appBannerUrl && (
                <img
                  src={selectedApp.appBannerUrl}
                  alt={`${selectedApp.appName || selectedApp.name} banner`}
                  className="w-full h-40 rounded-2xl object-cover border border-white/15"
                />
              )}
              {selectedApp.appTags?.trim() && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedApp.appTags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                    <span key={tag} className="text-[11px] px-2 py-1 rounded-full bg-white/10 text-ink-muted border border-white/10">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => onOpenBuild(selectedApp.id)}
                className="w-full rounded-xl py-2 text-[12px] font-semibold text-[#25170f] bg-gradient-to-b from-[#ffcf93] to-[#dd9e56] shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]"
              >
                Open Build
              </button>
              <button
                onClick={() => setRuntimeApp(selectedApp)}
                className="w-full rounded-xl py-2 text-[12px] font-semibold border border-accent/35 text-ink"
              >
                Open App
              </button>
              <div className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2">
                <button onClick={() => react(selectedApp.id, 'like')} className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
                  <ThumbsUp size={13} /> {selectedApp.appLikeCount ?? 0}
                </button>
                <button onClick={() => react(selectedApp.id, 'dislike')} className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
                  <ThumbsDown size={13} /> {selectedApp.appDislikeCount ?? 0}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!runtimeApp} onClose={() => setRuntimeApp(null)}>
        <DialogContent title={runtimeApp?.appName || runtimeApp?.name || 'App Runtime'} onClose={() => setRuntimeApp(null)} className="max-w-6xl min-h-[72vh]">
          {runtimeApp && (
            <div className="flex gap-3 min-h-[62vh]">
              <div className="flex-1 rounded-2xl border border-white/10 bg-bg-elevated overflow-hidden">
                {(runtimeApp.appRuntimeUrl || runtimeFallbackUrl) ? (
                  <iframe
                    src={runtimeApp.appRuntimeUrl || runtimeFallbackUrl || undefined}
                    title={runtimeApp.appName || runtimeApp.name}
                    className="w-full h-full min-h-[62vh]"
                    sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin allow-downloads"
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-ink-muted p-6 text-center">
                    {runtimeUnavailable
                      ? 'No local runtime was found for this app yet. Generate/build a UI (index.html) in the project workspace or add a Runtime URL in the App tab.'
                      : 'Loading local app runtime...'}
                  </div>
                )}
              </div>
              <aside className="w-48 shrink-0 rounded-2xl border border-white/10 bg-bg-elevated p-3 space-y-3">
                <p className="text-[11px] uppercase tracking-widest text-ink-muted">Reactions</p>
                <button onClick={() => react(runtimeApp.id, 'like')} className="w-full inline-flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm text-ink-muted hover:text-ink">
                  <span className="inline-flex items-center gap-2"><ThumbsUp size={14} /> Like</span>
                  <span>{runtimeApp.appLikeCount ?? 0}</span>
                </button>
                <button onClick={() => react(runtimeApp.id, 'dislike')} className="w-full inline-flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm text-ink-muted hover:text-ink">
                  <span className="inline-flex items-center gap-2"><ThumbsDown size={14} /> Dislike</span>
                  <span>{runtimeApp.appDislikeCount ?? 0}</span>
                </button>
                <button
                  onClick={() => onOpenBuild(runtimeApp.id)}
                  className="w-full rounded-xl py-2 text-[12px] font-semibold text-[#25170f] bg-gradient-to-b from-[#ffcf93] to-[#dd9e56]"
                >
                  Open Build
                </button>
              </aside>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
