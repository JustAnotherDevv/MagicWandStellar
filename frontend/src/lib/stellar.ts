// Freighter wallet integration
// https://docs.freighter.app/docs/guide/usingFreighterBrowser

let freighterApi: typeof import('@stellar/freighter-api') | null = null

async function getFreighter() {
  if (!freighterApi) {
    freighterApi = await import('@stellar/freighter-api')
  }
  return freighterApi
}

export interface WalletState {
  isInstalled: boolean
  isConnected: boolean
  publicKey: string | null
  network: string | null
  error: string | null
}

export async function checkWallet(): Promise<WalletState> {
  try {
    const f = await getFreighter()
    const { isConnected } = await f.isConnected()
    if (!isConnected) {
      return { isInstalled: true, isConnected: false, publicKey: null, network: null, error: null }
    }
    const { address } = await f.getAddress()
    const { network } = await f.getNetwork()
    return {
      isInstalled: true,
      isConnected: true,
      publicKey: address || null,
      network: network?.toLowerCase() || 'testnet',
      error: null,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // Freighter not installed
    if (msg.includes('not installed') || msg.includes('undefined')) {
      return { isInstalled: false, isConnected: false, publicKey: null, network: null, error: null }
    }
    return { isInstalled: true, isConnected: false, publicKey: null, network: null, error: msg }
  }
}

export async function connectWallet(): Promise<{ publicKey: string; network: string }> {
  const f = await getFreighter()
  const { error: accessError } = await f.requestAccess()
  if (accessError) throw new Error(accessError)
  const { address, error } = await f.getAddress()
  if (error) throw new Error(error)
  const { network } = await f.getNetwork()
  return { publicKey: address, network: network?.toLowerCase() || 'testnet' }
}

export async function disconnectWallet(): Promise<void> {
  // Freighter doesn't have a disconnect API — clear local state only
}

/** Async check — uses message passing so it works even if window.freighter hasn't injected yet */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const f = await getFreighter()
    const { isConnected } = await f.isConnected()
    return isConnected
  } catch {
    return false
  }
}
