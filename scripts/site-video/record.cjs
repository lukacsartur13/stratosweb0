// =============================================================================
// Records a site's home page scrolled from top to bottom, as JPEG frames with
// their timestamps, for scripts/site-video/encode.swift to turn into MP4s.
// Made for the home page's Rapidkert scene (owner, 2026-10-18):
//
//   node scripts/site-video/record.cjs https://rapidkert.com/ /tmp/rk-frames 36
//   swiftc -O scripts/site-video/encode.swift -o /tmp/encode
//   /tmp/encode /tmp/rk-frames assets/video/rapidkert-home-1920-hevc.mp4 1920 1200 hevc 1500000
//   /tmp/encode /tmp/rk-frames assets/video/rapidkert-home-1920-h264.mp4 1920 1200 h264 2000000
//   /tmp/encode /tmp/rk-frames assets/video/rapidkert-home-960-hevc.mp4   960  600 hevc  700000
//   /tmp/encode /tmp/rk-frames assets/video/rapidkert-home-960-h264.mp4   960  600 h264 1100000
//
// and the poster is the first frame (f_00000.jpg) saved as WebP, quality 82.
// If a codec string changes, the `type` of its <source> in
// _build/pages/index.html changes with it.
//
// How: Chromium on the GPU (Metal: the site is WebGL), a 1920×1200 window,
// every lazy image loaded by one pass down the page first, then the DevTools
// screencast (≈60 fps) while the page scrolls itself from its own frames —
// eased in and out, steady between. Each scroll is `behavior: 'instant'`:
// rapidkert.com sets `scroll-behavior: smooth`, which turned every per-frame
// scrollTo into a fresh smooth scroll that never caught up.
// =============================================================================
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const [url, out, seconds = '36'] = process.argv.slice(2);
if (!url || !out) { console.error('usage: record.cjs <url> <outdir> [scrollSeconds]'); process.exit(2); }
const W = 1920, H = 1200, HOLD = 1400, EASE = 0.07;

(async () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(2500);
  const to = (y) => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), y);
  const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= maxY; y += 450) { await to(y); await page.waitForTimeout(120); }
  await page.waitForTimeout(1500);
  await to(0);
  await page.waitForTimeout(4000);

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `f_${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(out, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await page.waitForTimeout(HOLD);
  await page.evaluate(({ ms, E }) => new Promise((done) => {
    const maxY = document.documentElement.scrollHeight - innerHeight, t0 = performance.now(), v = 1 / (1 - E);
    // Position over time: accelerates for E, steady, decelerates for E; the
    // speed is continuous at both joins.
    const pos = (u) => u < E ? v * u * u / (2 * E) : u > 1 - E ? 1 - v * (1 - u) * (1 - u) / (2 * E) : v * (u - E / 2);
    const step = (now) => {
      const u = Math.min(1, (now - t0) / ms);
      window.scrollTo({ top: Math.round(pos(u) * maxY), behavior: 'instant' });
      if (u < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }), { ms: Number(seconds) * 1000, E: EASE });
  await page.waitForTimeout(HOLD + 400);
  await cdp.send('Page.stopScreencast');
  await page.waitForTimeout(300);
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(frames));
  const span = frames[frames.length - 1].t - frames[0].t;
  console.log(`${frames.length} frames, ${span.toFixed(1)} s, ${(frames.length / span).toFixed(1)} fps`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
