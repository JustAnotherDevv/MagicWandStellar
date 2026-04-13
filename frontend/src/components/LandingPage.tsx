import { useStore } from '@/store'
import { X, Sparkles, Zap, Store, Rocket, ArrowRight, Code2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/* ─── AI Image Prompt Helper ──────────────────────────────────────────────── */

function ImagePlaceholder({
  prompt,
  aspect = 'video',
  className,
}: {
  prompt: string
  aspect?: 'video' | 'square' | 'portrait' | 'wide'
  className?: string
}) {
  const ratios: Record<string, string> = {
    video:   'aspect-video',
    square:  'aspect-square',
    portrait:'aspect-[3/4]',
    wide:    'aspect-[21/9]',
  }
  return (
    <div className={cn(
      'relative rounded-3xl overflow-hidden border-2 border-[rgba(245,234,216,0.10)] bg-bg-elevated group',
      ratios[aspect],
      className,
    )}>
      {/* Shimmer gradient placeholder */}
      <div className="absolute inset-0 bg-gradient-to-br from-bg-elevated via-bg-surface to-bg-elevated" />
      <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 via-transparent to-transparent" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(232,48,48,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(232,48,48,0.8) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Prompt overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-bg/80 backdrop-blur-sm">
        <Sparkles size={20} className="text-accent mb-3" />
        <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-2 text-center">AI Image Prompt</p>
        <p className="text-[11px] text-ink text-center leading-relaxed">{prompt}</p>
      </div>

      {/* Default state label */}
      <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-200">
        <div className="text-center">
          <div className="w-10 h-10 rounded-2xl border-2 border-dashed border-[rgba(245,234,216,0.15)] flex items-center justify-center mx-auto mb-2">
            <Sparkles size={16} className="text-ink-dim" />
          </div>
          <p className="text-[10px] text-ink-dim">hover for prompt</p>
        </div>
      </div>
    </div>
  )
}

/* ─── Section label ───────────────────────────────────────────────────────── */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border-2 border-accent/30 bg-accent/10 text-accent">
      {children}
    </span>
  )
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export function LandingPage() {
  const showLanding = useStore((s) => s.showLanding)
  const setShowLanding = useStore((s) => s.setShowLanding)
  const setShellView = useStore((s) => s.setShellView)

  if (!showLanding) return null

  const handleStartBuilding = () => {
    setShellView('build')
    setShowLanding(false)
  }

  const handleViewStore = () => {
    setShellView('apps')
    setShowLanding(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg overflow-y-auto">

      {/* ── Background effects ── */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Red grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'linear-gradient(rgba(232,48,48,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(232,48,48,0.6) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        {/* Glow top-center */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-accent/8 rounded-full blur-[120px]" />
        {/* Glow bottom-left */}
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent/5 rounded-full blur-[100px]" />
      </div>

      {/* ── Close button ── */}
      <button
        onClick={() => setShowLanding(false)}
        className="fixed top-4 right-4 z-50 w-9 h-9 flex items-center justify-center rounded-full border-2 border-[rgba(245,234,216,0.15)] bg-bg-panel text-ink-muted hover:text-ink hover:border-[rgba(245,234,216,0.30)] transition-colors shadow-hard"
      >
        <X size={15} />
      </button>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">

        {/* ═══════════════════════════════════════════════════════ HERO */}
        <section className="text-center mb-24">

          {/* Logo lockup */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-16 h-16 rounded-3xl overflow-hidden shadow-hard border-2 border-[rgba(245,234,216,0.15)]">
              <img src="/logo.png" alt="MagicWand" className="w-full h-full object-cover" />
            </div>
            <span className="text-4xl font-black text-ink tracking-tight">
              Magic<span className="text-accent">Wand</span>
            </span>
          </div>

          <Label><Sparkles size={10} /> Agentic Stellar App Builder</Label>

          <h1 className="mt-6 text-[56px] md:text-[72px] font-black text-ink leading-[1.05] tracking-tight">
            Build. Deploy.{' '}
            <span className="text-accent" style={{ textShadow: '0 0 40px rgba(232,48,48,0.4)' }}>
              Ship.
            </span>
          </h1>

          <p className="mt-5 text-[18px] text-ink-muted max-w-xl mx-auto leading-relaxed">
            Describe your Soroban smart contract in plain English. MagicWand's AI agent writes, builds, tests, and deploys it — then publishes a polished frontend app to the App Store.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              onClick={handleStartBuilding}
              className="btn-accent text-sm px-6 py-3 rounded-full"
            >
              Start Building <ArrowRight size={15} />
            </button>
            <button
              onClick={handleViewStore}
              className="btn-outline text-sm px-6 py-3 rounded-full"
            >
              <Store size={14} /> Browse App Store
            </button>
          </div>

          {/* HERO IMAGE — large, takes center stage */}
          <div className="mt-14 max-w-4xl mx-auto">
            <ImagePlaceholder
              aspect="video"
              prompt="Rubberhose style animated scene: a cartoon wizard character (thick outlines, round limbs, cream/warm-white color) wielding a glowing red magic wand at a holographic terminal screen floating in mid-air. The screen shows Rust code and a Stellar blockchain diagram. Background: very dark warm charcoal (#120e0a) with a subtle red grid. Bold cartoon shadows, retro-modern aesthetic. Character has big expressive eyes. Style: Cuphead / 1930s rubber hose animation meets cyberpunk. Cinematic wide crop."
              className="shadow-[0_40px_100px_rgba(0,0,0,0.6),0_0_0_1px_rgba(245,234,216,0.08)] rounded-3xl"
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ HOW IT WORKS */}
        <section className="mb-24">
          <div className="text-center mb-12">
            <Label><Zap size={10} /> How it works</Label>
            <h2 className="mt-4 text-4xl font-black text-ink tracking-tight">Three steps to shipped</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                icon: Code2,
                title: 'Describe',
                body: 'Type what your contract should do. The AI agent understands Soroban, Stellar primitives, and DeFi patterns out of the box.',
                prompt: 'Rubberhose cartoon: a happy round-limbed character typing on a glowing keyboard, speech bubble shows "Build me a token contract". Warm dark bg, cream character, red accent highlights. Bold outlines, 1930s animation style.',
              },
              {
                step: '02',
                icon: Sparkles,
                title: 'Build',
                body: 'The agent writes Rust, runs cargo tests, fixes errors, and deploys to testnet — all autonomously while you watch in real time.',
                prompt: 'Rubberhose cartoon: a tiny robot with a wrench inside a glowing terminal screen, surrounded by Rust code snippets and floating gears. Green checkmarks pop out as tests pass. Dark warm background, cream robot, red sparks.',
              },
              {
                step: '03',
                icon: Rocket,
                title: 'Ship',
                body: 'Publish your app to the MagicWand App Store. Add a name, description, and logo — your Stellar dApp is live instantly.',
                prompt: 'Rubberhose cartoon: a rocket ship (cream colored, thick outlines, round shapes) blasting off into a starfield shaped like the Stellar logo constellation. Red rocket flames, dark warm background, floating stars and planets.',
              },
            ].map(({ step, icon: Icon, title, body, prompt }) => (
              <div
                key={step}
                className="relative rounded-3xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-panel p-6 shadow-hard overflow-hidden flex flex-col gap-5"
              >
                {/* Step number watermark */}
                <span className="absolute top-4 right-5 text-[64px] font-black text-[rgba(245,234,216,0.04)] leading-none select-none">
                  {step}
                </span>

                <div className="w-10 h-10 rounded-2xl bg-accent/10 border-2 border-accent/25 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-accent" />
                </div>

                <div>
                  <h3 className="text-lg font-extrabold text-ink mb-1">{title}</h3>
                  <p className="text-[13px] text-ink-muted leading-relaxed">{body}</p>
                </div>

                <ImagePlaceholder aspect="square" prompt={prompt} className="mt-auto" />
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ FEATURES */}
        <section className="mb-24">
          <div className="text-center mb-12">
            <Label><Zap size={10} /> Features</Label>
            <h2 className="mt-4 text-4xl font-black text-ink tracking-tight">Everything you need</h2>
            <p className="mt-3 text-[15px] text-ink-muted max-w-lg mx-auto">
              A full-stack Stellar development platform — from AI agent to App Store.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                icon: Sparkles,
                title: 'AI Contract Agent',
                body: 'Powered by frontier models with deep Soroban knowledge. The agent understands Stellar-specific patterns: token interfaces, storage TTLs, cross-contract calls, and more.',
                wide: false,
                prompt: 'Rubberhose cartoon: a wizard AI assistant sitting at a giant floating chat interface. The screen shows a conversation: "Build a multi-sig wallet" → glowing Rust code appears. Character has a pointy hat and expressive cartoon eyes. Dark warm bg, cream and red palette.',
              },
              {
                icon: Zap,
                title: 'x402 & MPP Payments',
                body: 'Built-in support for HTTP 402 micropayments and Multi-Party Payments on Stellar. Your contracts can monetize AI API calls natively.',
                wide: false,
                prompt: 'Rubberhose cartoon: two cute cartoon characters exchanging glowing XLM coins between them via a lightning-bolt beam. The Stellar logo floats between them. Dark bg, cream characters, bold red/yellow lightning. Retro energy.',
              },
              {
                icon: Store,
                title: 'App Store',
                body: 'Publish your contract and frontend as a discoverable app. Browse, like, and open any published app directly in the browser. Each app gets its own runtime and shareable link.',
                wide: true,
                prompt: 'Rubberhose style: an animated storefront with a glowing red awning that reads "MagicWand App Store". Cute cartoon apps (as small characters with faces) line up outside waiting to get published. Fun, retro, energetic scene. Dark bg, cream and red palette, thick bold outlines.',
              },
              {
                icon: Wallet,
                title: 'Freighter Native',
                body: 'Connect with Freighter wallet in one click. All deployments and transactions are signed by your key — the platform never holds your funds.',
                wide: false,
                prompt: 'Rubberhose cartoon: a friendly cartoon wallet character (Freighter logo style) opening its flap to reveal glowing Stellar tokens inside. The wallet has eyes and a smile. Dark bg, cream wallet, red accent glow, retro-modern style.',
              },
              {
                icon: Code2,
                title: 'Live Code View',
                body: 'Watch the agent write code in real time with a typewriter reveal animation. Edit any file, trigger builds and test runs directly from the browser.',
                wide: false,
                prompt: 'Rubberhose cartoon: a tiny cartoon character literally running across lines of Rust code on a giant monitor screen, underlining each line with a glowing red marker as it types. Code scrolls and compiles in real time. Dark terminal bg, cream character, red highlights.',
              },
            ].map(({ icon: Icon, title, body, wide, prompt }) => (
              <div
                key={title}
                className={cn(
                  'rounded-3xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-panel p-6 shadow-hard flex flex-col gap-5',
                  wide && 'md:col-span-2',
                )}
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-accent/10 border-2 border-accent/25 flex items-center justify-center shrink-0">
                    <Icon size={18} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-ink mb-1">{title}</h3>
                    <p className="text-[13px] text-ink-muted leading-relaxed max-w-lg">{body}</p>
                  </div>
                </div>
                <ImagePlaceholder
                  aspect={wide ? 'wide' : 'video'}
                  prompt={prompt}
                />
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ STATS ROW */}
        <section className="mb-24">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { value: '< 5 min', label: 'Contract to deploy' },
              { value: 'x402', label: 'Native micropayments' },
              { value: 'Testnet + Mainnet', label: 'Stellar networks' },
              { value: 'Open', label: 'App Store' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="rounded-3xl border-2 border-[rgba(245,234,216,0.10)] bg-bg-panel p-6 text-center shadow-hard-sm"
              >
                <p className="text-2xl font-black text-accent mb-1">{value}</p>
                <p className="text-[12px] text-ink-muted">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════ CTA */}
        <section className="relative rounded-3xl overflow-hidden border-2 border-accent/25 bg-gradient-to-br from-bg-panel via-bg-surface to-bg-panel shadow-[0_0_80px_rgba(232,48,48,0.15)] p-12 text-center">
          {/* Accent glow */}
          <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[200px] bg-accent/10 rounded-full blur-[80px] pointer-events-none" />

          <div className="relative z-10">
            <h2 className="text-4xl font-black text-ink mb-3">
              Ready to build something{' '}
              <span className="text-accent">magic</span>?
            </h2>
            <p className="text-[15px] text-ink-muted mb-8 max-w-md mx-auto">
              Connect your Freighter wallet and start generating Stellar smart contracts in minutes.
            </p>

            <div className="flex items-center justify-center gap-4">
              {/* GIF placeholder — this is the best spot for a looping demo GIF */}
              <div className="absolute inset-0 opacity-0 pointer-events-none" aria-hidden>
                {/* TODO: place a looping rubberhose GIF here once generated */}
              </div>
              <button onClick={handleStartBuilding} className="btn-accent text-sm px-8 py-3 rounded-full">
                Open the Builder <ArrowRight size={15} />
              </button>
              <button onClick={handleViewStore} className="btn-outline text-sm px-8 py-3 rounded-full">
                <Store size={14} /> App Store
              </button>
            </div>
          </div>
        </section>

        {/* Bottom padding */}
        <div className="h-16" />
      </div>
    </div>
  )
}
