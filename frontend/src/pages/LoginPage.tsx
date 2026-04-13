import { useState, useEffect } from 'react'
import { useStore } from '@/store'
import { connectWallet, isFreighterInstalled } from '@/lib/stellar'
import { Button } from '@/components/ui/button'
import { Wallet, ExternalLink, Loader2, AlertCircle } from 'lucide-react'

export function LoginPage() {
  const setWallet = useStore((s) => s.setWallet)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('testnet')
  // null = still checking, true/false = result
  const [freighterFound, setFreighterFound] = useState<boolean | null>(null)

  // Async detection — Freighter injects into window after page load
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      // Give the extension a moment to inject (content scripts can be slightly delayed)
      await new Promise((r) => setTimeout(r, 500))
      if (cancelled) return
      const found = await isFreighterInstalled()
      if (!cancelled) setFreighterFound(found)
    }
    check()
    return () => { cancelled = true }
  }, [])

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      const result = await connectWallet()
      setWallet({
        publicKey: result.publicKey,
        network,
        isConnected: true,
      })
    } catch (e: any) {
      const msg: string = e.message ?? 'Failed to connect wallet'
      // If connect fails due to missing extension, update the detected state
      if (msg.toLowerCase().includes('install') || msg.toLowerCase().includes('not found')) {
        setFreighterFound(false)
      }
      setError(msg)
    } finally {
      setConnecting(false)
    }
  }

  // While checking, show the connect button (optimistic — most users have it)
  const showInstall = freighterFound === false

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(rgba(232,48,48,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(232,48,48,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Glow */}
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center max-w-sm w-full">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="w-24 h-24 rounded-3xl overflow-hidden shadow-hard border-2 border-[rgba(245,234,216,0.15)]">
            <img src="/logo.png" alt="MagicWand" className="w-full h-full object-cover" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-extrabold text-ink tracking-tight">
              Magic<span className="text-accent">Wand</span>
            </h1>
            <p className="text-[13px] text-ink-muted mt-1">
              Agentic Stellar App Store &amp; App Builder
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full rounded-3xl border-2 border-[rgba(245,234,216,0.12)] bg-bg-panel p-6 shadow-hard">
          <h2 className="text-[13px] font-semibold text-ink mb-1">Connect your wallet</h2>
          <p className="text-[12px] text-ink-muted mb-5">
            Sign in with Freighter to access your projects and deploy contracts on Stellar.
          </p>

          {/* Network selector */}
          <div className="mb-4">
            <label className="block text-[11px] text-ink-muted mb-2 font-medium uppercase tracking-wider">
              Network
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['testnet', 'mainnet'] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setNetwork(n)}
                  className={`
                    px-3 py-2 rounded-2xl border-2 text-[12px] font-bold capitalize transition-all duration-100
                    ${network === n
                      ? n === 'mainnet'
                        ? 'bg-status-success/10 border-status-success/30 text-status-success'
                        : 'bg-accent/10 border-accent/30 text-accent'
                      : 'border-[rgba(245,234,216,0.12)] text-ink-muted hover:border-[rgba(245,234,216,0.25)] hover:text-ink'
                    }
                  `}
                >
                  {n}
                  {n === 'mainnet' && (
                    <span className="ml-1 text-[9px] text-status-error">LIVE</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded bg-status-error/10 border border-status-error/20">
              <AlertCircle size={13} className="text-status-error shrink-0 mt-0.5" />
              <p className="text-[12px] text-status-error">{error}</p>
            </div>
          )}

          {/* Connect button or install prompt */}
          {!showInstall ? (
            <Button
              className="w-full"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting
                ? <><Loader2 size={14} className="animate-spin" /> Connecting…</>
                : <><Wallet size={14} /> Connect with Freighter</>
              }
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded bg-status-warning/10 border border-status-warning/20">
                <AlertCircle size={13} className="text-status-warning shrink-0" />
                <p className="text-[12px] text-status-warning">
                  Freighter extension not detected. Install it and reload the page.
                </p>
              </div>
              <a
                href="https://freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full h-10 px-4 rounded-full bg-accent text-white text-sm font-bold hover:bg-accent-bright transition-colors shadow-hard border-2 border-black/20"
              >
                <ExternalLink size={13} />
                Install Freighter
              </a>
            </div>
          )}
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 w-full text-center">
          {[
            { label: 'AI Agent', desc: 'Describe → build production contracts' },
            { label: 'App Store', desc: 'Publish, discover & monetize apps' },
            { label: 'x402 / MPP', desc: 'AI-native Stellar micropayments' },
          ].map((f) => (
            <div key={f.label} className="rounded-2xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-panel/50 p-3 shadow-hard-sm">
              <p className="text-[11px] font-extrabold text-ink mb-0.5">{f.label}</p>
              <p className="text-[10px] text-ink-muted leading-tight">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
