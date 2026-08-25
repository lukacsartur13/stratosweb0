# Logo

The mark is called **Ember**: eight tapered rays on a shared core, four long on the cardinals and four short on the diagonals. The alternating lengths are load-bearing — a uniform burst collapses into a dot below about 20px.

> **Note on origin.** This is an original mark drawn for this design system. It is not Anthropic's Claude logo and it is not a trace, redraw, or approximation of it. Anthropic's marks are their trademarks; if you need to represent Anthropic or the Claude product, use their official brand assets under their brand guidelines instead of anything in this folder.

## Files

| File | Use |
|---|---|
| `mark.svg` | The mark alone, `fill="currentColor"`. Default for web — it inherits text colour, so it works on any surface and in any theme with no variants. |
| `mark-clay.svg` | Fixed clay 500. For contexts that can't inherit: email signatures, PDFs, third-party embeds. |
| `lockup-horizontal.svg` | Mark + wordmark. The default lockup. Headers, letterheads, anywhere ≥ 110px wide. |
| `lockup-stacked.svg` | Mark above wordmark. Square spaces: avatars, splash screens, footers, merch. |
| `favicon.svg` | Four-ray simplification with a dark-mode media query. First entry in `<head>`. |
| `app-icon.svg` | 512×512 on an ivory plate, mark at 62% for maskable safe zones. |

## Sizing and clear space

**Clear space** on every side equals the radius of the mark's core — 4px when the mark is rendered at 48px, so **one twelfth of the mark's width**, scaling with it. Nothing enters that zone: no text, no rule, no crop edge, no other logo.

**Minimum sizes.** Below these it stops being the logo and starts being noise:

- Mark alone: **20px**. Below that, switch to `favicon.svg`.
- Horizontal lockup: **110px** wide.
- Stacked lockup: **72px** wide.

## Colour

The mark is monochrome. It has no gradient, no two-tone version, and no illustration variant.

| Background | Mark |
|---|---|
| Ivory / any light surface | Clay 500 `#D97757`, or ink 800 `#141413` when the accent is already doing work elsewhere |
| Ink / any dark surface | Clay 300 `#E5A38C` — clay 500 sits at 3.1:1 on ink 800 and reads muddy |
| Photography, video, busy fills | Ivory 100 `#FAF9F5` at 100% opacity, never a drop shadow |
| Single-colour print, embossing, laser | Solid ink or solid stock colour |

### currentColor only works inline

`mark.svg`, `lockup-horizontal.svg` and `lockup-stacked.svg` are drawn with `fill="currentColor"`. That is the right default — one file covers every surface and both themes — but **it only works when the SVG is part of the document**. An `<img>` is an opaque replaced element: it inherits nothing, so `currentColor` falls back to black and the mark disappears on any dark surface.

Three ways to get colour, in order of preference:

```html
<!-- 1. Inline. Takes the theme, costs no request, needs the markup. -->
<span class="cd-logo" style="color: var(--cd-surface-accent)">
  <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">…</svg>
</span>

<!-- 2. Sprite. Define the paths once per document, reference them anywhere. -->
<svg viewBox="0 0 48 48" fill="currentColor"><use href="#cd-ray-long"/>…</svg>

<!-- 3. Mask. Keeps the file external and still takes a colour. -->
<span style="background: var(--cd-surface-accent);
             mask: url(mark.svg) center / contain no-repeat;
             inline-size: 2rem; block-size: 2rem"></span>
```

If you genuinely want `<img>`, use `mark-clay.svg` — that is the only reason it exists. There is no `-clay` lockup: a lockup that can't take a colour belongs on a light surface, and on a light surface the default ink is correct.

## The wordmark

Set in the brand sans: **"Claude" at 600, "Design" at 400 and 62% opacity**. That weight/opacity split is the wordmark — it is not a styling choice to re-decide per surface.

The lockup SVGs use live `<text>`, which means they render in whatever the sans stack resolves to on the host machine. That's right for the web and wrong for everything else. **Before any print job, PDF, or handoff to someone outside your font licence, convert the text to outlines:**

```bash
inkscape --export-type=svg --export-text-to-path \
  --export-filename=lockup-horizontal-outlined.svg lockup-horizontal.svg
```

Skip that step and the lockup silently falls back to Arial on the printer's machine.

## Don't

- Don't rotate the mark. The long rays are vertical and horizontal; tilting it reads as a spinner mid-load.
- Don't change ray count, ray length ratio, or core size. The one sanctioned redraw is `favicon.svg`.
- Don't re-space the lockup, stack the horizontal version, or set the wordmark in the serif.
- Don't put the mark inside a circle, rounded square, or badge you drew yourself. `app-icon.svg` is the only plated version.
- Don't add a drop shadow, glow, outline, or bevel.
- Don't recolour to anything outside the table above, including "just for this campaign".
- Don't animate the rays individually. If it must move, fade or scale the whole mark as one object.

## HTML head

```html
<link rel="icon" href="/design-system/claude-design/logo/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32"><!-- legacy fallback -->
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><!-- 180×180, rasterised from app-icon.svg -->
```

Safari still wants a rasterised `apple-touch-icon`, and old Windows still wants `favicon.ico`. Generate both from `app-icon.svg`:

```bash
rsvg-convert -w 180 -h 180 logo/app-icon.svg -o apple-touch-icon.png
```
