import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full rounded-2xl border-2 border-[rgba(245,234,216,0.12)] bg-bg-elevated px-4 py-3',
      'text-sm text-ink font-medium placeholder:text-ink-dim resize-none',
      'focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20',
      'disabled:opacity-40 transition-colors duration-100',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
