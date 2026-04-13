import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        // Rubberhose palette — warm charcoal + cream + bold red
        bg: {
          DEFAULT: '#120e0a',
          panel:   '#1c1510',
          surface: '#261c15',
          elevated:'#312318',
          hover:   '#3d2c1e',
        },
        border: {
          DEFAULT: 'rgba(245,234,216,0.15)',
          bright:  'rgba(245,234,216,0.30)',
          accent:  'rgba(232,48,48,0.50)',
        },
        accent: {
          DEFAULT: '#e83030',
          bright:  '#ff5252',
          dim:     'rgba(232,48,48,0.12)',
          glow:    'rgba(232,48,48,0.25)',
        },
        ink: {
          DEFAULT: '#f5ead8',
          muted:   '#8a7060',
          dim:     '#4a3828',
        },
        status: {
          success: '#2ec95a',
          error:   '#e83030',
          warning: '#f5c518',
          info:    '#4ab5d4',
        },
      },
      borderRadius: {
        DEFAULT: '10px',
        sm:  '6px',
        md:  '10px',
        lg:  '14px',
        xl:  '18px',
        '2xl': '24px',
        '3xl': '32px',
      },
      backgroundImage: {
        'grid-dark': `
          linear-gradient(rgba(232,48,48,0.04) 1px, transparent 1px),
          linear-gradient(to right, rgba(232,48,48,0.04) 1px, transparent 1px)
        `,
      },
      backgroundSize: {
        'grid-sm': '24px 24px',
        'grid-md': '40px 40px',
      },
      boxShadow: {
        'accent-glow': '0 0 20px rgba(232,48,48,0.25)',
        'hard':        '4px 4px 0px rgba(18,10,6,0.85)',
        'hard-sm':     '2px 2px 0px rgba(18,10,6,0.85)',
        'panel':       '0 0 0 2px rgba(245,234,216,0.10)',
        'inset-top':   'inset 0 1px 0 rgba(245,234,216,0.08)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn 0.15s ease-out',
        'slide-up':   'slideUp 0.2s ease-out',
        'shimmer':    'shimmer 1.5s infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
