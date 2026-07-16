import type { Config } from 'tailwindcss';

/**
 * Corporate palette + severity semantics (red/orange/yellow/blue/grey).
 * All severity colors meet WCAG 2.1 AA contrast on their paired backgrounds.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9ecff',
          500: '#1466b8',
          600: '#0f528f',
          700: '#0c4173',
          900: '#082c4d',
        },
        severity: {
          critical: '#b91c1c',
          high: '#c2570a',
          medium: '#a16207',
          low: '#1d4ed8',
          info: '#4b5563',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
