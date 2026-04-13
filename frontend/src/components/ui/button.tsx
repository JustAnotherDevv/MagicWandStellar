import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default:  'bg-accent text-white hover:bg-accent-bright shadow-hard border-2 border-black/20',
        outline:  'border-2 border-[rgba(245,234,216,0.20)] text-ink-muted hover:text-ink hover:border-[rgba(245,234,216,0.40)] hover:bg-bg-hover',
        ghost:    'text-ink-muted hover:text-ink hover:bg-bg-hover',
        danger:   'bg-status-error/10 border-2 border-status-error/30 text-status-error hover:bg-status-error/20 shadow-hard-sm',
        success:  'bg-status-success/10 border-2 border-status-success/30 text-status-success hover:bg-status-success/20 shadow-hard-sm',
      },
      size: {
        sm:      'h-8 px-3 text-xs',
        md:      'h-9 px-4 text-xs',
        default: 'h-10 px-5 text-sm',
        lg:      'h-11 px-6 text-sm',
        icon:    'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
