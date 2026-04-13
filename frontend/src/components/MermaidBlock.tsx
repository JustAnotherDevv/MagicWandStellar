import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

// Module-level counter — guarantees a fresh ID on every render attempt,
// including React Strict Mode's double-invoke of effects.
let _seq = 0

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  themeVariables: {
    background: '#0d0d0d',
    primaryColor: '#f07318',
    primaryTextColor: '#e8e8e8',
    primaryBorderColor: '#f07318',
    lineColor: '#555',
    secondaryColor: '#1a1a1a',
    tertiaryColor: '#222',
    edgeLabelBackground: '#1a1a1a',
    nodeTextColor: '#e8e8e8',
    clusterBkg: '#1a1a1a',
    titleColor: '#e8e8e8',
  },
  flowchart: { curve: 'basis', htmlLabels: true },
})

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let cancelled = false
    // Fresh unique ID every time — avoids "duplicate element id" errors on
    // re-render and React Strict Mode double-effect invocation.
    const id = `mm${++_seq}`

    mermaid
      .render(id, code.trim())
      .then(({ svg }) => {
        if (cancelled || !el.isConnected) return
        el.innerHTML = svg
        const svgEl = el.querySelector('svg')
        if (svgEl) {
          svgEl.removeAttribute('height')
          svgEl.style.maxWidth = '100%'
          svgEl.style.height = 'auto'
        }
      })
      .catch(() => {
        if (cancelled || !el.isConnected) return
        // Graceful fallback — show the raw source
        el.innerHTML = `<pre style="color:#888;font-size:11px;white-space:pre-wrap;padding:0">${code}</pre>`
      })

    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto rounded border border-white/[0.06] bg-bg-panel p-4"
      style={{ minHeight: '80px' }}
    />
  )
}
