import { useStore } from './store'
import { LoginPage } from './pages/LoginPage'
import { WorkspacePage } from './pages/WorkspacePage'

export default function App() {
  const isConnected = useStore((s) => s.wallet.isConnected)
  const publicKey = useStore((s) => s.wallet.publicKey)

  if (!isConnected || !publicKey) {
    return <LoginPage />
  }

  return <WorkspacePage />
}
