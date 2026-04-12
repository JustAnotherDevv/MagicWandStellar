import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full rounded border border-white/[0.08] bg-bg-elevated px-3 py-2',
      'text-sm text-ink placeholder:text-ink-dim resize-none',
      'focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20',
      'disabled:opacity-40 transition-colors duration-100',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
