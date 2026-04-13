import { useEffect, useState, useRef } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, FileCode, ChevronRight, FolderOpen, RefreshCw } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@/types'

interface RevealState {
  path: string
  content: string
  revealedLines: number
  totalLines: number
}

export function CodePanel() {
  const activeProject = useStore((s) => s.activeProject())
  const activeFile = useStore((s) => s.activeFile)
  const setActiveFile = useStore((s) => s.setActiveFile)
  const fileContents = useStore((s) => s.fileContents)
  const setFileContent = useStore((s) => s.setFileContent)
  const files = useStore((s) => s.files)
  const setFiles = useStore((s) => s.setFiles)
  const newlyWrittenFile = useStore((s) => s.newlyWrittenFile)
  const clearNewlyWrittenFile = useStore((s) => s.clearNewlyWrittenFile)
  const isStreaming = useStore((s) => s.chat.isStreaming)

  const [revealState, setRevealState] = useState<RevealState | null>(null)
  const revealScrollRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // loadFiles reads projectId from the store directly (avoids stale closure issues).
  const loadFiles = async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    setLoading(true)
    setError('')
    try {
      const result = await api.getFiles(projectId)
      setFiles(result)
      // Auto-select first file if nothing is selected
      const currentActiveFile = useStore.getState().activeFile
      if (!currentActiveFile && result.length > 0) {
        const first = findFirstFile(result)
        if (first) {
          setActiveFile(first.path)
          loadFileContent(projectId, first.path)
        }
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  const loadFileContent = async (projectId: string, path: string) => {
    if (fileContents[path] !== undefined) return
    try {
      const content = await api.getFile(projectId, path)
      setFileContent(path, content)
    } catch {
      setFileContent(path, '// Could not load file')
    }
  }

  const handleFileSelect = (path: string) => {
    setActiveFile(path)
    if (activeProject) loadFileContent(activeProject.id, path)
  }

  const handleSave = async () => {
    if (!activeFile || !activeProject || fileContents[activeFile] === undefined) return
    setSaving(true)
    try {
      await api.saveFile(activeProject.id, activeFile, fileContents[activeFile])
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    setFiles([])
    setActiveFile(null)
    loadFiles()
  }, [activeProject?.id])

  // While the agent is streaming, poll for new files every 1.5s so they appear
  // in the sidebar without requiring a manual refresh click.
  useEffect(() => {
    if (!isStreaming) return
    const id = setInterval(loadFiles, 1500)
    return () => clearInterval(id)
  }, [isStreaming])

  // Start line-by-line reveal animation when a new file is written by the agent
  useEffect(() => {
    if (!newlyWrittenFile) return
    const lines = newlyWrittenFile.content.split('\n')
    setRevealState({
      path: newlyWrittenFile.path,
      content: newlyWrittenFile.content,
      revealedLines: 0,
      totalLines: lines.length,
    })
    clearNewlyWrittenFile()
  }, [newlyWrittenFile?.path])

  // Drive the reveal animation at ~60fps, revealing ~1/25 of the file per frame
  useEffect(() => {
    if (!revealState || revealState.revealedLines >= revealState.totalLines) return
    const batchSize = Math.max(2, Math.ceil(revealState.totalLines / 25))
    const id = requestAnimationFrame(() => {
      setRevealState((s) =>
        s ? { ...s, revealedLines: Math.min(s.totalLines, s.revealedLines + batchSize) } : null,
      )
    })
    return () => cancelAnimationFrame(id)
  }, [revealState?.revealedLines, revealState?.totalLines])

  // Auto-scroll the reveal pre to the bottom as lines appear
  useEffect(() => {
    if (revealScrollRef.current) {
      revealScrollRef.current.scrollTop = revealScrollRef.current.scrollHeight
    }
  }, [revealState?.revealedLines])

  // Clear reveal state once animation completes so Monaco editor takes over
  useEffect(() => {
    if (!revealState || revealState.revealedLines < revealState.totalLines) return
    const id = setTimeout(() => setRevealState(null), 400)
    return () => clearTimeout(id)
  }, [revealState?.revealedLines])

  const langForPath = (path: string) => {
    if (path.endsWith('.rs')) return 'rust'
    if (path.endsWith('.toml')) return 'toml'
    if (path.endsWith('.json')) return 'json'
    if (path.endsWith('.sh')) return 'shell'
    return 'plaintext'
  }

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        No project selected
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* File tree */}
      <div className="w-48 flex flex-col border-r border-white/[0.06] shrink-0 bg-bg-panel">
        <div className="px-3 py-2 border-b border-white/[0.04] flex items-center justify-between">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest">Files</span>
          <button onClick={loadFiles} className="text-ink-muted hover:text-ink" title="Refresh">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <ScrollArea className="flex-1">
          {loading && files.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-ink-muted">
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </div>
          ) : files.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-ink-muted">
              {error || 'No files yet. Ask the AI to generate code.'}
            </div>
          ) : (
            <FileTree
              nodes={files}
              activeFile={activeFile}
              onSelect={handleFileSelect}
            />
          )}
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeFile ? (
          <>
            {/* Tab bar */}
            <div className="flex items-center border-b border-white/[0.06] bg-bg-panel px-2 shrink-0">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-bg border-t border-l border-r border-white/[0.08] rounded-t text-[11px]">
                <FileCode size={11} className="text-accent" />
                <span className="text-ink font-mono">{activeFile.split('/').pop()}</span>
              </div>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="mr-1"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : null}
                Save
              </Button>
            </div>

            {/* Live reveal animation — shown while agent is writing this file */}
            {revealState && revealState.path === activeFile ? (
              <div
                ref={revealScrollRef}
                className="flex-1 overflow-auto bg-[#1e1e1e]"
                style={{ scrollBehavior: 'smooth' }}
              >
                <pre className="px-4 py-3 text-[13px] font-mono leading-5 text-[#d4d4d4] whitespace-pre m-0">
                  {revealState.content.split('\n').slice(0, revealState.revealedLines).join('\n')}
                  {revealState.revealedLines < revealState.totalLines && (
                    <span className="text-accent animate-pulse">▋</span>
                  )}
                </pre>
              </div>
            ) : (
              /* Monaco editor — shown once reveal completes or for files not currently being written */
              <div className="flex-1">
                <Editor
                  language={langForPath(activeFile)}
                  value={fileContents[activeFile] ?? ''}
                  onChange={(v) => {
                    if (v !== undefined && activeFile) setFileContent(activeFile, v)
                  }}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    renderLineHighlight: 'gutter',
                    padding: { top: 12, bottom: 12 },
                    tabSize: 4,
                    wordWrap: 'off',
                    automaticLayout: true,
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
            <div className="text-center">
              <FileCode size={36} className="text-ink-muted/20 mx-auto mb-3" />
              <p>Select a file to view or edit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FileTree({
  nodes,
  activeFile,
  onSelect,
  depth = 0,
}: {
  nodes: FileNode[]
  activeFile: string | null
  onSelect: (path: string) => void
  depth?: number
}) {
  return (
    <div>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          activeFile={activeFile}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </div>
  )
}

function FileTreeNode({
  node,
  activeFile,
  onSelect,
  depth,
}: {
  node: FileNode
  activeFile: string | null
  onSelect: (path: string) => void
  depth: number
}) {
  const [open, setOpen] = useState(true)
  const isActive = !node.isDirectory && node.path === activeFile

  return (
    <>
      <button
        onClick={() => node.isDirectory ? setOpen((v) => !v) : onSelect(node.path)}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        className={cn(
          'w-full flex items-center gap-1.5 py-1 pr-3 text-[11px] transition-colors duration-100',
          isActive
            ? 'bg-accent/10 text-ink'
            : 'text-ink-muted hover:text-ink hover:bg-bg-hover',
        )}
      >
        {node.isDirectory ? (
          <>
            {open ? <ChevronRight size={10} className="rotate-90 transition-transform" /> : <ChevronRight size={10} />}
            <FolderOpen size={11} className="text-status-info shrink-0" />
          </>
        ) : (
          <>
            <span className="w-2.5 shrink-0" />
            <FileCode size={11} className={cn('shrink-0', isActive ? 'text-accent' : 'text-ink-muted')} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.isDirectory && open && node.children && (
        <FileTree
          nodes={node.children}
          activeFile={activeFile}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </>
  )
}

function findFirstFile(nodes: FileNode[]): FileNode | null {
  for (const n of nodes) {
    if (!n.isDirectory) return n
    if (n.children) {
      const found = findFirstFile(n.children)
      if (found) return found
    }
  }
  return null
}
