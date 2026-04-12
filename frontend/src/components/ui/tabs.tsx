import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  onChange: (v: string) => void
}
const TabsContext = createContext<TabsContextValue>({ value: '', onChange: () => {} })

interface TabsProps {
  value: string
  onValueChange: (v: string) => void
  children: React.ReactNode
  className?: string
}

function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onChange: onValueChange }}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </TabsContext.Provider>
  )
}

function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-0.5 border-b border-white/[0.06]', className)}>
      {children}
    </div>
  )
}

interface TabsTriggerProps {
  value: string
  children: React.ReactNode
  className?: string
}
function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { value: active, onChange } = useContext(TabsContext)
  const isActive = active === value
  return (
    <button
      onClick={() => onChange(value)}
      className={cn(
        'px-3 py-2 text-xs font-medium transition-colors duration-100 border-b-2 -mb-px',
        isActive
          ? 'text-ink border-accent'
          : 'text-ink-muted border-transparent hover:text-ink hover:border-white/20',
        className,
      )}
    >
      {children}
    </button>
  )
}

function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { value: active } = useContext(TabsContext)
  if (active !== value) return null
  return <div className={cn('flex-1 min-h-0', className)}>{children}</div>
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
