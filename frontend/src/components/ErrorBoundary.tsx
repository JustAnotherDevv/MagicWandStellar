/// <reference types="vite/client" />
import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional label shown in the error card header */
  label?: string
  /** Called with the error when one is caught — useful for telemetry */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

/**
 * React error boundary that prevents a single component failure from
 * crashing the entire application. Wrap any subtree that performs async
 * work, renders third-party UI (Monaco, Mermaid), or streams data.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info)
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack)
    }
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-3xl border-2 border-status-error/25 bg-status-error/[0.04] p-6 text-center shadow-hard">
          <div className="w-10 h-10 rounded-2xl bg-status-error/10 border border-status-error/25 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={18} className="text-status-error" />
          </div>
          {this.props.label && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1">
              {this.props.label}
            </p>
          )}
          <p className="text-sm font-semibold text-ink mb-1">Something went wrong</p>
          <p className="text-[12px] text-ink-muted font-mono break-all mb-5 leading-relaxed">
            {this.state.error.message}
          </p>
          <button
            onClick={this.reset}
            className="btn-outline text-xs px-4 py-2 rounded-full"
          >
            <RotateCcw size={12} />
            Try again
          </button>
        </div>
      </div>
    )
  }
}
