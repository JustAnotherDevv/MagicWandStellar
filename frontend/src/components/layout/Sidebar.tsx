import { useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Plus, FolderOpen, Search, X, Loader2 } from 'lucide-react'
import type { Project } from '@/types'

export function Sidebar() {
  const projects = useStore((s) => s.projects)
  const setProjects = useStore((s) => s.setProjects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const wallet = useStore((s) => s.wallet)

  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  )

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError('')
    try {
      const project = await api.createProject({
        userId: wallet.publicKey!,
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        network: wallet.network as 'testnet' | 'mainnet',
      })
      setProjects([project, ...projects])
      setActiveProject(project.id)
      setShowNew(false)
      setNewName('')
      setNewDesc('')
    } catch (e: any) {
      setError(e.message ?? 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  return (
    <aside className="w-56 flex flex-col bg-bg-panel border-r-2 border-[rgba(245,234,216,0.10)] shrink-0">
      {/* Header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-extrabold text-ink-muted uppercase tracking-widest">
            Projects
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            onClick={() => setShowNew(true)}
            title="New project"
          >
            <Plus size={12} />
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="pl-7 h-8 text-[11px] rounded-2xl"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      <Separator />

      {/* Project list */}
      <ScrollArea className="flex-1 py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-ink-muted">
            {search ? 'No matches' : 'No projects yet'}
          </div>
        ) : (
          filtered.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              active={project.id === activeProjectId}
              onClick={() => setActiveProject(project.id)}
            />
          ))
        )}
      </ScrollArea>

      {/* New project dialog */}
      <Dialog open={showNew} onClose={() => setShowNew(false)}>
        <DialogContent
          title="New Project"
          onClose={() => setShowNew(false)}
          className="min-w-[360px] max-w-md"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-[11px] text-ink-muted mb-1">Project name</label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My Soroban Contract"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink-muted mb-1">Description (optional)</label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What will this contract do?"
              />
            </div>
            {error && <p className="text-[11px] text-status-error">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating && <Loader2 size={12} className="animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function ProjectItem({
  project,
  active,
  onClick,
}: {
  project: Project
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors duration-100 group
        ${active
          ? 'bg-accent/10 text-ink'
          : 'text-ink-muted hover:bg-bg-hover hover:text-ink'
        }
      `}
    >
      <FolderOpen
        size={13}
        className={`mt-0.5 shrink-0 ${active ? 'text-accent' : 'text-ink-muted group-hover:text-ink-muted'}`}
      />
      <div className="min-w-0">
        <p className="text-[12px] font-medium truncate">{project.name}</p>
        <p className="text-[10px] text-ink-muted truncate mt-0.5">
          {timeAgo(project.updatedAt ?? Date.now())}
        </p>
      </div>
      {active && (
        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-1.5 shadow-[0_0_6px_rgba(232,48,48,0.8)]" />
      )}
    </button>
  )
}
