import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase transition-colors border-2',
  {
    variants: {
      variant: {
        default:  'bg-accent/15 text-accent border-accent/30',
        outline:  'border-[rgba(245,234,216,0.20)] text-ink-muted',
        success:  'bg-status-success/10 text-status-success border-status-success/30',
        error:    'bg-status-error/10 text-status-error border-status-error/30',
        warning:  'bg-status-warning/10 text-status-warning border-status-warning/30',
        info:     'bg-status-info/10 text-status-info border-status-info/30',
        muted:    'bg-bg-elevated text-ink-muted border-[rgba(245,234,216,0.12)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
