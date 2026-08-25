/**
 * THE HUMAN-PACE RECORDINGS — §2, §3 and §44.
 *
 * Two things come out of one run, and they are for two different audiences.
 *
 *   the .webm      Playwright's context recorder, real time, real compositor
 *                  output. This is the review asset a person watches.
 *   the frames     a CDP screencast running alongside it, which hands back
 *                  every composited frame as a JPEG with a timestamp. This is
 *                  what the analysis reads: the moving journey, sampled at the
 *                  compositor's own rate rather than at scroll positions a
 *                  script chose to stop at.
 *
 * The distinction matters because §2 is explicit that settled-state captures
 * are not the review. A `scrollTo` followed by a wait shows the page at rest at
 * that position, which is a state the visitor never sees while moving: the
 * journey clock is a damper, so during real scroll every value trails, and the
 * instrument in particular is rendered at a recede it is LEAVING rather than
 * the one the scroll position asks for. Only a screencast of a real-time scroll
 * shows that.
 *
 * ## The two profiles
 *
 *   continuous   one velocity, start to finish, no pauses. §3: this is the
 *                choreography test. Anything that repeats, stalls or snaps is
 *                obvious when nothing else is varying.
 *   natural      a reader's pace, and the pauses are NOT invented. They are
 *                placed at the scroll positions where `scan.mjs` measured a
 *                statement at full opacity — that is, where the page itself is
 *                asking to be read — with a dwell proportional to the words in
 *                it. §3: this is the readability test.
 *
 * Usage:
 *   node .../temporal/film.mjs --tag desktop-natural-before --profile natural \
 *        --width 1440 --height 900
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, writeFileSync as wf, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const W = Number(arg('width', 1440));
const H = Number(arg('height', 900));
const TAG = arg('tag', 'desktop-natural');
const PROFILE = arg('profile', 'natural');
const LOCALE = arg('locale', 'hu');
const REDUCED = process.argv.includes('--reduced');
const VELOCITY = Number(arg('velocity', 950));
const SCAN = arg('scan', '');
const FRAMES = process.argv.includes('--frames');
const ROOT = '_build/reports/luxury-art-direction/temporal';
const OUT = arg('out', `${ROOT}/film`);
const BASE = arg('base', 'http://localhost:4322');
const URL = LOCALE === 'hu' ? `${BASE}/index.html` : `${BASE}/${LOCALE}/index.html`;

mkdirSync(OUT, { recursive: true });
const frameDir = join(OUT, `frames-${TAG}`);
if (FRAMES) { rmSync(frameDir, { recursive: true, force: true }); mkdirSync(frameDir, { recursive: true }); }
const videoDir = join(OUT, `.video-${TAG}`);
rmSync(videoDir, { recursive: true, force: true });

// ------------------------------------------------------- the reading stops
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  isMobile: W < 768, hasTouch: W < 768,
  ...(W < 768 ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(3000);   // the scene, the model and the fonts, settled

// --------------------------------------------------------------- screencast
const frames = [];
let cdp = null;
if (FRAMES) {
  cdp = await page.context().newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const i = n++;
    frames.push({ i, t: Math.round(f.metadata.timestamp * 1000), y: null });
    wf(join(frameDir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(f.data, 'base64'));
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: W, maxHeight: H, everyNthFrame: 2 });
}

// ------------------------------------------------------------- the scroll
const trace = await page.evaluate(async ({ profile, velocity }) => {
  const H = innerHeight;
  const track = document.querySelector('[data-testid="journey-track"]');
  const base = track ? track.offsetTop : 0;
  const end = track ? base + track.offsetHeight - H : document.documentElement.scrollHeight - H;
  const out = [];

  /**
   * A reader's stops, found in the page rather than authored here: the scroll
   * position at which each chapter's statement is most fully composed, and how
   * many words are in it.
   */
  const stops = [];
  if (profile === 'natural') {
    const els = [...document.querySelectorAll('.act__monument, .passage__statement, .mv-lines')];
    const seen = new Set();
    for (const el of els) {
      const panel = el.closest('.panel, .mv-sec');
      if (!panel || seen.has(panel)) continue;
      seen.add(panel);
      const top = el.getBoundingClientRect().top + scrollY;
      // Read it where it sits a third of the way down the frame.
      const at = Math.max(0, Math.min(end, top - H * 0.33));
      const words = (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
      stops.push({ at, dwell: Math.max(700, Math.min(2600, words * 240)) });
    }
    stops.sort((a, b) => a.at - b.at);
  }

  let y = 0, si = 0;
  const t0 = performance.now();
  // The screencast timestamps are wall-clock and `performance.now()` is not,
  // so the scroll trace has to publish the one moment where the two clocks are
  // the same. Without it every frame is an unplaceable picture.
  const epoch0 = Date.now();
  let last = t0;
  return await new Promise((res) => {
    let holdUntil = 0;
    const step = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now >= holdUntil) {
        // Ease into and out of a stop rather than arriving at full speed: a
        // reader decelerates. Nothing here overshoots.
        let v = velocity;
        const next = stops[si];
        if (next) {
          const d = next.at - y;
          if (d < H * 0.6) v = Math.max(velocity * 0.22, velocity * (d / (H * 0.6)));
          if (d <= 6) { y = next.at; si++; holdUntil = now + next.dwell; }
        }
        y = Math.min(end, y + v * dt);
      }
      scrollTo({ top: y, behavior: 'instant' });
      out.push({ t: Math.round(now - t0), y: Math.round(y) });
      if (y >= end && now >= holdUntil) { setTimeout(() => res({ rows: out, epoch0, base, end }), 1400); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}, { profile: PROFILE, velocity: VELOCITY });

const { rows, epoch0, base: trackBase, end: trackEnd } = trace;
if (cdp) { try { await cdp.send('Page.stopScreencast'); } catch {} }
await page.waitForTimeout(500);

const video = page.video();
await page.close();
await ctx.close();
await browser.close();

if (video) {
  const src = await video.path();
  renameSync(src, join(OUT, `${TAG}.webm`));
}
rmSync(videoDir, { recursive: true, force: true });

// Place every screencast frame on the scroll track, by the one shared clock.
const placed = frames.map((f) => {
  const rel = f.t - epoch0;
  let lo = 0, hi = rows.length - 1;
  if (rel <= rows[0].t) return { ...f, rel, y: rows[0].y };
  if (rel >= rows[hi].t) return { ...f, rel, y: rows[hi].y };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid].t <= rel) lo = mid; else hi = mid; }
  const span = rows[hi].t - rows[lo].t || 1;
  const y = rows[lo].y + ((rows[hi].y - rows[lo].y) * (rel - rows[lo].t)) / span;
  return { ...f, rel, y: Math.round(y) };
}).map((f) => ({ ...f, screens: +((f.y - trackBase) / H).toFixed(4),
                 p: +Math.max(0, Math.min(1, (f.y - trackBase) / (trackEnd - trackBase))).toFixed(5) }));

writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({
  meta: { tag: TAG, profile: PROFILE, width: W, height: H, velocity: VELOCITY, locale: LOCALE, reduced: REDUCED,
          durationMs: rows.length ? rows[rows.length - 1].t : 0, frames: placed.length,
          trackBase, trackEnd, screensTotal: +((trackEnd - trackBase) / H).toFixed(3) },
  trace: rows, frames: placed,
}, null, 0));
console.log(`${TAG}.webm — ${(rows[rows.length - 1]?.t ?? 0) / 1000}s, ${rows[rows.length - 1]?.y}px, ${placed.length} screencast frames`);
