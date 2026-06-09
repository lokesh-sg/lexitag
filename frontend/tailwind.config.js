/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm studio palette — charcoal and slate
        surface: {
          0:   '#111113',  // deepest background
          1:   '#18181b',  // page bg
          2:   '#1f1f23',  // elevated cards
          3:   '#27272c',  // raised elements
          4:   '#303036',  // hover states
          5:   '#3a3a42',  // borders, dividers
        },
        // Text hierarchy
        ink: {
          rich:    '#f0ece4',  // primary text, warm white
          normal:  '#b8b2a7',  // secondary
          muted:   '#7d7870',  // tertiary
          faint:   '#514d47',  // disabled
        },
        // Accent — warm amber/gold (vacuum tube glow)
        amber: {
          50:  '#fef7ec',
          100: '#fceacc',
          200: '#f9d48e',
          300: '#f5b642',
          400: '#e99e1a',
          500: '#d4860e',
          600: '#a8640a',
          700: '#7b4a0c',
          800: '#553510',
          900: '#382410',
        },
        // Secondary accent — warm copper
        copper: {
          300: '#d4a574',
          400: '#c08a55',
          500: '#a06e3c',
          600: '#7d5530',
        },
        // Functional colors
        fn: {
          danger:  '#c5524b',
          success: '#5a9a6b',
          warn:    '#c9943e',
          info:    '#6b8fad',
        },
      },
      fontFamily: {
        sans:    ['InterVariable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'up-sm':  '0 -1px 3px rgba(0,0,0,.25)',
        'inner-glow': 'inset 0 1px 0 rgba(240,236,228,.04)',
        'card':   '0 1px 3px rgba(0,0,0,.3), 0 0 0 1px rgba(255,255,255,.03)',
        'elevated': '0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.03)',
      },
      animation: {
        'slide-up':     'slideUp 0.25s ease-out',
        'fade-in':      'fadeIn 0.15s ease-out',
        'spin-slow':    'spin 1.5s linear infinite',
        'bar-fill':     'barFill 0.6s ease-out forwards',
      },
      keyframes: {
        slideUp: {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        barFill: {
          '0%':   { width: '0%' },
          '100%': { width: 'var(--bar-to)' },
        },
      },
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};
