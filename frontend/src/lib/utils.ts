import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(ts: number): string {
  return formatDistanceToNow(new Date(ts), { addSuffix: true })
}

export function fmtDate(ts: number): string {
  return format(new Date(ts), 'MMM d, HH:mm')
}

export function shortKey(key: string): string {
  if (!key) return ''
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

export function networkColor(network: string): string {
  switch (network) {
    case 'mainnet': return 'text-status-success'
    case 'testnet': return 'text-status-info'
    case 'futurenet': return 'text-status-warning'
    default: return 'text-ink-muted'
  }
}

export function networkBadgeClass(network: string): string {
  switch (network) {
    case 'mainnet': return 'bg-status-success/10 text-status-success border-status-success/20'
    case 'testnet': return 'bg-status-info/10 text-status-info border-status-info/20'
    case 'futurenet': return 'bg-status-warning/10 text-status-warning border-status-warning/20'
    default: return 'bg-ink-dim/20 text-ink-muted border-white/10'
  }
}

// Parse server log lines like: [2026-04-12T19:30:35.386Z][INFO][db] message {...}
export function parseLogLine(line: string) {
  const m = line.match(/^\[(.+?)\]\[(\w+)\]\[(.+?)\]\s(.+)$/)
  if (!m) return null
  const [, ts, level, context, rest] = m
  const jsonMatch = rest.match(/^(.*?)\s(\{.+\})$/)
  return {
    timestamp: ts,
    level: level as 'INFO' | 'WARN' | 'ERROR',
    context,
    message: jsonMatch ? jsonMatch[1] : rest,
    data: jsonMatch ? (() => { try { return JSON.parse(jsonMatch[2]) } catch { return null } })() : null,
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
