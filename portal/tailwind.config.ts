import type { Config } from 'tailwindcss';

// =============================================================================
// The Control Room's tokens.
//
// The portal is the same brand as the site, one altitude lower in temperature:
// the public pages are a climb, this is the instrument panel you fly it with.
// Colours are lifted verbatim from assets/css/main.css so the two never drift;
// everything else on this page exists to make a dense operational screen
// readable, which is a different problem from making a marketing page beautiful.
//
// THREE SURFACES, AND ONLY THREE
// ------------------------------
//   ink    level 0   the page. Near-black, flat, no gradient.
//   deck   level 1   a section. Where a meaningful group of data lives.
//   flare  level 2   an interaction. Hover, selection, an input, an active row.
//
// A section can hold data WITHOUT every figure inside it becoming another card,
// and that is the whole point of stopping at three: when there is nowhere
// further to nest, nesting stops.
// =============================================================================

const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Every colour is a CSS variable (styles.css), so one set of class names
      // serves both themes. Triplets, not hex, so `/40`-style opacity works.
      colors: {
        void: '#000000',

        /** Level 0 — the page. */
        ink: v('ink'),
        /** Level 1 — a section. Two points of light above the page, no more. */
        deck: v('deck'),
        /** Level 1, raised. The executive strip and the command bar only. */
        panel: v('panel'),
        /** Level 2 — interaction. Hover, selected, focused, active row. */
        flare: 'rgb(var(--c-fg) / 0.055)',
        /** An input's well: darker than its section in dark, white in light. */
        field: 'var(--c-field)',

        // Two hairlines, not one. `hair` bounds a section; `hairline` separates
        // rows and cells INSIDE one. A table drawn entirely in `hair` reads as
        // twenty stacked boxes rather than as one table.
        hair: 'rgb(var(--c-fg) / var(--a-hair))',
        hairline: 'rgb(var(--c-fg) / var(--a-hairline))',

        /** The brand yellow as a FILL. Yellow in both themes. */
        signal: v('signal'),
        chrome: v('chrome'),
        paper: v('paper'),
        haze: v('haze'),
        danger: v('danger'),
        good: v('good'),
      },
      // The brand yellow cannot be read as text or a line on a light page, so
      // text, borders, outlines and accents use `--c-signal-ink`: the same
      // yellow in dark, a deep amber in light.
      textColor: { signal: v('signal-ink') },
      borderColor: { signal: v('signal-ink') },
      outlineColor: { signal: v('signal-ink') },
      accentColor: { signal: v('signal-ink') },

      // Aboreto and JetBrains Mono are self-hosted and are actually loaded —
      // see the note in index.html. `Instrument Sans` was replaced by Archivo,
      // the site's own body face, for one reason: nothing could ever serve
      // Instrument Sans here. It came only from the Google Fonts link the CSP
      // blocks, so in production that stack always resolved to `system-ui`.
      //
      // Aboreto is the MARK and nothing else. It draws `STRATOS` in the sidebar
      // and appears nowhere else in the product: a display face on a page title
      // is a brand gesture, and every one of them costs the numbers beside it
      // some of the reader's attention.
      fontFamily: {
        mark: ['Aboreto', 'serif'],
        body: ['Archivo', 'system-ui', 'sans-serif'],
        data: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      // The site is built on hard corners. The portal softens them only enough
      // to read as an interface rather than as a page — and it uses two values,
      // not five: 2px on anything you can press, 4px on anything that contains
      // something else. Nothing in this product is a rounded card.
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        lg: '4px',
      },

      // One shadow, and it is nearly invisible. Depth here comes from the three
      // surfaces above; a drop shadow on every panel is how a dense screen turns
      // into a pile of floating rectangles.
      boxShadow: {
        panel: '0 1px 0 rgb(var(--c-fg) / 0.03) inset',
      },
    },
  },
  plugins: [],
} satisfies Config;
