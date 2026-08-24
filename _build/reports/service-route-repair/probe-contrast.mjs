/* Measures composited foreground/background contrast for every text-bearing
   element on a route, in its SETTLED state. §9 of the brief: measure, do not
   judge by screenshot. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4331';
const ROUTES = (process.env.ROUTES || '').split(',').filter(Boolean);
const WIDTH = Number(process.env.W || 1440);
const HEIGHT = Number(process.env.H || 900);

const MEASURE = () => {
  const px = (s) => {
    const m = String(s).match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, b] = m.map(Number);
    const a = m.length > 3 ? Number(m[3]) : 1;
    return { r, g, b, a };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  // Effective background: composite every semi-transparent ancestor background
  // down onto the first opaque one.
  const bgOf = (el) => {
    const stack = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const c = px(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const sel = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).filter(Boolean).join('.') : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const path = (el) => {
    const out = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 5; i++, n = n.parentElement) out.unshift(sel(n));
    return out.join(' > ');
  };

  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    // Only elements with their own visible text
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const fg = px(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const eff = over(fg, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const cr = ratio(eff, bg);

    rows.push({
      path: path(el),
      text: own.slice(0, 60),
      color: cs.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      size: +size.toFixed(1),
      weight,
      large,
      ratio: +cr.toFixed(2),
      opacity: cs.opacity,
      passAA: large ? cr >= 3 : cr >= 4.5,
    });
  }
  return rows;
};

const browser = await chromium.launch();
const out = {};
for (const route of ROUTES) {
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    reducedMotion: 'reduce',        // guarantees the settled state, §35
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  out[route] = await page.evaluate(MEASURE);
  await ctx.close();
}
await browser.close();
writeFileSync(process.env.OUT || 'contrast.json', JSON.stringify(out, null, 2));
console.log('routes measured:', Object.keys(out).length);
