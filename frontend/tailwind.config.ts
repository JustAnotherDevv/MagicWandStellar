import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // UE5-inspired palette
        bg: {
          DEFAULT: '#080809',
          panel: '#0e0e10',
          surface: '#161618',
          elevated: '#1e1e21',
          hover: '#242428',
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          bright: 'rgba(255,255,255,0.12)',
          accent: 'rgba(240,120,30,0.35)',
        },
        accent: {
          DEFAULT: '#f07318',
          bright: '#ff8c35',
          dim: 'rgba(240,115,24,0.12)',
          glow: 'rgba(240,115,24,0.25)',
        },
        ink: {
          DEFAULT: '#d0d0d2',
          muted: '#6b6b70',
          dim: '#38383e',
        },
        status: {
          success: '#3db86a',
          error: '#e05252',
          warning: '#d4a020',
          info: '#4a9fd4',
        },
      },
      backgroundImage: {
        'grid-dark': `
          linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
          linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)
        `,
      },
      backgroundSize: {
        'grid-sm': '24px 24px',
        'grid-md': '40px 40px',
      },
      boxShadow: {
        'accent-glow': '0 0 20px rgba(240,115,24,0.2)',
        'panel': '0 0 0 1px rgba(255,255,255,0.06)',
        'inset-top': 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'shimmer': 'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
