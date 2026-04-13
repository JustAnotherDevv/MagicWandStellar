import { useStore } from '@/store'
import { shortKey, networkBadgeClass } from '@/lib/utils'
import { disconnectWallet } from '@/lib/stellar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { LogOut, Activity } from 'lucide-react'

export function TopBar() {
  const wallet = useStore((s) => s.wallet)
  const setWallet = useStore((s) => s.setWallet)
  const chat = useStore((s) => s.chat)
  const shellView = useStore((s) => s.shellView)
  const setShellView = useStore((s) => s.setShellView)
  const setShowLanding = useStore((s) => s.setShowLanding)

  const handleDisconnect = () => {
    disconnectWallet()
    setWallet({ publicKey: null, isConnected: false })
  }

  return (
    <header className="h-12 flex items-center px-4 gap-3 border-b-2 border-[rgba(245,234,216,0.10)] bg-bg-panel shrink-0">
      {/* Logo — click to open landing page */}
      <button
        onClick={() => setShowLanding(true)}
        className="flex items-center gap-2 mr-2 hover:opacity-80 transition-opacity duration-100"
      >
        <img src="/logo.png" alt="MagicWand" className="w-7 h-7 rounded-full object-cover shadow-hard-sm" />
        <span className="text-[14px] font-extrabold text-ink tracking-tight">
          Magic<span className="text-accent">Wand</span>
        </span>
      </button>

      <div className="flex-1" />

      <div className="rounded-full border border-white/[0.14] bg-[#15131c] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_6px_18px_rgba(0,0,0,0.35)] flex items-center gap-1">
        <button
          onClick={() => setShellView('build')}
          className={[
            'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-150',
            shellView === 'build'
              ? 'text-ink bg-gradient-to-b from-[#ffe0a8] to-[#d38f3c] shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.45)]'
              : 'text-ink-muted hover:text-ink bg-transparent',
          ].join(' ')}
        >
          Current Build
        </button>
        <button
          onClick={() => setShellView('apps')}
          className={[
            'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all duration-150',
            shellView === 'apps'
              ? 'text-ink bg-gradient-to-b from-[#ffd0d0] to-[#d95757] shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.45)]'
              : 'text-ink-muted hover:text-ink bg-transparent',
          ].join(' ')}
        >
          Apps
        </button>
      </div>

      {/* Streaming indicator */}
      {chat.isStreaming && (
        <div className="flex items-center gap-1.5 text-[11px] text-accent">
          <Activity size={11} className="animate-pulse" />
          <span>streaming</span>
        </div>
      )}

      {/* Token usage */}
      {chat.usage && !chat.isStreaming && (
        <span className="text-[11px] text-ink-muted">
          {(chat.usage.inputTokens + chat.usage.outputTokens).toLocaleString()} tokens
        </span>
      )}

      {/* Network badge */}
      {wallet.isConnected && (
        <Badge variant={wallet.network === 'mainnet' ? 'success' : 'warning'} className="capitalize">
          {wallet.network}
        </Badge>
      )}

      {/* Wallet */}
      {wallet.isConnected && wallet.publicKey && (
        <Tooltip content={wallet.publicKey} side="bottom">
          <span className="text-[11px] font-mono text-ink-muted bg-bg-elevated px-2 py-1 rounded border border-white/[0.06]">
            {shortKey(wallet.publicKey)}
          </span>
        </Tooltip>
      )}

      {wallet.isConnected && (
        <Tooltip content="Disconnect wallet" side="bottom">
          <Button variant="ghost" size="icon" onClick={handleDisconnect} className="w-7 h-7">
            <LogOut size={13} />
          </Button>
        </Tooltip>
      )}
    </header>
  )
}
