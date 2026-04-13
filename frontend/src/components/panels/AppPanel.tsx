import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function AppPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const projects = useStore((s) => s.projects)
  const setProjects = useStore((s) => s.setProjects)

  const initial = useMemo(() => ({
    appName: activeProject?.appName ?? activeProject?.name ?? '',
    appDescription: activeProject?.appDescription ?? '',
    appTags: activeProject?.appTags ?? '',
    appLogoUrl: activeProject?.appLogoUrl ?? '',
    appBannerUrl: activeProject?.appBannerUrl ?? '',
    appRuntimeUrl: activeProject?.appRuntimeUrl ?? '',
  }), [activeProject?.id, activeProject?.appName, activeProject?.appDescription, activeProject?.appTags, activeProject?.appLogoUrl, activeProject?.appBannerUrl, activeProject?.appRuntimeUrl, activeProject?.name])

  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setForm(initial)
  }, [initial])

  if (!activeProject) {
    return <div className="p-4 text-sm text-ink-muted">Select a project first.</div>
  }

  const save = async (publish: boolean) => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateProject(activeProject.id, {
        appName: form.appName.trim(),
        appDescription: form.appDescription.trim(),
        appTags: form.appTags.trim(),
        appLogoUrl: form.appLogoUrl.trim(),
        appBannerUrl: form.appBannerUrl.trim(),
        appRuntimeUrl: form.appRuntimeUrl.trim(),
        appPublishedAt: publish ? Date.now() : activeProject.appPublishedAt ?? null,
      })
      setProjects(projects.map((p) => (p.id === updated.id ? updated : p)))
      setMessage(publish ? 'Published app details.' : 'Saved app details.')
    } catch (e: any) {
      setMessage(`Failed to save: ${e?.message ?? 'Unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">App Details</h3>
        {activeProject.appPublishedAt ? (
          <Badge variant="success">Published</Badge>
        ) : (
          <Badge variant="muted">Draft</Badge>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">App Name</label>
        <Input
          value={form.appName}
          onChange={(e) => setForm((s) => ({ ...s, appName: e.target.value }))}
          placeholder="My Stellar App"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">Description</label>
        <Textarea
          value={form.appDescription}
          onChange={(e) => setForm((s) => ({ ...s, appDescription: e.target.value }))}
          placeholder="What this app does..."
          className="min-h-[96px]"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">Tags (optional, comma-separated)</label>
        <Input
          value={form.appTags}
          onChange={(e) => setForm((s) => ({ ...s, appTags: e.target.value }))}
          placeholder="defi, wallet, marketplace"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">App Logo URL (optional)</label>
        <Input
          value={form.appLogoUrl}
          onChange={(e) => setForm((s) => ({ ...s, appLogoUrl: e.target.value }))}
          placeholder="https://..."
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">App Banner URL (optional)</label>
        <Input
          value={form.appBannerUrl}
          onChange={(e) => setForm((s) => ({ ...s, appBannerUrl: e.target.value }))}
          placeholder="https://... (wide image)"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[11px] text-ink-muted">Runtime URL (optional, for Open App)</label>
        <Input
          value={form.appRuntimeUrl}
          onChange={(e) => setForm((s) => ({ ...s, appRuntimeUrl: e.target.value }))}
          placeholder="https://your-app.vercel.app"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={() => save(false)} disabled={saving}>Save</Button>
        <Button onClick={() => save(true)} disabled={saving || !form.appName.trim()}>
          Publish
        </Button>
      </div>

      {message && <p className="text-[11px] text-ink-muted">{message}</p>}
    </div>
  )
}
