// =============================================================================
// §7 — canonical state and reversibility.
//
//     npm run dev:full                       # in another terminal
//     node experiments/validate-traversal.mjs
//
// The requirement: at equal altitude, viewport, locale and stage, the camera,
// the Meridian's scale and the text composition must match *exactly* forward and
// backward. Not approximately, and not "within a tolerance that happens to pass"
// — the whole architecture is built on every layer being a pure function of one
// number, so an inequality here is a real second source of truth somewhere.
//
// ## Why this drives the scrollbar rather than the debug override
//
// `journey.debug.altitude` bypasses the scroll driver and the easing entirely
// and assigns `progressAt(forced)`. Comparing two runs of that can only ever
// prove that `progressAt` is a function, which the type system already says.
// This scrolls the real document to the same pixel offsets in two orders and
// reads what the page actually settled to.
//
// ## What "settled" means here
//
// `settle()` lands on its target rather than approaching it forever (see
// SETTLE_EPSILON in journey.ts), so a stationary page has one state, not a band
// of states. Each stop therefore waits for the instrument's world matrix to stop
// changing rather than for a duration — the same predicate the visibility
// harness uses — and only then reads.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = resolve(ROOT, '_build/reports/meridian-traversal.json');

const VIEWPORTS = (process.env.VIEWPORTS ?? '1440x900,844x390,390x844,320x568')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    return { w, h };
  });
const LOCALES = (process.env.LOCALES ?? 'hu,en,de').split(',');
/** Stops as fractions of the document's scrollable travel. */
const STOPS = Number(process.env.STOPS ?? 41);

/**
 * Everything that has to be reproducible, read in one pass.
 *
 * Rounded where a value is a float that no one can see the tail of — the camera
 * is in world units and the DOM values in CSS pixels — but *not* rounded so
 * coarsely that a real drift hides inside the rounding. Six decimals on world
 * units is well below a millimetre at this scale; three on a 0..1 progress is a
 * tenth of a pixel of copy travel.
 */
const READ = () => {
  const s = globalThis.__stratos;
  let root = null;
  s.scene.traverse((o) => {
    if (o.userData?.meridianRoot) root = o;
  });
  const round = (v, n) => Number(v.toFixed(n));
  const panels = {};
  for (const panel of document.querySelectorAll('.panel')) {
    const id = panel.dataset.stage;
    panels[id] = {
      fit: panel.dataset.fit ?? null,
      dense: panel.dataset.dense ?? null,
      // Which side this panel's copy is on, and how much of it is present. The
      // side is a constant of the stage and the presence is a smoothstep of the
      // altitude, so both must be identical in the two directions — and if the
      // handoff ever acquired a direction-dependent state, `veil` is where it
      // would show first.
      copy: panel.dataset.copy ?? null,
      room: panel.style.getPropertyValue('--copy-room') || null,
      flow: panel.style.getPropertyValue('--stage-flow') || null,
      veil: panel.style.getPropertyValue('--panel-veil') || null,
    };
  }
  const rootStyle = getComputedStyle(document.documentElement);
  return {
    altitude: round(s.journey.altitude, 3),
    progress: round(s.journey.current, 6),
    stage: s.journey.stage,
    camera: {
      x: round(s.camera.position.x, 6),
      y: round(s.camera.position.y, 6),
      z: round(s.camera.position.z, 6),
      // The rail pan. It is the camera's share of the lateral move, and it was
      // not in this comparison before because the camera did not have one.
      yaw: round(s.camera.rotation.y, 6),
    },
    meridian: root
      ? {
          scale: round(root.scale.x, 6),
          // The rail itself. If any part of the lateral composition were
          // direction-dependent — a damper that never lands, a knot walked from
          // the wrong end, an easing applied per component — this is the number
          // it would differ in, and comparing everything *but* it is how a
          // reversibility check passes a composition that is not reversible.
          x: round(root.position.x, 6),
          y: round(root.position.y, 6),
          z: round(root.position.z, 6),
          yaw: round(root.rotation.y, 6),
        }
      : null,
    gap: rootStyle.getPropertyValue('--meridian-gap').trim(),
    railX: rootStyle.getPropertyValue('--rail-x').trim(),
    panels,
  };
};

const SETTLE = () =>
  new Promise((res) => {
    let last = null;
    let stable = 0;
    let frames = 0;
    const tick = () => {
      const s = globalThis.__stratos;
      let root = null;
      s.scene.traverse((o) => {
        if (o.userData?.meridianRoot) root = o;
      });
      const key = `${root ? root.matrixWorld.elements.join(',') : ''}|${s.camera.position.toArray().join(',')}`;
      if (key === last) stable++;
      else stable = 0;
      last = key;
      if (stable >= 4 || ++frames > 600) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Walk the given scroll offsets in order, reading the settled state at each. */
async function walk(page, offsets) {
  const out = [];
  for (const y of offsets) {
    await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
    await page.evaluate(SETTLE);
    out.push(await page.evaluate(READ));
  }
  return out;
}

/** Deep difference, as a list of dotted paths. */
function diff(a, b, path = '') {
  if (a === b) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return [`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diff(a[k], b[k], path ? `${path}.${k}` : k));
}

const browser = await chromium.launch();
const results = [];
let failures = 0;

for (const locale of LOCALES) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    // Same document-language rewrite the visibility harness uses; `?lang=` is
    // not read by anything on this route.
    await page.route(BASE.split('?')[0], async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`),
      });
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('canvas').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__stratos?.scene && globalThis.__stratos?.journey, null, {
      timeout: 30_000,
    });
    await page.waitForTimeout(1_200);

    const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const offsets = Array.from({ length: STOPS }, (_, i) => Math.round((i * max) / (STOPS - 1)));

    const forward = await walk(page, offsets);
    const backward = await walk(page, [...offsets].reverse());
    backward.reverse();

    const label = `${locale} ${vp.w}x${vp.h}`;
    const mismatches = [];
    for (let i = 0; i < offsets.length; i++) {
      const d = diff(forward[i], backward[i]);
      if (d.length) mismatches.push({ y: offsets[i], altitude: forward[i].altitude, diffs: d.slice(0, 8) });
    }

    console.log(
      `${label.padEnd(20)} stops=${offsets.length}  mismatched=${mismatches.length}` +
        (mismatches.length ? '' : '  identical forward and reverse'),
    );
    for (const m of mismatches.slice(0, 5)) {
      console.log(`    y=${m.y} (${m.altitude}m)  ${m.diffs.join(' | ')}`);
    }
    if (mismatches.length > 5) console.log(`    … ${mismatches.length - 5} more`);

    failures += mismatches.length;
    results.push({ locale, viewport: vp, stops: offsets.length, mismatches });
    await page.close();
  }
}

await browser.close();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1));

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} mismatched stop(s). Report: ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
