import { useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import {
  Play, Square, Loader2, CheckCircle2, XCircle,
  AlertCircle, FlaskConical, Terminal, RefreshCw
} from 'lucide-react'
import { cn } from '@/lib/utils'

type RunStatus = 'idle' | 'running' | 'pass' | 'fail' | 'error'

interface TestOutput {
  status: RunStatus
  lines: string[]
  elapsed?: number
}

export function TestsPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const wallet = useStore((s) => s.wallet)
  const appendLog = useStore((s) => s.appendLog)

  const [buildOutput, setBuildOutput] = useState<TestOutput>({ status: 'idle', lines: [] })
  const [testOutput, setTestOutput] = useState<TestOutput>({ status: 'idle', lines: [] })
  const [abortRef, setAbortRef] = useState<AbortController | null>(null)
  const [activeTab, setActiveTab] = useState<'tests' | 'build'>('tests')

  const runBuild = async () => {
    if (!activeProject) return
    const ac = new AbortController()
    setAbortRef(ac)
    setBuildOutput({ status: 'running', lines: [] })

    const start = Date.now()
    try {
      const result = await api.buildContract(activeProject.id)
      const elapsed = Date.now() - start
      const lines = result.output?.split('\n') ?? []
      setBuildOutput({
        status: result.success ? 'pass' : 'fail',
        lines,
        elapsed,
      })
      appendLog(`[build] ${result.success ? 'pass' : 'fail'} in ${elapsed}ms`)
    } catch (e: any) {
      setBuildOutput({ status: 'error', lines: [`Error: ${e.message}`] })
    } finally {
      setAbortRef(null)
    }
  }

  const runTests = async () => {
    if (!activeProject) return
    const ac = new AbortController()
    setAbortRef(ac)
    setTestOutput({ status: 'running', lines: [] })

    const start = Date.now()
    try {
      const result = await api.runTests(activeProject.id)
      const elapsed = Date.now() - start
      const lines = result.output?.split('\n') ?? []
      setTestOutput({
        status: result.success ? 'pass' : 'fail',
        lines,
        elapsed,
      })
      appendLog(`[tests] ${result.success ? 'pass' : 'fail'} in ${elapsed}ms`)
    } catch (e: any) {
      setTestOutput({ status: 'error', lines: [`Error: ${e.message}`] })
    } finally {
      setAbortRef(null)
    }
  }

  const handleStop = () => {
    abortRef?.abort()
    setAbortRef(null)
    if (buildOutput.status === 'running') setBuildOutput((p) => ({ ...p, status: 'error', lines: [...p.lines, 'Cancelled'] }))
    if (testOutput.status === 'running') setTestOutput((p) => ({ ...p, status: 'error', lines: [...p.lines, 'Cancelled'] }))
  }

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        No project selected
      </div>
    )
  }

  const isRunning = buildOutput.status === 'running' || testOutput.status === 'running'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <FlaskConical size={13} className="text-ink-muted" />
        <span className="text-[12px] font-medium text-ink">Tests & Build</span>

        <div className="flex-1" />

        {isRunning ? (
          <Button variant="danger" size="sm" onClick={handleStop}>
            <Square size={11} />
            Stop
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={runBuild}>
              <Terminal size={11} />
              Build
            </Button>
            <Button size="sm" onClick={runTests}>
              <Play size={11} />
              Run Tests
            </Button>
          </>
        )}
      </div>

      {/* Tab selector */}
      <div className="flex border-b border-white/[0.06] shrink-0">
        {(['tests', 'build'] as const).map((tab) => {
          const output = tab === 'tests' ? testOutput : buildOutput
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-[11px] font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors',
                activeTab === tab
                  ? 'text-ink border-accent'
                  : 'text-ink-muted border-transparent hover:text-ink',
              )}
            >
              <StatusIcon status={output.status} size={11} />
              <span className="capitalize">{tab}</span>
              {output.elapsed && (
                <span className="text-ink-muted text-[10px]">{output.elapsed}ms</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Output */}
      <div className="flex-1 min-h-0 bg-bg font-mono">
        <ScrollOutput output={activeTab === 'tests' ? testOutput : buildOutput} />
      </div>
    </div>
  )
}

function ScrollOutput({ output }: { output: TestOutput }) {
  if (output.status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12">
        <FlaskConical size={32} className="text-ink-muted/20 mb-3" />
        <p className="text-[12px] text-ink-muted">Run tests to see output</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full p-4">
      {output.status === 'running' && (
        <div className="flex items-center gap-2 text-[12px] text-ink-muted mb-3">
          <Loader2 size={12} className="animate-spin" />
          Running…
        </div>
      )}
      <div className="text-[12px] leading-5">
        {output.lines.map((line, i) => (
          <OutputLine key={i} line={line} />
        ))}
      </div>
      {output.status !== 'running' && (
        <div className={cn(
          'mt-4 flex items-center gap-2 text-[12px] font-medium',
          output.status === 'pass' ? 'text-status-success' : 'text-status-error',
        )}>
          <StatusIcon status={output.status} size={13} />
          {output.status === 'pass' ? 'All tests passed' : output.status === 'fail' ? 'Tests failed' : 'Error'}
          {output.elapsed && (
            <span className="text-ink-muted font-normal">({output.elapsed}ms)</span>
          )}
        </div>
      )}
    </ScrollArea>
  )
}

function OutputLine({ line }: { line: string }) {
  const isError = /error|FAILED|panicked/i.test(line)
  const isPass = /^test .+ \.\.\. ok|PASSED|running \d+/i.test(line)
  const isWarning = /warning:/i.test(line)

  return (
    <div className={cn(
      'whitespace-pre-wrap break-all',
      isError && 'text-status-error',
      isPass && 'text-status-success',
      isWarning && 'text-status-warning',
      !isError && !isPass && !isWarning && 'text-ink-muted',
    )}>
      {line || '\u00A0'}
    </div>
  )
}

function StatusIcon({ status, size = 13 }: { status: RunStatus; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className="animate-spin text-status-info" />
  if (status === 'pass') return <CheckCircle2 size={size} className="text-status-success" />
  if (status === 'fail') return <XCircle size={size} className="text-status-error" />
  if (status === 'error') return <AlertCircle size={size} className="text-status-error" />
  return <Terminal size={size} className="text-ink-muted" />
}
