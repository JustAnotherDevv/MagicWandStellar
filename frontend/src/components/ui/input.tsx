import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-10 w-full rounded-2xl border-2 border-[rgba(245,234,216,0.12)] bg-bg-elevated px-4 py-2',
      'text-sm text-ink font-medium placeholder:text-ink-dim',
      'focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20',
      'disabled:opacity-40 transition-colors duration-100',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
