import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function HeroBanner({
  title,
  description,
  primaryCtaLabel,
  secondaryCtaLabel,
  onPrimaryClick,
  onSecondaryClick,
  className,
}: {
  title: string
  description: string
  primaryCtaLabel?: string
  secondaryCtaLabel?: string
  onPrimaryClick?: () => void
  onSecondaryClick?: () => void
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl border border-accent/30 bg-accent/5 p-6', className)}>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted mt-2">{description}</p>
      <div className="mt-4 flex gap-2">
        {primaryCtaLabel && <Button onClick={onPrimaryClick}>{primaryCtaLabel}</Button>}
        {secondaryCtaLabel && (
          <Button variant="ghost" onClick={onSecondaryClick}>
            {secondaryCtaLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
