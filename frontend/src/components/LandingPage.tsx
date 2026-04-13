import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence, useInView, type Variants } from 'framer-motion'
import { useStore } from '@/store'
import { X, Sparkles, Zap, Store, Rocket, ArrowRight, Code2, Wallet, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Animation variants ────────────────────────────────────────────────────
// Ease tuples must be [number, number, number, number] for framer-motion's
// BezierDefinition — inferred number[] doesn't satisfy that constraint.

const SPRING: [number, number, number, number] = [0.22, 1, 0.36, 1]

const OVERLAY_VARIANTS: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
  exit:    { opacity: 0, transition: { duration: 0.2,  ease: 'easeIn'  } },
}

const HERO_CONTAINER: Variants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
}

const FADE_UP: Variants = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: SPRING } },
}

const FADE_UP_SLOW: Variants = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: SPRING } },
}

const SCALE_IN: Variants = {
  hidden:  { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: SPRING } },
}

const CARD_HOVER: Variants = {
  rest:  { y: 0,  scale: 1,    transition: { duration: 0.2, ease: 'easeOut' } },
  hover: { y: -4, scale: 1.01, transition: { duration: 0.2, ease: 'easeOut' } },
}

// ── Section reveal — triggers when 20% of section scrolls into view ────────

function SectionReveal({
  children,
  className,
  stagger = false,
}: {
  children: React.ReactNode
  className?: string
  stagger?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={stagger ? HERO_CONTAINER : undefined}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
    >
      {children}
    </motion.div>
  )
}

// ── AI image placeholder ───────────────────────────────────────────────────

function ImagePlaceholder({
  prompt,
  aspect = 'video',
  className,
}: {
  prompt: string
  aspect?: 'video' | 'square' | 'portrait' | 'wide'
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [prompt])

  const ratios: Record<string, string> = {
    video:   'aspect-video',
    square:  'aspect-square',
    portrait:'aspect-[3/4]',
    wide:    'aspect-[21/9]',
  }

  return (
    <div className={cn(
      'relative rounded-3xl overflow-hidden border border-border bg-bg-elevated group cursor-default',
      ratios[aspect],
      className,
    )}>
      <div className="absolute inset-0 bg-gradient-to-br from-bg-elevated via-bg-surface to-bg-elevated" />
      <div className="absolute inset-0 bg-gradient-to-tr from-accent/5 via-transparent to-transparent" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'var(--tw-bg-grid-dark)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Prompt overlay — hidden by default, revealed on parent hover */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-bg/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <Sparkles size={20} className="text-accent mb-3" />
        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2 text-center">
          AI Image Prompt
        </p>
        <p className="text-[11px] text-ink text-center leading-relaxed mb-4">{prompt}</p>

        <motion.button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors duration-150',
            copied
              ? 'border-status-success/40 bg-status-success/10 text-status-success'
              : 'border-border bg-bg-panel text-ink-muted hover:text-ink hover:border-border-bright',
          )}
          whileTap={{ scale: 0.95 }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied!' : 'Copy prompt'}
        </motion.button>
      </div>

      {/* Default placeholder — shown by default, hidden on parent hover */}
      <div className="absolute inset-0 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-200 pointer-events-none">
        <div className="text-center">
          <div className="w-10 h-10 rounded-2xl border-2 border-dashed border-border flex items-center justify-center mx-auto mb-2">
            <Sparkles size={16} className="text-ink-dim" />
          </div>
          <p className="text-[10px] text-ink-dim">hover for prompt</p>
        </div>
      </div>
    </div>
  )
}

// ── Section label chip ─────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-accent/30 bg-accent/10 text-accent">
      {children}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function LandingPage() {
  const showLanding  = useStore((s) => s.showLanding)
  const setShowLanding = useStore((s) => s.setShowLanding)
  const setShellView = useStore((s) => s.setShellView)

  const handleStartBuilding = () => { setShellView('build'); setShowLanding(false) }
  const handleViewStore     = () => { setShellView('apps');  setShowLanding(false) }

  return (
    <AnimatePresence>
      {showLanding && (
        <motion.div
          key="landing"
          variants={OVERLAY_VARIANTS}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed inset-0 z-50 bg-bg overflow-y-auto"
        >
          {/* ── Background effects ── */}
          <div className="fixed inset-0 pointer-events-none overflow-hidden">
            <motion.div
              className="absolute inset-0 opacity-[0.035]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.035 }}
              transition={{ duration: 1.2 }}
              style={{
                backgroundImage: 'linear-gradient(rgba(232,48,48,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(232,48,48,0.6) 1px, transparent 1px)',
                backgroundSize: '60px 60px',
              }}
            />
            <motion.div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full blur-[120px]"
              style={{ background: 'rgba(232,48,48,0.07)' }}
              animate={{ scale: [1, 1.06, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-[100px]"
              style={{ background: 'rgba(232,48,48,0.04)' }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
            />
          </div>

          {/* ── Close button ── */}
          <motion.button
            onClick={() => setShowLanding(false)}
            className="fixed top-4 right-4 z-50 w-9 h-9 flex items-center justify-center rounded-full border border-border bg-bg-panel text-ink-muted hover:text-ink hover:border-border-bright transition-colors shadow-hard"
            initial={{ opacity: 0, scale: 0.8, y: -8 }}
            animate={{ opacity: 1, scale: 1,   y: 0   }}
            transition={{ delay: 0.3, duration: 0.3, ease: 'backOut' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <X size={15} />
          </motion.button>

          <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">

            {/* ══════════════════════════════════════════════════════ HERO */}
            <motion.section
              className="text-center mb-24"
              variants={HERO_CONTAINER}
              initial="hidden"
              animate="visible"
            >
              {/* Logo lockup */}
              <motion.div
                className="flex items-center justify-center gap-3 mb-8"
                variants={FADE_UP}
              >
                <motion.div
                  className="w-16 h-16 rounded-3xl overflow-hidden shadow-hard border border-border"
                  whileHover={{ rotate: [0, -4, 4, 0], transition: { duration: 0.4 } }}
                >
                  <img src="/logo.png" alt="MagicWand" className="w-full h-full object-cover" />
                </motion.div>
                <span className="text-4xl font-black text-ink tracking-tight">
                  Magic<span className="text-accent">Wand</span>
                </span>
              </motion.div>

              <motion.div variants={FADE_UP}>
                <Label><Sparkles size={10} /> Agentic Stellar App Builder</Label>
              </motion.div>

              <motion.h1
                className="mt-6 text-[56px] md:text-[72px] font-black text-ink leading-[1.05] tracking-tight"
                variants={FADE_UP}
              >
                Build. Deploy.{' '}
                <motion.span
                  className="text-accent inline-block"
                  style={{ textShadow: '0 0 40px rgba(232,48,48,0.4)' }}
                  animate={{ textShadow: ['0 0 30px rgba(232,48,48,0.3)', '0 0 55px rgba(232,48,48,0.6)', '0 0 30px rgba(232,48,48,0.3)'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  Ship.
                </motion.span>
              </motion.h1>

              <motion.p
                className="mt-5 text-[18px] text-ink-muted max-w-xl mx-auto leading-relaxed"
                variants={FADE_UP}
              >
                Describe your Soroban smart contract in plain English. MagicWand's AI agent
                writes, builds, tests, and deploys it — then publishes a polished frontend
                app to the App Store.
              </motion.p>

              <motion.div
                className="mt-8 flex items-center justify-center gap-3"
                variants={FADE_UP}
              >
                <motion.button
                  onClick={handleStartBuilding}
                  className="btn-accent text-sm px-6 py-3 rounded-full"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Start Building <ArrowRight size={15} />
                </motion.button>
                <motion.button
                  onClick={handleViewStore}
                  className="btn-outline text-sm px-6 py-3 rounded-full"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Store size={14} /> Browse App Store
                </motion.button>
              </motion.div>

              {/* Hero image */}
              <motion.div className="mt-14 max-w-4xl mx-auto" variants={SCALE_IN}>
                <ImagePlaceholder
                  aspect="video"
                  prompt="Rubberhose style animated scene: a cartoon wizard character (thick outlines, round limbs, cream/warm-white color) wielding a glowing red magic wand at a holographic terminal screen floating in mid-air. The screen shows Rust code and a Stellar blockchain diagram. Background: very dark warm charcoal (#120e0a) with a subtle red grid. Bold cartoon shadows, retro-modern aesthetic. Character has big expressive eyes. Style: Cuphead / 1930s rubber hose animation meets cyberpunk. Cinematic wide crop."
                  className="shadow-[0_40px_100px_rgba(0,0,0,0.6)] rounded-3xl"
                />
              </motion.div>
            </motion.section>

            {/* ══════════════════════════════════════════ HOW IT WORKS */}
            <section className="mb-24">
              <SectionReveal className="text-center mb-12" stagger>
                <motion.div variants={FADE_UP}>
                  <Label><Zap size={10} /> How it works</Label>
                </motion.div>
                <motion.h2
                  className="mt-4 text-4xl font-black text-ink tracking-tight"
                  variants={FADE_UP}
                >
                  Three steps to shipped
                </motion.h2>
              </SectionReveal>

              <SectionReveal
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
                stagger
              >
                {HOW_IT_WORKS_CARDS.map(({ step, icon: Icon, title, body, prompt }) => (
                  <motion.div
                    key={step}
                    variants={FADE_UP_SLOW}
                    initial="rest"
                    whileHover="hover"
                    animate="rest"
                    className="relative rounded-3xl border border-border bg-bg-panel p-6 shadow-hard overflow-hidden flex flex-col gap-5"
                  >
                    <motion.div variants={CARD_HOVER} className="contents">
                      <span className="absolute top-4 right-5 text-[64px] font-black text-ink/[0.03] leading-none select-none">
                        {step}
                      </span>
                      <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                        <Icon size={18} className="text-accent" />
                      </div>
                      <div>
                        <h3 className="text-lg font-extrabold text-ink mb-1">{title}</h3>
                        <p className="text-[13px] text-ink-muted leading-relaxed">{body}</p>
                      </div>
                      <ImagePlaceholder aspect="square" prompt={prompt} className="mt-auto" />
                    </motion.div>
                  </motion.div>
                ))}
              </SectionReveal>
            </section>

            {/* ════════════════════════════════════════════════ FEATURES */}
            <section className="mb-24">
              <SectionReveal className="text-center mb-12" stagger>
                <motion.div variants={FADE_UP}>
                  <Label><Zap size={10} /> Features</Label>
                </motion.div>
                <motion.h2
                  className="mt-4 text-4xl font-black text-ink tracking-tight"
                  variants={FADE_UP}
                >
                  Everything you need
                </motion.h2>
                <motion.p
                  className="mt-3 text-[15px] text-ink-muted max-w-lg mx-auto"
                  variants={FADE_UP}
                >
                  A full-stack Stellar development platform — from AI agent to App Store.
                </motion.p>
              </SectionReveal>

              <SectionReveal className="grid grid-cols-1 md:grid-cols-2 gap-6" stagger>
                {FEATURE_CARDS.map(({ icon: Icon, title, body, wide, prompt }) => (
                  <motion.div
                    key={title}
                    variants={FADE_UP_SLOW}
                    initial="rest"
                    whileHover="hover"
                    animate="rest"
                    className={cn(
                      'rounded-3xl border border-border bg-bg-panel p-6 shadow-hard flex flex-col gap-5',
                      wide && 'md:col-span-2',
                    )}
                  >
                    <motion.div variants={CARD_HOVER} className="contents">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                          <Icon size={18} className="text-accent" />
                        </div>
                        <div>
                          <h3 className="text-lg font-extrabold text-ink mb-1">{title}</h3>
                          <p className="text-[13px] text-ink-muted leading-relaxed max-w-lg">{body}</p>
                        </div>
                      </div>
                      <ImagePlaceholder aspect={wide ? 'wide' : 'video'} prompt={prompt} />
                    </motion.div>
                  </motion.div>
                ))}
              </SectionReveal>
            </section>

            {/* ════════════════════════════════════════════════ STATS */}
            <SectionReveal className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-24" stagger>
              {STATS.map(({ value, label }) => (
                <motion.div
                  key={label}
                  variants={FADE_UP}
                  className="rounded-3xl border border-border bg-bg-panel p-6 text-center shadow-hard-sm"
                  whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
                >
                  <p className="text-2xl font-black text-accent mb-1">{value}</p>
                  <p className="text-[12px] text-ink-muted">{label}</p>
                </motion.div>
              ))}
            </SectionReveal>

            {/* ═════════════════════════════════════════════════ CTA */}
            <SectionReveal>
              <motion.section
                variants={SCALE_IN}
                className="relative rounded-3xl overflow-hidden border border-accent/25 bg-gradient-to-br from-bg-panel via-bg-surface to-bg-panel p-12 text-center"
                style={{ boxShadow: '0 0 80px rgba(232,48,48,0.12)' }}
              >
                <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
                <motion.div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[200px] rounded-full blur-[80px] pointer-events-none"
                  style={{ background: 'rgba(232,48,48,0.08)' }}
                  animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                />

                <div className="relative z-10">
                  <h2 className="text-4xl font-black text-ink mb-3">
                    Ready to build something{' '}
                    <span className="text-accent">magic</span>?
                  </h2>
                  <p className="text-[15px] text-ink-muted mb-8 max-w-md mx-auto">
                    Connect your Freighter wallet and start generating Stellar smart contracts
                    in minutes.
                  </p>
                  <div className="flex items-center justify-center gap-4">
                    <motion.button
                      onClick={handleStartBuilding}
                      className="btn-accent text-sm px-8 py-3 rounded-full"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      Open the Builder <ArrowRight size={15} />
                    </motion.button>
                    <motion.button
                      onClick={handleViewStore}
                      className="btn-outline text-sm px-8 py-3 rounded-full"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <Store size={14} /> App Store
                    </motion.button>
                  </div>
                </div>
              </motion.section>
            </SectionReveal>

            <div className="h-16" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Static data ────────────────────────────────────────────────────────────

const HOW_IT_WORKS_CARDS = [
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
] as const

const FEATURE_CARDS = [
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
] as const

const STATS = [
  { value: '< 5 min', label: 'Contract to deploy'  },
  { value: 'x402',    label: 'Native micropayments' },
  { value: 'Testnet + Mainnet', label: 'Stellar networks' },
  { value: 'Open',    label: 'App Store'             },
] as const
