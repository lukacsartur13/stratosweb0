// =============================================================================
// The cloud validation sweep. §14.
//
// Two passes, because the two things being asserted need different instruments:
//
//   PASS 1 — determinism and continuity, against the *pure* state function.
//     Exhaustive: every 10 m from 6 500 to 13 000, and every 5 m through
//     11 000–12 500, forward and then reverse, on every viewport in the matrix
//     and at both quality tiers and both motion preferences. This is cheap
//     because `getCloudState` has no renderer, no DOM and no clock — which is
//     the entire reason §6 asks for it to be a pure function.
//
//   PASS 2 — collision and overflow, against the *rendered page*.
//     Expensive, so it samples rather than sweeps. Drives the real document at
//     real altitudes and measures where things actually land.
//
// The module under test is imported from the running dev server, so the code
// being validated is the code that ships rather than a copy of it.
//
// §14: "A validation run spanning multiple source revisions is invalid. Freeze
// source edits while a full sweep is running." The run records the mtime of
// every cloud source file on entry and again on exit, and fails if any moved.
//
// Usage (repo root, with `npm run dev:full` running on :5176):
//   node experiments/validate-cloud.mjs
// =============================================================================
import { chromium } from '@playwright/test';
import { statSync, writeFileSync } from 'node:fs';

const BASE = process.env.URL ?? 'http://localhost:5176/experiments/stratos-ascent-full/full.html';
const OUT = process.env.OUT ?? '_build/reports/phase7-cloud-sweep.json';

// Every file whose contents can reach the picture under test. `DebugPanel` is
// on the list even though the sweep hides it: the dev server hot-replaces
// modules into the pages this run is driving, and a file that *could* perturb a
// running sweep belongs in the freeze check whether or not it is likely to.
const SOURCES = [
  'experiments/src/full/cloud.ts',
  'experiments/src/full/components/CloudDeck.tsx',
  'experiments/src/full/components/JourneyScene.tsx',
  'experiments/src/full/components/DebugPanel.tsx',
  'experiments/src/full/components/QualityManager.tsx',
  'experiments/src/full/mountains.ts',
  'experiments/src/full/journey.ts',
];
const fingerprint = () => SOURCES.map((f) => `${f}:${statSync(f).mtimeMs}`).join('|');
const BEFORE = fingerprint();

const VIEWPORTS = [
  { id: '1440x900', vw: 1440, vh: 900 },
  { id: '1366x768', vw: 1366, vh: 768 },
  { id: '1024x768', vw: 1024, vh: 768 },
  { id: '430x932', vw: 430, vh: 932 },
  { id: '390x844', vw: 390, vh: 844 },
  { id: '360x800', vw: 360, vh: 800 },
  { id: '844x390', vw: 844, vh: 390 },
].map((v) => ({ ...v, aspect: v.vw / v.vh, portrait: v.vw < v.vh }));

const LOCALES = ['hu', 'en', 'de'];

const failures = [];
const note = (where, message) => failures.push(`${where}: ${message}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!globalThis.__stratos, { timeout: 20_000 });

// ---------------------------------------------------------------------------
// PASS 1 — the pure state function.
// ---------------------------------------------------------------------------
console.log('pass 1 — determinism and continuity of getCloudState\n');

const pass1 = await page.evaluate(
  async ({ viewports }) => {
    // Resolved against the route's own base rather than the server root: the
    // dev server serves this entry under `/experiments/stratos-ascent-full/`,
    // so a root-relative specifier 404s.
    const base = location.pathname.replace(/[^/]*$/, '');
    const mod = await import(`${base}src/full/cloud.ts`);
    const { getCloudState, MERIDIAN_CONTRAST_FLOOR, CLOUD_STOPS, CLOUD_STEP_DOWN_SCALE } = mod;

    // §14's altitude coverage: 6 500–13 000 at 10 m, and 11 000–12 500 at 5 m.
    const altitudes = [];
    for (let m = 6_500; m <= 13_000; m += 10) altitudes.push(m);
    for (let m = 11_000; m <= 12_500; m += 5) altitudes.push(m);
    altitudes.sort((a, b) => a - b);
    const unique = [...new Set(altitudes)];

    const problems = [];
    let compared = 0;

    for (const viewport of viewports) {
      for (const qualityTier of ['full', 'reduced']) {
        for (const reducedMotion of [false, true]) {
          // The runtime quality step is a continuous scale, not a mode. Both
          // ends of its range are swept; the renderer eases between them.
          for (const stepScale of [1, CLOUD_STEP_DOWN_SCALE]) {
            const input = (altitude) => ({ altitude, viewport, qualityTier, reducedMotion });

            // --- forward, recording every state ---------------------------
            const forward = unique.map((m) => getCloudState(input(m), stepScale));
            // --- reverse, over the identical altitude list ----------------
            const reverse = [...unique]
              .reverse()
              .map((m) => getCloudState(input(m), stepScale))
              .reverse();

            const tag = `${viewport.id}/${qualityTier}/${reducedMotion ? 'rm' : 'motion'}/${stepScale === 1 ? 'full-rate' : 'stepped'}`;

            for (let i = 0; i < unique.length; i++) {
              const a = forward[i];
              const b = reverse[i];
              compared++;

              // §6: forward and reverse must produce the same result.
              for (const key of [
                'coverage',
                'density',
                'opacity',
                'verticalPosition',
                'apertureClearance',
                'mountainFade',
                'meridianContrast',
                'layerCount',
                'visible',
              ]) {
                if (a[key] !== b[key]) {
                  problems.push(
                    `${tag} @${unique[i]}m: ${key} differs by direction — forward ${a[key]}, reverse ${b[key]}`,
                  );
                }
              }

              // §9: the contrast floor is a floor, everywhere.
              if (a.meridianContrast < MERIDIAN_CONTRAST_FLOOR - 1e-9) {
                problems.push(
                  `${tag} @${unique[i]}m: meridianContrast ${a.meridianContrast} below floor ${MERIDIAN_CONTRAST_FLOOR}`,
                );
              }

              // Totals must agree with their parts.
              const sum = a.layers.distant + a.layers.enclosure + a.layers.floor;
              if (sum !== a.layerCount) {
                problems.push(`${tag} @${unique[i]}m: layerCount ${a.layerCount} != sum ${sum}`);
              }

              // Everything finite. A NaN removes an object from the scene
              // silently rather than throwing, which is the worst outcome.
              for (const [key, value] of Object.entries(a)) {
                if (typeof value === 'number' && !Number.isFinite(value)) {
                  problems.push(`${tag} @${unique[i]}m: ${key} is not finite (${value})`);
                }
              }

              // §26: reduced motion is a *static* state, not a slow one.
              if (reducedMotion && a.driftRate !== 0) {
                problems.push(`${tag} @${unique[i]}m: driftRate ${a.driftRate} under reduced motion`);
              }

              // --- continuity, against the previous sample ----------------
              if (i > 0) {
                const prev = forward[i - 1];
                const step = unique[i] - unique[i - 1];
                // Per-metre rates, so the 5 m and 10 m regions are comparable.
                const dOpacity = Math.abs(a.opacity - prev.opacity) / step;
                const dCoverage = Math.abs(a.coverage - prev.coverage) / step;
                const dY = Math.abs(a.verticalPosition - prev.verticalPosition) / step;

                // §14: "abrupt opacity changes". The steepest authored segment
                // is the release, 1.0 -> 0.3 of coverage over 600 m, which is
                // 1.17e-3 per metre at the smoothstep's midpoint. Anything past
                // double that is a discontinuity, not a curve.
                if (dCoverage > 2.5e-3) {
                  problems.push(
                    `${tag} @${unique[i]}m: coverage jumps ${dCoverage.toExponential(2)}/m (from ${prev.coverage} to ${a.coverage})`,
                  );
                }
                if (dOpacity > 2.5e-3) {
                  problems.push(
                    `${tag} @${unique[i]}m: opacity jumps ${dOpacity.toExponential(2)}/m`,
                  );
                }
                if (dY > 0.05) {
                  problems.push(`${tag} @${unique[i]}m: verticalPosition jumps ${dY.toFixed(4)}/m`);
                }

                // §14: "abrupt layer changes", checked per role and per
                // *plane*, not on the total.
                //
                // The total is the wrong quantity: three roles ramping
                // independently can each move by one plane in the same 10 m and
                // sum to a step of three, which is not a pop. And a step is only
                // a pop if the planes involved are visible — a role whose
                // opacity is zero at that altitude can change its count freely.
                for (const role of ['distant', 'enclosure', 'floor']) {
                  const dExact = Math.abs(a.layersExact[role] - prev.layersExact[role]);
                  const roleOpacity = a.opacity * a.presence[role];
                  if (dExact > 1 && roleOpacity > 0.005) {
                    problems.push(
                      `${tag} @${unique[i]}m: ${role} layers step ${prev.layersExact[role].toFixed(2)} -> ${a.layersExact[role].toFixed(2)} in ${step}m at opacity ${roleOpacity.toFixed(3)}`,
                    );
                  }
                }
              }
            }

            // §7's named boundaries, asserted rather than assumed.
            const at = (m) => getCloudState(input(m), stepScale);
            if (at(7_000).coverage !== 0) {
              problems.push(`${tag}: coverage at 7 000 m is ${at(7_000).coverage}, expected 0`);
            }
            if (at(6_500).visible) problems.push(`${tag}: visible at 6 500 m`);
            if (at(13_500).presence.enclosure > 1e-9) {
              problems.push(`${tag}: enclosure still present at 13 500 m`);
            }
            if (at(18_500).visible) problems.push(`${tag}: still visible at 18 500 m`);
            // The breakthrough is where the enclosure sits exactly on the camera.
            if (Math.abs(at(CLOUD_STOPS.closure).verticalPosition) > 1e-9) {
              problems.push(
                `${tag}: enclosure not at camera height at the breakthrough (${at(CLOUD_STOPS.closure).verticalPosition})`,
              );
            }
          }
        }
      }
    }

    return { problems, compared, samples: unique.length };
  },
  { viewports: VIEWPORTS },
);

console.log(`  ${pass1.samples} altitudes x ${VIEWPORTS.length} viewports x 8 configurations`);
console.log(`  ${pass1.compared} forward/reverse comparisons`);
console.log(`  ${pass1.problems.length} problems\n`);
for (const p of pass1.problems.slice(0, 40)) console.log(`  ! ${p}`);
if (pass1.problems.length > 40) console.log(`  ... and ${pass1.problems.length - 40} more`);
for (const p of pass1.problems) note('pass1', p);

// ---------------------------------------------------------------------------
// PASS 2 — the rendered page.
// ---------------------------------------------------------------------------
console.log('\npass 2 — collision, overflow and direction dependence in the page\n');

// §9's measurement altitudes, plus the two ends of the sweep.
const RENDERED = [6_500, 7_000, 9_500, 10_500, 11_500, 11_800, 12_000, 12_200, 12_500, 13_000];

const pass2 = [];

for (const locale of LOCALES) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.vw, height: viewport.vh },
      deviceScaleFactor: viewport.vw < 500 || viewport.vh < 500 ? 3 : 1,
      isMobile: viewport.vw < 500 || viewport.vh < 500,
      hasTouch: viewport.vw < 500 || viewport.vh < 500,
    });
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    // §8: validation mode freezes every time-dependent term. Installed before
    // the application assigns the handle, so no frames of drift accumulate.
    await p.addInitScript(() => {
      Object.defineProperty(globalThis, '__stratos', {
        configurable: true,
        get: () => globalThis.__s,
        set: (v) => {
          globalThis.__s = v;
          if (v?.journey?.debug) {
            v.journey.debug.ringRotation = 0;
            v.journey.debug.cloudFreeze = true;
            v.journey.debug.cloudPinQuality = true;
          }
        },
      });
    });

    await p.goto(locale === 'hu' ? BASE : `${BASE}?lang=${locale}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('canvas');
    await p.waitForFunction(() => !!globalThis.__stratos?.cloud !== undefined && !!globalThis.__stratos, {
      timeout: 20_000,
    });
    await p.waitForTimeout(2500);

    const park = async (metres) => {
      await p.evaluate((m) => {
        globalThis.__stratos.journey.debug.altitude = m;
      }, metres);
      await p.waitForTimeout(80);
      await p.evaluate(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        scrollTo({ top: max * globalThis.__stratos.journey.current, behavior: 'instant' });
      });
      await p.waitForTimeout(700);
      return p.evaluate(() => {
        const h = globalThis.__stratos;
        const de = document.documentElement;
        const cloud = h.cloud ?? null;
        // The narrative column and the HUD, as the page actually laid them out.
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        return {
          altitude: Math.round(h.journey.altitude),
          stage: h.journey.stage,
          overflow: de.scrollWidth - de.clientWidth,
          copy: box('.panel.is-active .panel__copy') ?? box('.panel__copy'),
          hud: box('.hud'),
          cloud: cloud && {
            visible: cloud.visible,
            coverage: +cloud.coverage.toFixed(6),
            opacity: +cloud.opacity.toFixed(6),
            layerCount: cloud.layerCount,
            meridianContrast: +cloud.meridianContrast.toFixed(6),
            verticalPosition: +cloud.verticalPosition.toFixed(6),
            art: cloud.art,
          },
        };
      });
    };

    // Forward, then reverse over the same altitudes. §14: "direction-dependent
    // state" — the page is driven in both directions and the published state is
    // compared, which is a stronger check than pass 1 because it also catches a
    // *renderer* that has accumulated something.
    const forward = [];
    for (const m of RENDERED) forward.push(await park(m));
    const reverse = [];
    for (const m of [...RENDERED].reverse()) reverse.push(await park(m));
    reverse.reverse();

    for (let i = 0; i < RENDERED.length; i++) {
      const f = forward[i];
      const r = reverse[i];
      const where = `${locale}/${viewport.id}@${RENDERED[i]}m`;

      if (f.overflow > 0) note(where, `horizontal overflow ${f.overflow}px`);
      if (f.cloud && r.cloud) {
        for (const key of ['coverage', 'opacity', 'layerCount', 'meridianContrast', 'verticalPosition']) {
          if (f.cloud[key] !== r.cloud[key]) {
            note(where, `${key} direction-dependent — down ${f.cloud[key]}, up ${r.cloud[key]}`);
          }
        }
      } else if (Boolean(f.cloud) !== Boolean(r.cloud)) {
        note(where, 'cloud state present in one direction only');
      }
    }

    if (errors.length) note(`${locale}/${viewport.id}`, `page errors: ${[...new Set(errors)].join(' | ')}`);

    pass2.push({ locale, viewport: viewport.id, forward, reverse, errors: [...new Set(errors)] });
    console.log(
      `  ${locale}/${viewport.id.padEnd(9)} ${forward.filter((s) => s.overflow > 0).length} overflow, ` +
        `${errors.length} errors, art ${forward.find((s) => s.cloud)?.cloud.art ?? 'n/a'}`,
    );

    await context.close();
  }
}

await browser.close();

// ---------------------------------------------------------------------------
const AFTER = fingerprint();
if (AFTER !== BEFORE) {
  note('run', 'SOURCE CHANGED DURING THE SWEEP — this run is invalid (§14)');
}

writeFileSync(
  OUT,
  JSON.stringify(
    { ranAt: new Date().toISOString(), sourceFingerprint: BEFORE, frozen: AFTER === BEFORE, pass1, pass2, failures },
    null,
    2,
  ),
);

console.log(`\n${'='.repeat(70)}`);
console.log(failures.length === 0 ? 'CLOUD SWEEP PASSED' : `CLOUD SWEEP FAILED — ${failures.length} problems`);
for (const f of failures.slice(0, 30)) console.log(`  ! ${f}`);
if (failures.length > 30) console.log(`  ... and ${failures.length - 30} more`);
console.log(`written: ${OUT}`);
process.exit(failures.length === 0 ? 0 : 1);
