import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { parseLogLine } from '@/lib/utils'
import { Trash2, Search, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LogsPanel() {
  const logs = useStore((s) => s.logs)
  const clearLogs = useStore((s) => s.clearLogs)

  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = filter
    ? logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : logs

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div className="flex flex-col h-full font-mono text-[11px]">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs…"
            className="pl-7 h-7 text-[11px] font-mono"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
            >
              <X size={10} />
            </button>
          )}
        </div>

        <span className="text-ink-muted text-[10px] shrink-0">
          {filtered.length} / {logs.length}
        </span>

        {!autoScroll && (
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
            title="Scroll to bottom"
          >
            <ChevronDown size={11} />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6"
          onClick={clearLogs}
          title="Clear logs"
        >
          <Trash2 size={11} />
        </Button>
      </div>

      {/* Log lines */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-3 bg-bg"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="text-ink-muted py-4 text-center">
            {logs.length === 0 ? 'No logs yet. Start chatting to see agent activity.' : 'No matches for filter.'}
          </div>
        ) : (
          filtered.map((line, i) => <LogLine key={i} raw={line} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function LogLine({ raw }: { raw: string }) {
  const parsed = parseLogLine(raw)

  const levelColors: Record<string, string> = {
    INFO: 'text-status-info',
    WARN: 'text-status-warning',
    ERROR: 'text-status-error',
    DEBUG: 'text-ink-muted',
  }

  const ctxColors: Record<string, string> = {
    loop:        'text-accent',
    executor:    'text-status-info',
    tool:        'text-status-warning',
    chat:        'text-status-success',
    'stellar-cli': 'text-ink-muted',
    db:          'text-ink-muted',
    session:     'text-status-success',
    tool_result: 'text-ink-muted',
  }

  if (!parsed) {
    return <div className="text-ink-muted leading-5">{raw}</div>
  }

  return (
    <div className="leading-5 flex items-start gap-1.5 hover:bg-bg-hover rounded px-1">
      <span className="text-ink-muted/50 shrink-0 select-none">
        {parsed.timestamp.slice(11, 19)}
      </span>
      <span className={cn('shrink-0 w-10', levelColors[parsed.level] ?? 'text-ink-muted')}>
        {parsed.level}
      </span>
      <span className={cn('shrink-0 w-16 truncate', ctxColors[parsed.context] ?? 'text-ink-muted')}>
        [{parsed.context}]
      </span>
      <span className="text-ink break-all">{parsed.message}</span>
    </div>
  )
}
