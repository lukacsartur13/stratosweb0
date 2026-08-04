// =============================================================================
// Representative captures of each transition category, for human review.
//
// §32 reserves visual acceptance to a person, and a person cannot accept a
// transition from a description of it. This produces the stills that make the
// four categories reviewable: what the screen actually shows partway through a
// `home-to-page`, a `page-to-home`, a `page-to-page`, and what reduced motion
// shows instead of all three.
//
// ## Why a fixed delay and not an event
//
// There is no event that means "the transition is halfway through". `ready`
// resolves when the animation *starts* and `finished` when it is over, and
// screenshotting on either of those photographs an endpoint — which is to say,
// one of the two documents, not the transition. So the frames are taken at
// fixed offsets from the click, chosen against the authored durations in
// `assets/css/transitions.css`, and each still records the offset it was taken
// at so a reviewer knows what they are looking at.
//
// A screenshot during a cross-document view transition captures the
// pseudo-element tree, because that is what the compositor is painting. That is
// the point of it.
//
// Run against `dist/`, like the other Phase 7 harnesses: the thing being
// reviewed is the artefact that deploys.
//
// Usage (repo root, after `npm run build`):
//   node experiments/shots-transitions.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 4332);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? '_build/reports/phase7-review/transitions';

/* The offsets, in milliseconds from the click. The longest authored transition
   is `page-to-home` at 620 ms with a 180 ms delay, so 250 and 500 land inside
   the animation and 1500 is comfortably past every one of them. */
const FRAMES = [
  { at: 250, note: 'early — the outgoing document is still on screen' },
  { at: 500, note: 'mid — both snapshots are composited' },
  { at: 1500, note: 'settled — the destination, transition over' },
];

const VIEWS = [
  { id: '1440x900', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

const ROWS = [
  { id: 'home-to-page', from: '/', to: '/kkv.html', label: 'homepage → page' },
  { id: 'page-to-home', from: '/kkv.html', to: '/', label: 'page → homepage' },
  { id: 'page-to-page', from: '/kkv.html', to: '/rolunk.html', label: 'page → page' },
  {
    id: 'reduced-motion',
    from: '/kkv.html',
    to: '/',
    label: 'page → homepage, reduced motion',
    reduced: true,
  },
];

const pathsFor = (to) => (to.endsWith('/') ? [to, to + 'index.html'] : [to]);

mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'dist'], {
  stdio: 'ignore',
});
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = async () => {
    try {
      if ((await fetch(BASE)).ok) return resolve();
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > 20_000) return reject(new Error('static server did not start'));
    setTimeout(poll, 200);
  };
  poll();
});

const browser = await chromium.launch();
const shots = [];

for (const view of VIEWS) {
  for (const row of ROWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.dsf,
      isMobile: view.mobile,
      hasTouch: view.mobile,
      ...(row.reduced ? { reducedMotion: 'reduce' } : {}),
    });
    const page = await context.newPage();
    await page.goto(BASE + row.from, { waitUntil: 'load' });
    // The homepage needs its scene before it is worth photographing leaving.
    await page.waitForTimeout(row.from === '/' ? 2_500 : 600);

    const paths = pathsFor(row.to);
    const clicked = await page.evaluate((want) => {
      const a = [...document.querySelectorAll('a[href]')].find((el) => {
        const u = new URL(el.href, location.href);
        return u.origin === location.origin && want.includes(u.pathname);
      });
      if (!a) return false;
      a.click();
      return true;
    }, paths);

    if (!clicked) {
      console.log(`  ! ${view.id} ${row.id}: no anchor from ${row.from} to ${row.to}`);
      await context.close();
      continue;
    }

    let last = 0;
    for (const frame of FRAMES) {
      await page.waitForTimeout(frame.at - last);
      last = frame.at;
      const name = `${view.id}-${row.id}-${String(frame.at).padStart(4, '0')}ms.png`;
      // `animations: 'allow'`, deliberately. Playwright's default disables CSS
      // animations to make screenshots stable, and a stable screenshot of a
      // transition is a screenshot of no transition.
      await page.screenshot({ path: `${OUT}/${name}`, animations: 'allow' });
      shots.push({ view: view.id, row: row.id, label: row.label, at: frame.at, note: frame.note, file: name });
      console.log(`  ${name}`);
    }

    await context.close();
  }
}

await browser.close();
server.kill();

writeFileSync(`${OUT}/index.json`, JSON.stringify({ ranAt: new Date().toISOString(), shots }, null, 2));
console.log(`\n${shots.length} stills written to ${OUT}`);
