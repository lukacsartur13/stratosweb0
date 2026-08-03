import type { Config } from 'tailwindcss';

// The portal is the same brand as the site, one altitude lower in temperature:
// the public pages are a climb, this is the instrument panel you fly it with.
// Tokens are lifted verbatim from assets/css/main.css so the two never drift.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#000000',
        ink: '#0B0F16',
        deck: '#111823',
        panel: '#161F2C',
        hair: 'rgba(244,244,244,0.10)',
        signal: '#FFEE25',
        chrome: '#CBDCE9',
        paper: '#F4F4F4',
        haze: '#8A98A8',
        danger: '#FF5A47',
        good: '#3ECf8E',
      },
      fontFamily: {
        display: ['Aboreto', 'serif'],
        body: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        data: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        // The site is built on hard corners. The portal softens them only
        // enough to read as an interface rather than a page.
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        lg: '8px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(244,244,244,0.04) inset, 0 12px 32px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
} satisfies Config;
