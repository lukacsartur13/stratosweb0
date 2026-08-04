// =============================================================================
// §9's targeted dense-panel portrait stills.
//
//     npm run dev:full                        # in another terminal
//     node experiments/shots-portrait.mjs
//
// Six things have to be visible in this set, per the decision:
//
//   before recede      the instrument at full size, entering a dense stage
//   maximum recede     the same instrument at the deepest recede that stage takes
//   return from recede the instrument back at full size, leaving it
//   Hungarian          the longest-running of the three locales in practice
//   German             the longest words
//   smallest standard  320×568
//
// ## The altitudes are read, not chosen
//
// Which stages recede is a *measurement* — `measureComposition` decides it from
// the rendered copy at this viewport in this locale, and it is not the same set
// on a 320×568 as on a 430×932. A capture script that hard-codes altitudes
// photographs whatever it guessed and reports it as coverage. This reads the
// measured dense set off the dev handle and derives three altitudes per dense
// stage from the stage's own bounds and the ramp width in composition.ts:
//
//   before   the stage's lower bound less a full ramp — the last altitude at
//            which the dense term is still exactly zero
//   maximum  the stage midpoint, where the smoothstep has saturated
//   return   the upper bound plus a full ramp — the first altitude back at zero
//
// so the three stills are the same instrument at recede 0, recede max, recede 0
// again, and any difference between the first and third is a reversibility
// defect rather than a matter of opinion.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = process.env.OUT ?? 'experiments/screenshots/portrait';
const LOCALES = (process.env.LOCALES ?? 'hu,de').split(',');
const VIEWPORTS = (process.env.VIEWPORTS ?? '390x844,320x568')
  .split(',')
  .map((s) => {
    const [w, h] = s.split('x').map(Number);
    return { w, h };
  });

/** Metres of smoothstep at each end of a dense stage — DENSE_RAMP in composition.ts. */
const RAMP = 500;

function freezeIdleRotation() {
  let value;
  Object.defineProperty(globalThis, '__stratos', {
    configurable: true,
    get: () => value,
    set: (v) => {
      value = v;
      if (v?.journey?.debug) v.journey.debug.ringRotation = 0;
    },
  });
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const locale of LOCALES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.addInitScript(freezeIdleRotation);
    await page.route(URL.split('?')[0], async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({
        response,
        body: body.replace(/<html\s+lang="[^"]*"/i, `<html lang="${locale}"`),
      });
    });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.debug, .debug__toggle { display: none !important; }' });
    await page.waitForSelector('canvas');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !!globalThis.__stratos?.composition, { timeout: 20_000 });
    await page.waitForTimeout(3_000);

    const dense = await page.evaluate(() => {
      const c = globalThis.__stratos.composition;
      const ids = c.denseStages();
      return ids.map((id) => {
        const s = c.stages.find((x) => x.id === id);
        return { id, from: s.from, to: s.to };
      });
    });

    const label = `${locale} ${vp.w}x${vp.h}`;
    if (!dense.length) {
      console.log(`${label.padEnd(18)} no dense stages measured — nothing to capture`);
      await context.close();
      continue;
    }
    console.log(`${label.padEnd(18)} dense: ${dense.map((d) => `${d.id} ${d.from}–${d.to}`).join(', ')}`);

    for (const stage of dense) {
      const stops = [
        { phase: 'before', metres: Math.max(0, stage.from - RAMP - 100) },
        { phase: 'max', metres: Math.round((stage.from + stage.to) / 2) },
        { phase: 'return', metres: Math.min(30_000, stage.to + RAMP + 100) },
      ];
      for (const { phase, metres } of stops) {
        await page.evaluate((m) => {
          globalThis.__stratos.journey.debug.altitude = m;
        }, metres);
        await page.waitForTimeout(120);
        await page.evaluate(() => {
          const max = document.documentElement.scrollHeight - innerHeight;
          scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
        });
        await page.waitForTimeout(2_600);

        const state = await page.evaluate(() => {
          const s = globalThis.__stratos;
          let root = null;
          s.scene.traverse((o) => {
            if (o.userData?.meridianRoot) root = o;
          });
          return {
            altitude: Math.round(s.journey.altitude),
            scale: root ? Number(root.scale.x.toFixed(4)) : null,
            z: root ? Number(root.position.z.toFixed(4)) : null,
            gap: getComputedStyle(document.documentElement).getPropertyValue('--meridian-gap').trim(),
          };
        });

        const name = `portrait-${locale}-${vp.w}x${vp.h}-${stage.id}-${phase}-${String(metres).padStart(5, '0')}.png`;
        await page.screenshot({ path: `${OUT}/${name}`, animations: 'disabled' });
        manifest.push({ locale, viewport: `${vp.w}x${vp.h}`, stage: stage.id, phase, ...state, file: name });
        console.log(
          `  ${phase.padEnd(6)} ${String(metres).padStart(5)}m  scale ${state.scale}  z ${state.z}  gap ${state.gap}`,
        );
      }
    }

    if (errors.length) console.log(`  !! ${label} errors: ${[...new Set(errors)].join(' | ')}`);
    await context.close();
  }
}

await browser.close();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));

// The reversibility claim, checked rather than asserted: `before` and `return`
// are the same recede by construction, so their scale and depth must match to
// the fourth decimal. A difference here is a state that depends on which way
// the visitor arrived, which §7 forbids outright.
const drift = [];
const key = (m) => `${m.locale}|${m.viewport}|${m.stage}`;
for (const m of manifest.filter((x) => x.phase === 'before')) {
  const back = manifest.find((x) => key(x) === key(m) && x.phase === 'return');
  if (back && (back.scale !== m.scale || back.z !== m.z)) {
    drift.push(`${key(m)}: before ${m.scale}/${m.z} vs return ${back.scale}/${back.z}`);
  }
}
console.log(`\nwritten: ${OUT} (${manifest.length} images)`);
console.log(drift.length ? `RECEDE NOT REVERSIBLE:\n  ${drift.join('\n  ')}` : 'recede reversible at every captured stage');
process.exit(drift.length ? 1 : 0);
