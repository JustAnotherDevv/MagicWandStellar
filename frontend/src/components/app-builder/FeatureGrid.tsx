import { SectionCard } from './SectionCard'

export interface FeatureItem {
  id: string
  title: string
  description: string
}

export function FeatureGrid({
  title,
  subtitle,
  items,
}: {
  title: string
  subtitle?: string
  items: FeatureItem[]
}) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-white/[0.08] bg-bg p-3">
            <h4 className="text-sm font-semibold text-ink">{item.title}</h4>
            <p className="text-[12px] text-ink-muted mt-1">{item.description}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
