/**
 * A one-off celebration: a project closed, a deal won.
 *
 * ## When it runs — the whole contract
 *
 * `celebrate()` is called by the code that just received a SUCCESSFUL write
 * that actually changed the state (see `closeProject` in lib/operations.ts and
 * `setStage` in lib/sales.ts), and from nowhere else. It is an event, not a
 * rendering of state: nothing reads "is this project closed?" and decides to
 * throw confetti, so a reload, a revisit or a re-render can never repeat it, and
 * a refused save never reaches it.
 *
 * ## What it shows
 *
 * Always: a short status line, announced to assistive technology
 * (`role="status"`), that fades after a few seconds.
 * Only when motion is welcome: a brief burst of confetti in the Portal's own
 * palette. Under `prefers-reduced-motion: reduce` there is no animation at all
 * — the status line alone is the success signal.
 *
 * No dependency: a canvas, ~80 rectangles and gravity. No HTML is built from
 * strings; the one line of text is a text node.
 */

export type Celebration = 'project_closed' | 'deal_won';

const TEXT: Record<Celebration, string> = {
  project_closed: 'Project closed',
  deal_won: 'Deal won',
};

// The theme's signal, paper, chrome and good, read when the burst starts —
// a canvas cannot resolve CSS variables itself. The fallbacks are the dark theme.
const PALETTE_TOKENS: [string, string][] = [['signal', '255 238 37'], ['paper', '244 244 244'], ['chrome', '203 220 233'], ['good', '62 207 142']];
function palette(): string[] {
  const css = getComputedStyle(document.documentElement);
  return PALETTE_TOKENS.map(([name, fallback]) => `rgb(${css.getPropertyValue(`--c-${name}`).trim() || fallback})`);
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // No matchMedia is not a reason to animate.
    return true;
  }
}

export function celebrate(kind: Celebration, detail?: string | null): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  announce(detail ? `${TEXT[kind]} — ${detail}` : TEXT[kind]);
  if (!prefersReducedMotion()) burst();
}

function announce(text: string) {
  document.querySelector('[data-celebration-status]')?.remove();
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('data-celebration-status', '');
  el.className = 'pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4';
  const pill = document.createElement('p');
  pill.className = 'rounded-sm border border-signal/40 bg-panel px-4 py-2 font-data text-[11px] '
    + 'uppercase tracking-[0.14em] text-paper shadow-panel';
  pill.textContent = text;
  el.appendChild(pill);
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

function burst() {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-celebration', 'confetti');
  canvas.className = 'pointer-events-none fixed inset-0 z-[60]';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);
  const PALETTE = palette();

  // Two fans, from just below the top corners, meeting over the content.
  const pieces = Array.from({ length: 80 }, (_, i) => {
    const left = i % 2 === 0;
    const angle = (left ? -0.35 : Math.PI + 0.35) + (Math.random() - 0.5) * 0.9;
    const speed = 7 + Math.random() * 7;
    return {
      x: left ? width * 0.1 : width * 0.9,
      y: height * 0.18,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      w: 5 + Math.random() * 5,
      h: 3 + Math.random() * 4,
      spin: (Math.random() - 0.5) * 0.3,
      turn: Math.random() * Math.PI,
      color: PALETTE[i % PALETTE.length],
    };
  });

  const DURATION = 1800;
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - DURATION * 0.6) / (DURATION * 0.4));
    for (const p of pieces) {
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + 0.32;
      p.x += p.vx;
      p.y += p.vy;
      p.turn += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.turn)));
      ctx.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
