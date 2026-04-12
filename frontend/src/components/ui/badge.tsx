import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase transition-colors',
  {
    variants: {
      variant: {
        default:  'bg-accent/15 text-accent border border-accent/20',
        outline:  'border border-white/10 text-ink-muted',
        success:  'bg-status-success/10 text-status-success border border-status-success/20',
        error:    'bg-status-error/10 text-status-error border border-status-error/20',
        warning:  'bg-status-warning/10 text-status-warning border border-status-warning/20',
        info:     'bg-status-info/10 text-status-info border border-status-info/20',
        muted:    'bg-bg-elevated text-ink-muted border border-white/[0.06]',
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
