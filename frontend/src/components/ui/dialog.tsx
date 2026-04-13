import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

function Dialog({ open, onClose, children }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10">{children}</div>
    </div>
  )
}

interface DialogContentProps {
  children: React.ReactNode
  className?: string
  onClose?: () => void
  title?: string
}

function DialogContent({ children, className, onClose, title }: DialogContentProps) {
  return (
    <div
      className={cn(
        'bg-bg-panel border border-white/[0.08] rounded-lg shadow-2xl',
        'min-w-[400px] max-w-2xl w-full max-h-[85vh] flex flex-col',
        className,
      )}
    >
      {(title || onClose) && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          {title && <span className="text-sm font-medium text-ink">{title}</span>}
          {onClose && (
            <button
              onClick={onClose}
              className="ml-auto text-ink-muted hover:text-ink transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto p-5">{children}</div>
    </div>
  )
}

export { Dialog, DialogContent }
