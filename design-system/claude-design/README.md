# Claude Design

A warm, quiet design system: ivory surfaces, clay accent, sans for interface and serif for reading. Framework-agnostic — plain CSS custom properties at the core, with a JS export and a Tailwind preset for stacks that need them.

Open `preview/index.html` in a browser. That page is the specification; everything below is how to use it.

```bash
open design-system/claude-design/preview/index.html
```

---

## Install

```html
<link rel="stylesheet" href="/design-system/claude-design/fonts/fonts.css">
<link rel="stylesheet" href="/design-system/claude-design/tokens/tokens.css">
<link rel="stylesheet" href="/design-system/claude-design/css/reset.css">
<link rel="stylesheet" href="/design-system/claude-design/css/base.css">
<link rel="stylesheet" href="/design-system/claude-design/css/components.css">
<link rel="icon" href="/design-system/claude-design/logo/favicon.svg" type="image/svg+xml">
```

Order is not negotiable. `fonts.css` registers the families before `tokens.css` references them; `reset.css` must lose to `base.css`, which must lose to `components.css`.

Then fetch the open webfonts once:

```bash
node design-system/claude-design/fonts/fetch-fonts.mjs
```

Skip that and everything still works — the stacks fall back to platform fonts. See [fonts/README.md](fonts/README.md).

---

## What's here

```
claude-design/
├─ tokens/
│  ├─ tokens.json          Source of truth. Three layers, W3C token format.
│  ├─ tokens.css           Runtime CSS variables + both themes.
│  └─ tokens.js            Same values for canvas/Chart.js/native/PDF.
├─ fonts/
│  ├─ fonts.css            @font-face + metric-matched fallbacks.
│  ├─ fetch-fonts.mjs      Downloads the OFL faces into files/.
│  └─ README.md            Licensing, loading, and the type rules.
├─ logo/
│  ├─ mark.svg             currentColor. The default.
│  ├─ mark-clay.svg        Fixed clay 500, for contexts without inheritance.
│  ├─ lockup-horizontal.svg
│  ├─ lockup-stacked.svg
│  ├─ favicon.svg          Four-ray simplification, theme-aware.
│  ├─ app-icon.svg         512×512, maskable-safe.
│  └─ README.md            Clear space, minimum sizes, don'ts.
├─ css/
│  ├─ reset.css            Short and opinionated. Fixes only real defaults.
│  ├─ base.css             Element defaults + typography classes + layout.
│  └─ components.css       Buttons, fields, cards, badges, alerts, table,
│                          dialog, tooltip, skeleton, logo.
├─ preview/index.html      Living style guide. Theme toggle included.
└─ tailwind.preset.js      Tailwind v3 preset mapped to the CSS variables.
```

---

## The three layers

**Primitive** — raw ramps. `--cd-clay-500`, `--cd-ink-800`, `--cd-space-4`. Never write these in a component. They have no meaning; they're just values.

**Semantic** — intent. `--cd-surface-raised`, `--cd-text-secondary`, `--cd-border-focus`. **This is the layer you write.** Every semantic token has a light and a dark value, which is why the dark theme is a 60-line override rather than a parallel stylesheet.

**Component** — only where no semantic token honestly describes the thing. `--cd-button-height-md`, `--cd-focus-offset`, `--cd-layout-prose-max`. Keep this layer small; a component token is an admission the semantic layer has a gap.

```css
/* wrong — the component now knows about the palette */
.thing { background: var(--cd-ivory-100); color: var(--cd-ink-800); }

/* right — the component knows about intent, the theme knows about colour */
.thing { background: var(--cd-surface-raised); color: var(--cd-text-primary); }
```

---

## Theming

Light is the default. Dark comes from `prefers-color-scheme`, and an explicit `data-theme` on `<html>` overrides the OS **in both directions**:

```js
document.documentElement.dataset.theme = "dark";  // force dark
document.documentElement.dataset.theme = "light"; // force light
delete document.documentElement.dataset.theme;    // follow the OS
```

To avoid a flash of the wrong theme, set the attribute in an inline script in `<head>`, before the stylesheets:

```html
<script>
  const t = localStorage.getItem("theme");
  if (t) document.documentElement.dataset.theme = t;
</script>
```

Dark mode is not an inversion. Surfaces sit on warm near-black (`#141413`), not pure black, and text on `#F5F3EE`, not pure white — full-contrast black-on-white vibrates against the clay accent and makes the whole thing feel cheap. The accent also lightens from clay 500 to clay 300 in dark, because clay 500 only reaches 3.1:1 on ink 800.

---

## Colour rules that are easy to get wrong

- **Clay 500 is a surface colour, not a text colour.** On ivory it measures ~2.9:1 and fails AA at every size. Text in the accent uses `--cd-text-accent` (clay 700). The token already does this; don't "fix" it back.
- **Status colours are never the only signal.** Every error state pairs the colour with a message. Around 1 in 12 men can't separate the moss and clay hues.
- **Amber and rose are deliberately off-brand.** If a warning read as clay, users would learn to ignore the accent.
- **Charts use `--cd-chart-1..6` in order.** They're ordered for distinguishability under deuteranopia and in both themes. Reordering them for aesthetics breaks that.

---

## Type rules

Three families, three jobs. Sans for interface, serif for display and long-form reading, mono for code and data.

- **Serif never appears in UI chrome.** Not buttons, not labels, not nav, not table headers.
- **Weights are 400 / 500 / 600.** 700 exists for rare emphasis. Nothing lighter than 400 — thin weights disintegrate on warm backgrounds at low DPI.
- **Measure caps at 68ch** for prose (`.cd-prose` does this). Past ~75 characters readers start skimming without choosing to.
- **Tabular figures are opt-in** via `.cd-tnum` — tables, money, timers, anything that updates in place. Never in a sentence.
- **Don't add letter-spacing by hand.** It's in the type tokens, scaled inversely to size.

---

## Space and motion

4px grid, no exceptions. A value that isn't on the grid is a bug, not a nuance.

Motion durations are short on purpose: `fast` (140ms) for hover and colour, `base` (220ms) for anything that moves or resizes, `slow` (380ms) for entrances that cross a large distance. `--cd-ease-standard` for almost everything; `entrance`/`exit` for things appearing and leaving; `emphasis` overshoots and should be rare.

`reset.css` already collapses all animation under `prefers-reduced-motion: reduce`. Components do not get to opt out of that.

---

## Accessibility, non-negotiable

- One focus style for the whole system, defined once in `reset.css` on `:focus-visible`. Never write `outline: none` — `:focus-visible` already hides the ring from mouse users, which was the only real reason anyone ever did.
- Interactive targets are ≥ 24×24 CSS px, and ≥ 44×44 for anything primary on touch. `--cd-button-height-md` (40px) with padding clears both.
- Icon-only buttons carry `aria-label`. `.cd-btn--icon` without one is a broken button.
- Field errors use `aria-invalid` plus `aria-describedby` pointing at the `.cd-field__error`. Red border alone communicates nothing.
- Dialogs use the native `<dialog>` element — focus trapping, Esc, inert background and the top layer all come free and all come correct.
- Body text hits 4.5:1 and large text 3:1 in both themes. If you introduce a new colour pair, measure it.

---

## Other stacks

**Tailwind v3** — `presets: [claudeDesign]` from `tailwind.preset.js`. Colours resolve to the CSS variables, so `bg-surface-raised` follows the theme with no `dark:` variants at all.

**Tailwind v4** — skip the preset, point `@theme` at the same variables:

```css
@import "./design-system/claude-design/tokens/tokens.css";
@theme {
  --color-surface-canvas: var(--cd-surface-canvas);
  --color-surface-raised: var(--cd-surface-raised);
  --color-content: var(--cd-text-primary);
  --color-content-secondary: var(--cd-text-secondary);
  --color-accent: var(--cd-surface-accent);
  --font-sans: var(--cd-font-sans);
  --font-serif: var(--cd-font-serif);
}
```

**Canvas, Chart.js, PDF, native** — import from `tokens/tokens.js`:

```js
import { activeTheme, themes } from "./design-system/claude-design/tokens/tokens.js";
const t = activeTheme();
chart.options.borderColor = t.chartGrid;
chart.data.datasets.forEach((d, i) => (d.backgroundColor = t.chart[i % t.chart.length]));
```

`tokens.js` is hand-maintained alongside `tokens.css` on purpose. A generator nobody remembers to run is worse than two files someone edits together.

---

## Extending it

1. Add the raw value to `tokens.json` under `primitive`.
2. Give it meaning under `semantic`, with **both** a light and a dark value.
3. Mirror both into `tokens.css` and, if non-web consumers need it, `tokens.js`.
4. Add it to `preview/index.html`. A token that isn't in the specimen doesn't exist — nobody will find it.

Adding a fourth font family, a new accent hue, or an off-grid spacing value is a system change. It needs a reason beyond one screen looking better.

---

## A note on the name and the mark

This system is styled after the warm, paper-and-clay aesthetic associated with Claude, but it is an independent design system. The **Ember** mark in `logo/` was drawn for this package — it is not Anthropic's Claude logo, not a trace of it, and not a substitute for it. Anthropic's marks are their trademarks; to represent Anthropic or the Claude product, use their official brand assets under their own brand guidelines.

The brand faces named in the token stacks (Styrene, Tiempos, Berkeley Mono) are commercial and are not distributed here. Only the SIL OFL 1.1 fallbacks ship.
