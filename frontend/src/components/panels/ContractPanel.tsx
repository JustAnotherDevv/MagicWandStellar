import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { shortKey, fmtDate } from '@/lib/utils'
import {
  Loader2, Package, ExternalLink, Copy, Check,
  RefreshCw, Shield, Clock
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Contract } from '@/types'

export function ContractPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const wallet = useStore((s) => s.wallet)
  const contracts = useStore((s) => s.contracts)
  const setContracts = useStore((s) => s.setContracts)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadContracts = async () => {
    if (!activeProject) return
    setLoading(true)
    setError('')
    try {
      const result = await api.getContracts(activeProject.id)
      setContracts(result)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadContracts()
  }, [activeProject?.id])

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink-muted text-sm">
        No project selected
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2 border-b border-white/[0.06] flex items-center gap-2 shrink-0">
        <Package size={13} className="text-ink-muted" />
        <span className="text-[12px] font-medium text-ink">Deployed Contracts</span>
        <Badge variant="muted">{contracts.length}</Badge>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={loadContracts} title="Refresh">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {loading && contracts.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-ink-muted">
            <Loader2 size={12} className="animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-[12px] text-status-error">{error}</div>
        ) : contracts.length === 0 ? (
          <EmptyContracts />
        ) : (
          <div className="p-4 flex flex-col gap-3">
            {contracts.map((c) => (
              <ContractCard key={c.id} contract={c} network={wallet.network} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function ContractCard({ contract, network }: { contract: Contract; network: string }) {
  const [copied, setCopied] = useState(false)

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const stellarExpertBase = network === 'mainnet'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet'

  const explorerUrl = contract.contractId
    ? `${stellarExpertBase}/contract/${contract.contractId}`
    : null

  return (
    <div className="rounded border border-white/[0.08] bg-bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-bg-panel flex items-center gap-2">
        <Shield size={14} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-ink truncate">{contract.name || 'Unnamed Contract'}</p>
          {contract.contractId && (
            <p className="text-[10px] font-mono text-ink-muted mt-0.5">{shortKey(contract.contractId)}</p>
          )}
        </div>
        <Badge
          variant={contract.status === 'deployed' ? 'success' : contract.status === 'failed' ? 'error' : 'muted'}
          className="capitalize"
        >
          {contract.status}
        </Badge>
      </div>

      <Separator />

      {/* Details */}
      <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        {contract.contractId && (
          <>
            <span className="text-ink-muted">Contract ID</span>
            <div className="flex items-center gap-1.5 font-mono text-ink">
              <span className="truncate">{shortKey(contract.contractId)}</span>
              <button
                onClick={() => copy(contract.contractId!)}
                className="text-ink-muted hover:text-ink shrink-0"
                title="Copy"
              >
                {copied ? <Check size={10} className="text-status-success" /> : <Copy size={10} />}
              </button>
            </div>
          </>
        )}

        {contract.wasmPath && (
          <>
            <span className="text-ink-muted">WASM Path</span>
            <span className="font-mono text-ink truncate">{contract.wasmPath.split('/').pop()}</span>
          </>
        )}

        {contract.network && (
          <>
            <span className="text-ink-muted">Network</span>
            <span className="capitalize text-ink">{contract.network}</span>
          </>
        )}

        {contract.deployedAt && (
          <>
            <span className="text-ink-muted">Deployed</span>
            <div className="flex items-center gap-1 text-ink">
              <Clock size={10} className="text-ink-muted" />
              {fmtDate(contract.deployedAt)}
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {explorerUrl && (
        <>
          <Separator />
          <div className="px-4 py-2.5 flex items-center gap-2">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-bright transition-colors"
            >
              <ExternalLink size={11} />
              View on Stellar Expert
            </a>
          </div>
        </>
      )}
    </div>
  )
}

function EmptyContracts() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <Package size={36} className="text-ink-muted/20 mb-4" />
      <p className="text-sm font-medium text-ink mb-1">No contracts deployed</p>
      <p className="text-[12px] text-ink-muted max-w-xs">
        Ask the AI to generate and deploy a contract, then it will appear here.
      </p>
    </div>
  )
}
