import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
  {
    variants: {
      variant: {
        default:  'bg-accent text-white hover:bg-accent-bright shadow-[0_0_12px_rgba(240,115,24,0.2)]',
        outline:  'border border-white/10 text-ink-muted hover:text-ink hover:border-white/20 hover:bg-bg-hover',
        ghost:    'text-ink-muted hover:text-ink hover:bg-bg-hover',
        danger:   'bg-status-error/10 border border-status-error/20 text-status-error hover:bg-status-error/20',
        success:  'bg-status-success/10 border border-status-success/20 text-status-success hover:bg-status-success/20',
      },
      size: {
        sm:   'h-7 px-2.5 text-xs',
        md:   'h-8 px-3 text-xs',
        default: 'h-9 px-4 text-sm',
        lg:   'h-10 px-5 text-sm',
        icon: 'h-8 w-8',
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
