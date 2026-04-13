import { useState, useEffect, useRef, useLayoutEffect, memo } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Edit3, Eye, Save, X, Loader2, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { MermaidBlock } from '@/components/MermaidBlock'

export const SpecPanel = memo(function SpecPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const projects = useStore((s) => s.projects)
  const setProjects = useStore((s) => s.setProjects)
  const specDraft = useStore((s) => s.specDraft)
  const setSpecDraft = useStore((s) => s.setSpecDraft)
  const specEditing = useStore((s) => s.specEditing)
  const setSpecEditing = useStore((s) => s.setSpecEditing)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [originalDraft, setOriginalDraft] = useState('')

  // Preserve scroll position when specDraft updates (agent streams spec in code phase)
  const viewScrollRef = useRef<HTMLDivElement>(null)
  const savedScrollTop = useRef(0)

  useLayoutEffect(() => {
    const el = viewScrollRef.current
    if (el) el.scrollTop = savedScrollTop.current
  }, [specDraft])

  useEffect(() => {
    if (activeProject) {
      setSpecDraft(activeProject.spec || '')
    }
  }, [activeProject?.id, activeProject?.spec])

  const handleEdit = () => {
    setOriginalDraft(specDraft)
    setSpecEditing(true)
    setSaved(false)
  }

  const handleCancel = () => {
    setSpecDraft(originalDraft)
    setSpecEditing(false)
  }

  const handleSave = async () => {
    if (!activeProject) return
    setSaving(true)
    try {
      const updated = await api.updateProject(activeProject.id, { spec: specDraft })
      setProjects(projects.map((p) => (p.id === updated.id ? updated : p)))
      setSpecEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      // keep editing
    } finally {
      setSaving(false)
    }
  }

  const mdComponents = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code({ className, children, ...props }: any) {
      const lang = /language-(\w+)/.exec(className || '')?.[1]
      if (lang === 'mermaid') {
        return <MermaidBlock code={String(children).trim()} />
      }
      return <code className={className} {...props}>{children}</code>
    },
  }

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        No project selected
      </div>
    )
  }

  const hasSpec = specDraft.trim().length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <FileText size={13} className="text-ink-muted" />
        <span className="text-[12px] font-medium text-ink">{activeProject.name}</span>
        <span className="text-[11px] text-ink-muted">/ Specification</span>

        <div className="flex-1" />

        {saved && (
          <Badge variant="success" className="text-[10px]">Saved</Badge>
        )}

        {specEditing ? (
          <>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X size={12} />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving
                ? <Loader2 size={12} className="animate-spin" />
                : <Save size={12} />
              }
              Save
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={handleEdit}>
            <Edit3 size={12} />
            Edit
          </Button>
        )}
      </div>

      {/* Content */}
      {specEditing ? (
        <div className="flex flex-1 min-h-0">
          {/* Editor */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-white/[0.04] text-[10px] text-ink-muted flex items-center gap-1.5">
              <Edit3 size={10} />
              Editor
            </div>
            <Textarea
              value={specDraft}
              onChange={(e) => setSpecDraft(e.target.value)}
              className="flex-1 h-full border-0 rounded-none bg-bg focus:ring-0 focus:border-0 font-mono text-[13px] leading-6 resize-none"
              placeholder="# Contract Specification&#10;&#10;Describe the contract requirements…"
            />
          </div>

          <Separator orientation="vertical" />

          {/* Preview */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="px-3 py-1.5 border-b border-white/[0.04] text-[10px] text-ink-muted flex items-center gap-1.5">
              <Eye size={10} />
              Preview
            </div>
            <ScrollArea className="flex-1 px-4 py-3">
              {specDraft.trim() ? (
                <div className="prose-dark text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{specDraft}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-ink-muted text-sm">Preview will appear here…</p>
              )}
            </ScrollArea>
          </div>
        </div>
      ) : (
        <div
          ref={viewScrollRef}
          className="flex-1 overflow-y-auto px-6 py-5"
          onScroll={() => {
            if (viewScrollRef.current) savedScrollTop.current = viewScrollRef.current.scrollTop
          }}
        >
          {hasSpec ? (
            <div className="prose-dark text-sm max-w-3xl">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{specDraft}</ReactMarkdown>
            </div>
          ) : (
            <EmptySpec onEdit={handleEdit} />
          )}
        </div>
      )}
    </div>
  )
})

function EmptySpec({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 text-center">
      <FileText size={36} className="text-ink-muted/30 mb-4" />
      <p className="text-sm font-medium text-ink mb-1">No specification yet</p>
      <p className="text-[12px] text-ink-muted mb-5 max-w-xs">
        Use the chat to ask the AI to generate a spec, or write one manually.
      </p>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Edit3 size={12} />
        Write manually
      </Button>
    </div>
  )
}
