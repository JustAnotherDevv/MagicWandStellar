import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function SectionCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string
  subtitle?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('rounded-2xl border border-white/[0.08] bg-bg-surface p-4', className)}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-[12px] text-ink-muted mt-1">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}
