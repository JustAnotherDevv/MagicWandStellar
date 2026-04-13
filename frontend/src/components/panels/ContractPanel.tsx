import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { shortKey, fmtDate } from '@/lib/utils'
import {
  Loader2, Package, ExternalLink, Copy, Check,
  RefreshCw, Shield, Clock, Rocket, Play
} from 'lucide-react'
import type { Contract, ContractFunctionAbi } from '@/types'

export function ContractPanel() {
  const activeProject = useStore((s) => s.activeProject())
  const wallet = useStore((s) => s.wallet)
  const contracts = useStore((s) => s.contracts)
  const setContracts = useStore((s) => s.setContracts)
  const activeSessionId = useStore((s) => s.activeSessionId)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [wasmFiles, setWasmFiles] = useState<string[]>([])
  const [deploying, setDeploying] = useState(false)
  const [deployOutput, setDeployOutput] = useState('')
  const [wasmPath, setWasmPath] = useState('')
  const [source, setSource] = useState('alice')
  const [contractAlias, setContractAlias] = useState('')
  const [network, setNetwork] = useState<'testnet' | 'mainnet' | 'futurenet' | 'local'>((wallet.network as any) || 'testnet')
  const [selectedContractId, setSelectedContractId] = useState('')
  const [abi, setAbi] = useState<ContractFunctionAbi[]>([])
  const [abiLoading, setAbiLoading] = useState(false)
  const [invokeOutputs, setInvokeOutputs] = useState<Record<string, string>>({})
  const [invokeBusy, setInvokeBusy] = useState<Record<string, boolean>>({})
  const [fnInputs, setFnInputs] = useState<Record<string, Record<string, string>>>({})

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

  const loadArtifacts = async () => {
    if (!activeProject) return
    try {
      const files = await api.listWasmArtifacts(activeProject.id)
      setWasmFiles(files)
      if (!wasmPath && files.length > 0) setWasmPath(files[0])
    } catch {
      setWasmFiles([])
    }
  }

  useEffect(() => {
    loadContracts()
    loadArtifacts()
  }, [activeProject?.id])

  useEffect(() => {
    if (contracts.length > 0 && !selectedContractId) {
      setSelectedContractId(contracts[0].contractId)
    }
  }, [contracts])

  const selectedContract = useMemo(
    () => contracts.find((c) => c.contractId === selectedContractId) ?? contracts[0],
    [contracts, selectedContractId],
  )

  useEffect(() => {
    const run = async () => {
      if (!activeProject || !selectedContract?.contractId) return
      setAbiLoading(true)
      try {
        const res = await api.getContractAbi(activeProject.id, selectedContract.contractId, network)
        setAbi(res.functions)
      } catch {
        setAbi([])
      } finally {
        setAbiLoading(false)
      }
    }
    run()
  }, [activeProject?.id, selectedContract?.contractId, network])

  const deployNow = async () => {
    if (!activeProject || !wasmPath.trim() || !source.trim()) return
    setDeploying(true)
    setDeployOutput('')
    try {
      const result = await api.deployContract(activeProject.id, {
        wasmPath: wasmPath.trim(),
        source: source.trim(),
        contractAlias: contractAlias.trim() || undefined,
        network,
        sessionId: activeSessionId ?? undefined,
      })
      setDeployOutput(result.output)
      await loadContracts()
      await loadArtifacts()
    } catch (e: any) {
      setDeployOutput(`Deploy error: ${e.message}`)
    } finally {
      setDeploying(false)
    }
  }

  const invokeFn = async (fn: ContractFunctionAbi) => {
    if (!activeProject || !selectedContract?.contractId || !source.trim()) return
    setInvokeBusy((s) => ({ ...s, [fn.name]: true }))
    try {
      const result = await api.invokeContract(activeProject.id, selectedContract.contractId, {
        functionName: fn.name,
        params: fnInputs[fn.name] ?? {},
        source: source.trim(),
        network,
        sendTransaction: !fn.isReadOnly,
      })
      setInvokeOutputs((s) => ({ ...s, [fn.name]: result.output }))
    } catch (e: any) {
      setInvokeOutputs((s) => ({ ...s, [fn.name]: `Invoke error: ${e.message}` }))
    } finally {
      setInvokeBusy((s) => ({ ...s, [fn.name]: false }))
    }
  }

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

      <div className="px-4 py-3 border-b border-white/[0.06] bg-bg-panel/50 space-y-2">
        <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
          <Rocket size={13} className="text-accent" />
          Deploy to Network
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source account alias (e.g. alice)" />
          <Input value={contractAlias} onChange={(e) => setContractAlias(e.target.value)} placeholder="Contract alias (optional)" />
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as any)}
            className="h-9 rounded border-2 border-white/[0.12] bg-bg-surface px-2 text-[12px] text-ink"
          >
            <option value="testnet">testnet</option>
            <option value="mainnet">mainnet</option>
            <option value="futurenet">futurenet</option>
            <option value="local">local</option>
          </select>
          <select
            value={wasmPath}
            onChange={(e) => setWasmPath(e.target.value)}
            className="h-9 rounded border-2 border-white/[0.12] bg-bg-surface px-2 text-[12px] text-ink"
          >
            {wasmFiles.length === 0 ? <option value="">No .wasm artifacts found</option> : wasmFiles.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <Button onClick={deployNow} disabled={deploying || !wasmPath || !source} size="sm" className="w-full">
          {deploying ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          Deploy Contract
        </Button>
        {deployOutput && (
          <pre className="text-[10px] text-ink-muted bg-bg-surface rounded p-2 border border-white/[0.06] max-h-32 overflow-auto whitespace-pre-wrap">
            {deployOutput}
          </pre>
        )}
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
            <div className="rounded border border-white/[0.08] bg-bg-surface p-3">
              <div className="text-[12px] font-medium text-ink mb-2">Contract Calls (ABI-driven)</div>
              <select
                value={selectedContract?.contractId ?? ''}
                onChange={(e) => setSelectedContractId(e.target.value)}
                className="h-9 w-full rounded border-2 border-white/[0.12] bg-bg-surface px-2 text-[12px] text-ink mb-3"
              >
                {contracts.map((c) => (
                  <option key={c.contractId} value={c.contractId}>
                    {(c.name || 'contract')} — {shortKey(c.contractId)}
                  </option>
                ))}
              </select>
              {abiLoading ? (
                <div className="text-[11px] text-ink-muted flex items-center gap-2"><Loader2 size={11} className="animate-spin" />Loading ABI…</div>
              ) : abi.length === 0 ? (
                <div className="text-[11px] text-ink-muted">No ABI functions parsed yet. Deploy and refresh.</div>
              ) : (
                <div className="space-y-2">
                  {abi.map((fn) => (
                    <div key={fn.name} className="border border-white/[0.08] rounded p-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-semibold text-ink">{fn.name}</span>
                        <Badge variant={fn.isReadOnly ? 'muted' : 'success'}>{fn.isReadOnly ? 'read' : 'write'}</Badge>
                        {fn.returnType ? <span className="text-[10px] text-ink-muted">→ {fn.returnType}</span> : null}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {fn.params
                          .filter((p) => !(p.name === 'env' || p.type === 'Env'))
                          .map((p) => (
                          <Input
                            key={`${fn.name}-${p.name}`}
                            placeholder={`${p.name}: ${p.type}`}
                            value={fnInputs[fn.name]?.[p.name] ?? ''}
                            onChange={(e) =>
                              setFnInputs((s) => ({
                                ...s,
                                [fn.name]: {
                                  ...(s[fn.name] ?? {}),
                                  [p.name]: e.target.value,
                                },
                              }))
                            }
                          />
                        ))}
                      </div>
                      <div className="mt-2">
                        <Button size="sm" onClick={() => invokeFn(fn)} disabled={!!invokeBusy[fn.name] || !source}>
                          {invokeBusy[fn.name] ? <Loader2 size={11} className="animate-spin mr-1" /> : <Play size={11} className="mr-1" />}
                          {fn.isReadOnly ? 'Read' : 'Invoke'}
                        </Button>
                      </div>
                      {invokeOutputs[fn.name] ? (
                        <pre className="mt-2 text-[10px] text-ink-muted bg-bg-panel rounded p-2 border border-white/[0.06] max-h-28 overflow-auto whitespace-pre-wrap">
                          {invokeOutputs[fn.name]}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
