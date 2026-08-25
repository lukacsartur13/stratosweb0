# Fonts

Three roles, never more. Adding a fourth family is a design-system change, not a page decision.

| Role | Licensed face | Open face (ships) | Token |
|---|---|---|---|
| Sans — UI, headings, labels | Styrene A / Styrene B | Inter | `--cd-font-sans` |
| Serif — display, long-form prose | Tiempos Text | Source Serif 4 | `--cd-font-serif` |
| Mono — code, data, IDs | Berkeley Mono | JetBrains Mono | `--cd-font-mono` |

## What is and isn't in this folder

`files/` is empty in a fresh checkout and is gitignored. Nothing here redistributes a font binary.

**Open faces** — run the fetcher once:

```bash
node design-system/claude-design/fonts/fetch-fonts.mjs
```

That pulls Inter, Source Serif 4 (roman + italic) and JetBrains Mono from the `@fontsource` packages on jsDelivr. All three are SIL Open Font Licence 1.1: free to use, embed, and redistribute, including commercially. Keep `OFL.txt` alongside them when you ship.

**Licensed faces** — Styrene (Commercial Type), Tiempos (Klim Type Foundry) and Berkeley Mono (Berkeley Graphics) are commercial. They are not fetched, not vendored, and not obtainable through this repo. If your organisation already holds a webfont licence, drop the `.woff2` files into `files/` under exactly these names and `fonts.css` picks them up with no further edits:

```
StyreneA-Regular.woff2      TiemposText-Regular.woff2
StyreneA-Medium.woff2       TiemposText-Italic.woff2
StyreneA-Bold.woff2         TiemposText-Semibold.woff2
```

Check your licence's pageview tier and domain list before deploying. Most webfont licences are capped.

## If `files/` stays empty

Nothing breaks. Every token stack ends in platform fonts, so you get `-apple-system` / Segoe UI / Roboto for sans, Georgia for serif, and the platform mono. The layout holds; it just reads as generic. That is the intended failure mode — a missing font should never be a blank page.

## Loading

Import order matters. `fonts.css` must come first so the families are registered before `tokens.css` resolves `--cd-font-*`:

```html
<link rel="stylesheet" href="/design-system/claude-design/fonts/fonts.css">
<link rel="stylesheet" href="/design-system/claude-design/tokens/tokens.css">
<link rel="stylesheet" href="/design-system/claude-design/css/reset.css">
<link rel="stylesheet" href="/design-system/claude-design/css/base.css">
<link rel="stylesheet" href="/design-system/claude-design/css/components.css">
```

Preload the two faces that render above the fold. Do not preload all of them — every preload competes with the ones that matter:

```html
<link rel="preload" as="font" type="font/woff2" crossorigin
      href="/design-system/claude-design/fonts/files/Inter-Variable.woff2">
```

`crossorigin` is required on font preloads even for same-origin files. Without it the browser fetches the file twice.

## Fallback metrics

`fonts.css` defines `Inter-Fallback`, `SourceSerif4-Fallback` and `JetBrainsMono-Fallback` — synthetic faces built from a local system font with `size-adjust` and `ascent-override` tuned to match the real face's metrics. Use them when cumulative layout shift is being measured:

```css
font-family: Inter, Inter-Fallback, sans-serif;
```

The overrides are measured against Helvetica Neue / Arial / Georgia / Menlo. Swap the primary face and they need re-measuring — they are not generic.

## Rules

- **Serif is for display and prose only.** Never buttons, labels, table headers, or nav. The moment serif appears in UI chrome the hierarchy collapses.
- **Weights: 400, 500, 600.** 700 exists in the token set for rare emphasis. There is no 300 and no 800 — thin weights fail on low-DPI screens against warm backgrounds, and 800 is indistinguishable from 600 at UI sizes.
- **No synthetic bold or italic.** If a weight isn't in `files/`, don't reach for it.
- **Tabular figures are opt-in.** `.cd-tnum` on tables, timers, money, and anything that updates in place. Proportional everywhere else — tabular numerals in a sentence look broken.
- **Letter-spacing scales inversely with size.** Display sizes get `--cd-tracking-tight`; the eyebrow style gets `--cd-tracking-widest`. Body text gets nothing. This is already baked into the typography tokens; don't re-apply it.
