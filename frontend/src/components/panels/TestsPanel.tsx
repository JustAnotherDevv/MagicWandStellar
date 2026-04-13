import { useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Play, Square, Loader2, CheckCircle2, XCircle,
  AlertCircle, FlaskConical, Hammer,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type RunStatus = 'idle' | 'running' | 'pass' | 'fail' | 'error'

interface RunOutput {
  status: RunStatus
  lines: string[]
  elapsed?: number
}

export function TestsPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const appendLog = useStore((s) => s.appendLog)

  const [buildOutput, setBuildOutput] = useState<RunOutput>({ status: 'idle', lines: [] })
  const [testOutput, setTestOutput] = useState<RunOutput>({ status: 'idle', lines: [] })
  const [abortRef, setAbortRef] = useState<AbortController | null>(null)
  const [activeTab, setActiveTab] = useState<'tests' | 'build'>('tests')

  const runBuild = async () => {
    if (!activeProject) return
    const ac = new AbortController()
    setAbortRef(ac)
    setActiveTab('build')
    setBuildOutput({ status: 'running', lines: [] })
    const start = Date.now()
    try {
      const result = await api.buildContract(activeProject.id)
      const elapsed = Date.now() - start
      setBuildOutput({ status: result.success ? 'pass' : 'fail', lines: result.output?.split('\n') ?? [], elapsed })
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
    setActiveTab('tests')
    setTestOutput({ status: 'running', lines: [] })
    const start = Date.now()
    try {
      const result = await api.runTests(activeProject.id)
      const elapsed = Date.now() - start
      setTestOutput({ status: result.success ? 'pass' : 'fail', lines: result.output?.split('\n') ?? [], elapsed })
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
    if (buildOutput.status === 'running')
      setBuildOutput((p) => ({ ...p, status: 'error', lines: [...p.lines, '[Cancelled]'] }))
    if (testOutput.status === 'running')
      setTestOutput((p) => ({ ...p, status: 'error', lines: [...p.lines, '[Cancelled]'] }))
  }

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        No project selected
      </div>
    )
  }

  const isRunning = buildOutput.status === 'running' || testOutput.status === 'running'
  const activeOutput = activeTab === 'tests' ? testOutput : buildOutput

  return (
    <div className="flex flex-col h-full">

      {/* ── Toolbar — matches SpecPanel exactly ── */}
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <FlaskConical size={13} className="text-ink-muted" />
        <span className="text-[12px] font-medium text-ink">Tests &amp; Build</span>

        <div className="flex-1" />

        {isRunning ? (
          <Button variant="danger" size="sm" onClick={handleStop}>
            <Square size={11} />
            Stop
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={runBuild}>
              <Hammer size={11} />
              Build
            </Button>
            <Button size="sm" onClick={runTests}>
              <Play size={11} />
              Run Tests
            </Button>
          </>
        )}
      </div>

      {/* ── Sub-tabs — matches SpecPanel's inner section tabs ── */}
      <div className="flex border-b border-white/[0.06] shrink-0">
        {(['tests', 'build'] as const).map((tab) => {
          const out = tab === 'tests' ? testOutput : buildOutput
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium',
                'border-b-2 -mb-px transition-colors duration-100',
                activeTab === tab
                  ? 'text-ink border-accent'
                  : 'text-ink-muted border-transparent hover:text-ink',
              )}
            >
              <StatusDot status={out.status} />
              {tab === 'tests' ? 'Tests' : 'Build'}
              {out.elapsed !== undefined && (
                <span className="text-[10px] text-ink-muted/60 font-normal">{out.elapsed}ms</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeOutput.status === 'idle' ? (

          /* Empty state — matches CodePanel's "Select a file" state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              {activeTab === 'tests'
                ? <FlaskConical size={36} className="text-ink-muted/20 mx-auto mb-3" />
                : <Hammer size={36} className="text-ink-muted/20 mx-auto mb-3" />
              }
              <p className="text-sm text-ink-muted mb-4">
                {activeTab === 'tests' ? 'Run tests to see output' : 'Build to see compiler output'}
              </p>
              <Button variant="outline" size="sm" onClick={activeTab === 'tests' ? runTests : runBuild}>
                {activeTab === 'tests' ? <Play size={11} /> : <Hammer size={11} />}
                {activeTab === 'tests' ? 'Run Tests' : 'Build'}
              </Button>
            </div>
          </div>

        ) : (
          <>
            {/* Terminal output — same bg/font as LogsPanel */}
            <ScrollArea className="flex-1 p-3 font-mono bg-bg">
              {activeOutput.status === 'running' && (
                <div className="flex items-center gap-2 text-[11px] text-ink-muted mb-3">
                  <Loader2 size={11} className="animate-spin text-status-info" />
                  {activeTab === 'tests' ? 'Running tests…' : 'Building…'}
                </div>
              )}
              <div className="text-[12px] leading-relaxed">
                {activeOutput.lines.map((line, i) => (
                  <OutputLine key={i} line={line} />
                ))}
              </div>
            </ScrollArea>

            {/* Status bar — only shown after completion */}
            {activeOutput.status !== 'running' && (
              <div className={cn(
                'shrink-0 flex items-center gap-2 px-4 py-2 border-t text-[11px] font-medium',
                activeOutput.status === 'pass'
                  ? 'border-status-success/20 bg-status-success/[0.06] text-status-success'
                  : 'border-status-error/20 bg-status-error/[0.06] text-status-error',
              )}>
                <StatusIcon status={activeOutput.status} size={12} />
                {activeOutput.status === 'pass'
                  ? (activeTab === 'tests' ? 'All tests passed' : 'Build succeeded')
                  : activeOutput.status === 'fail'
                    ? (activeTab === 'tests' ? 'Tests failed' : 'Build failed')
                    : 'Error'}
                {activeOutput.elapsed !== undefined && (
                  <span className="font-normal opacity-50 ml-1">{activeOutput.elapsed}ms</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function OutputLine({ line }: { line: string }) {
  const isError   = /\berror(\[E\d+\])?[: ]/i.test(line) || /\bFAILED\b|panicked at/i.test(line)
  const isPass    = /^test .+ \.\.\. ok$|^running \d+ test|\bPASSED\b/i.test(line.trim())
  const isWarning = /\bwarning:/i.test(line)
  const isNote    = /^\s*(note|help):/i.test(line)
  const isFinished = /^\s*Finished\b/.test(line)
  const isDim      = /^\s*(Compiling|Downloading|Updating|Locking|Fetching)\b/i.test(line)

  return (
    <div className={cn(
      'whitespace-pre-wrap break-all leading-5',
      isError    && 'text-status-error',
      isPass     && 'text-status-success',
      isWarning  && 'text-status-warning',
      isNote     && 'text-status-info',
      isFinished && 'text-status-success',
      isDim && !isFinished && 'text-ink-muted/50',
      !isError && !isPass && !isWarning && !isNote && !isDim && !isFinished && 'text-ink-muted',
    )}>
      {line || '\u00A0'}
    </div>
  )
}

function StatusDot({ status }: { status: RunStatus }) {
  return (
    <span className={cn(
      'inline-block w-1.5 h-1.5 rounded-full shrink-0',
      status === 'running'                       && 'bg-status-info animate-pulse',
      status === 'pass'                          && 'bg-status-success',
      (status === 'fail' || status === 'error')  && 'bg-status-error',
      status === 'idle'                          && 'bg-ink-dim',
    )} />
  )
}

function StatusIcon({ status, size = 13 }: { status: RunStatus; size?: number }) {
  if (status === 'running') return <Loader2 size={size} className="animate-spin" />
  if (status === 'pass')    return <CheckCircle2 size={size} />
  if (status === 'fail')    return <XCircle size={size} />
  if (status === 'error')   return <AlertCircle size={size} />
  return null
}
