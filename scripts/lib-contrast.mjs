// Shared by the rendered checks: every visible text node's contrast against the
// background it actually sits on (walking up to the first opaque surface).
// Runs in the page. Returns the failures: [{ text, ratio, fg, bg }].
export async function lowContrast(page, min = 4.5) {
  return page.evaluate((min) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const background = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (const l of layers.reverse()) bg = over(l, bg);
      return bg;
    };
    const faded = (el) => { for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 1) return true; return false; };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim()) continue;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (cs.visibility === 'hidden' || box.width === 0 || box.height === 0 || el.closest('[aria-hidden="true"], .sr-only, :disabled, [aria-disabled="true"]')) continue;
      if (faded(el)) continue; // deliberately dimmed (cancelled, disabled) — judged by design, not by ratio
      const bg = background(el);
      const fg = over(parse(cs.color), bg);
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
      if (ratio < min) out.push({ text: n.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
    }
    return out;
  }, min);
}
