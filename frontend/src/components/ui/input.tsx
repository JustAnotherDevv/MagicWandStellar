import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded border border-white/[0.08] bg-bg-elevated px-3 py-2',
      'text-sm text-ink placeholder:text-ink-dim',
      'focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20',
      'disabled:opacity-40 transition-colors duration-100',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
