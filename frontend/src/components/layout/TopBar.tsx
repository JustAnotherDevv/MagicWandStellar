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

  const handleDisconnect = () => {
    disconnectWallet()
    setWallet({ publicKey: null, isConnected: false })
  }

  return (
    <header className="h-11 flex items-center px-4 gap-3 border-b border-white/[0.06] bg-bg-panel shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <img src="/logo.png" alt="MagicWand" className="w-6 h-6 rounded object-cover" />
        <span className="text-[13px] font-semibold text-ink tracking-tight">
          Magic<span className="text-accent">Wand</span>
        </span>
      </div>

      <div className="flex-1" />

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
