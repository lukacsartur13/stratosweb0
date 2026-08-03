// =============================================================================
// Phase 5C: what the geometry count is actually counting.
//
//     npm run dev:home                    # in another terminal, serves :5177
//     node experiments/probe-geometry.mjs
//
// ## The observation this exists to explain
//
// `gl.info.memory.geometries` does not return to its starting value after a
// full forward-and-back traversal: desktop 133 → 136, mobile 86 → 88, measured
// at an identical *returned scroll position*. Mountain mesh counts and scene
// child counts return exactly, so whatever is retained is not in the mountain
// subtree and — this is the part that makes a count useless on its own — may
// not be in the scene graph at all.
//
// ## Why a count cannot answer it and this can
//
// `info.memory.geometries` is a single integer maintained by `WebGLGeometries`:
// incremented the first time a geometry is bound for drawing, decremented when
// it is disposed. It carries no identity, so "three more" is compatible with a
// leak, with a lazily built helper that will be reused forever, and with a
// resource that was never a leak because it is not retained at all. Deciding
// between those requires knowing *which* objects they are.
//
// So this registers geometries at construction instead. `BufferGeometry`
// subclasses all populate themselves through `setAttribute` on the shared
// prototype — including three's own generators, drei's helpers and the DRACO
// decoder's output — so one patch on that prototype sees every geometry the
// page will ever build, with a stack at the moment it was built. `dispose` is
// patched alongside it so the registry knows what has been given back.
//
// The scene is then traversed to attach each live geometry to its owning object
// and parent chain, which is what turns "three more geometries" into three
// named objects with a creation site each.
// =============================================================================
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5177/home/hu.html';
const OUT = process.env.OUT ?? 'experiments/bench-out';
const CYCLES = Number(process.env.CYCLES ?? 5);

const VIEWS = [
  { id: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
  { id: '390x844', width: 390, height: 844, dsf: 3, mobile: true },
];

/**
 * Installed in the page once `__stratos.three` exists.
 *
 * Strong references, deliberately. A `WeakRef` registry would tell us about
 * garbage collection, and garbage collection is not the question: three frees
 * GPU geometry on an explicit `dispose()` and nowhere else, so the counter this
 * is explaining moves on disposal alone. Holding the objects cannot change the
 * number being measured, and it makes the census exact.
 */
function installRegistry() {
  const THREE = globalThis.__stratos.three;
  if (globalThis.__geomRegistry) return 'already';

  const registry = new Map(); // uuid -> record
  globalThis.__geomRegistry = registry;

  const record = (g, origin) => {
    if (registry.has(g.uuid)) return;
    registry.set(g.uuid, {
      uuid: g.uuid,
      type: g.type,
      constructorName: g.constructor?.name ?? null,
      geometryName: g.name || null,
      origin,
      // Trimmed to the frames that name application or library code. The top
      // two are always this patch and three's own generator.
      stack: (new Error().stack ?? '')
        .split('\n')
        .slice(2, 10)
        .map((l) => l.trim())
        .filter((l) => l && !l.includes('installRegistry'))
        .join(' <- '),
      createdAtMs: Math.round(performance.now()),
      disposed: false,
      disposedAtMs: null,
      ref: g,
    });
  };

  // Seed with everything that already exists. These predate the patch, so they
  // have no creation stack — they are the baseline population, not a finding.
  globalThis.__stratos.scene.traverse((o) => {
    if (o.geometry) record(o.geometry, 'pre-existing');
  });

  const setAttribute = THREE.BufferGeometry.prototype.setAttribute;
  THREE.BufferGeometry.prototype.setAttribute = function (...args) {
    record(this, 'constructed');
    return setAttribute.apply(this, args);
  };

  const setIndex = THREE.BufferGeometry.prototype.setIndex;
  THREE.BufferGeometry.prototype.setIndex = function (...args) {
    record(this, 'constructed');
    return setIndex.apply(this, args);
  };

  const dispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function (...args) {
    const r = registry.get(this.uuid);
    if (r) {
      r.disposed = true;
      r.disposedAtMs = Math.round(performance.now());
    }
    return dispose.apply(this, args);
  };

  return 'installed';
}

/**
 * The full census: every registered geometry, plus where it currently lives.
 *
 * `inScene` is resolved by traversal rather than from the geometry, because a
 * geometry does not know its owner — and a geometry that is still counted by
 * the renderer while owned by nothing is exactly the shape a leak has.
 */
function census() {
  const { scene, gl } = globalThis.__stratos;
  const registry = globalThis.__geomRegistry;

  const owners = new Map(); // geometry uuid -> owner description
  scene.traverse((o) => {
    if (!o.geometry) return;
    const chain = [];
    let p = o;
    while (p) {
      chain.push(p.name || p.type);
      p = p.parent;
    }
    owners.set(o.geometry.uuid, {
      object: o.name || '(unnamed)',
      objectType: o.type,
      visible: o.visible,
      instanceCount: o.isInstancedMesh ? o.count : null,
      parents: chain.reverse().join(' / '),
    });
  });

  const live = [];
  for (const r of registry.values()) {
    if (r.disposed) continue;
    const g = r.ref;
    live.push({
      uuid: r.uuid,
      type: r.type,
      constructorName: r.constructorName,
      geometryName: r.geometryName,
      origin: r.origin,
      stack: r.stack,
      createdAtMs: r.createdAtMs,
      attributes: Object.keys(g.attributes ?? {}).sort(),
      indexCount: g.index ? g.index.count : null,
      positionCount: g.attributes?.position?.count ?? null,
      drawRange: g.drawRange ? { start: g.drawRange.start, count: g.drawRange.count } : null,
      groups: g.groups?.length ?? 0,
      owner: owners.get(r.uuid) ?? null,
    });
  }

  return {
    rendererGeometries: gl.info.memory.geometries,
    rendererTextures: gl.info.memory.textures,
    rendererPrograms: gl.info.programs?.length ?? null,
    sceneChildren: scene.children.length,
    sceneObjects: (() => {
      let n = 0;
      scene.traverse(() => n++);
      return n;
    })(),
    sceneGeometryOwners: owners.size,
    registrySize: registry.size,
    registryDisposed: [...registry.values()].filter((r) => r.disposed).length,
    live,
  };
}

async function settleAt(page, fraction) {
  await page.evaluate((f) => {
    const track = document.querySelector('[data-testid="journey-track"]');
    const travel = track
      ? track.offsetHeight - innerHeight
      : document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: (track?.offsetTop ?? 0) + travel * f, behavior: 'instant' });
    globalThis.__stable = 0;
    globalThis.__last = undefined;
  }, fraction);
  // Convergence, with a tolerance rather than exact equality.
  //
  // The determinism probe asks for an exact fixed point because that is what it
  // is measuring. This one is not: it needs the journey to have arrived so the
  // census describes a settled scene, and insisting on the last bit here makes a
  // two-hundred-settle run hostage to one slow convergence. `1e-9` of the track
  // is under a thousandth of a millimetre of altitude.
  await page.waitForFunction(
    () => {
      const j = globalThis.__stratos.journey;
      const last = globalThis.__last;
      globalThis.__last = j.current;
      if (last !== undefined && Math.abs(j.current - last) < 1e-9) globalThis.__stable++;
      else globalThis.__stable = 0;
      return globalThis.__stable >= 5;
    },
    undefined,
    { timeout: 60_000, polling: 60 }
  );
}

/** One full journey and back, through every act rather than in one jump. */
async function cycle(page) {
  for (let i = 1; i <= 10; i++) await settleAt(page, i / 10);
  for (let i = 9; i >= 0; i--) await settleAt(page, i / 10);
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const out = {};

for (const view of VIEWS) {
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.dsf,
    isMobile: view.mobile,
    hasTouch: view.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.addInitScript(() => {
    let v;
    Object.defineProperty(globalThis, '__stratos', {
      configurable: true,
      get: () => v,
      set: (x) => {
        v = x;
        if (x?.journey?.debug) x.journey.debug.ringRotation = 0;
      },
    });
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!globalThis.__stratos?.scene && !!globalThis.__stratos?.three, {
    timeout: 30_000,
  });
  await page.waitForTimeout(5_000); // mountain GLB fetch + DRACO decode

  console.log(`\n=== ${view.id} =================================================`);
  console.log(`  registry: ${await page.evaluate(installRegistry)}`);

  await settleAt(page, 0);
  const baseline = await page.evaluate(census);
  console.log(
    `  baseline           geometries=${baseline.rendererGeometries} ` +
      `sceneObjects=${baseline.sceneObjects} owners=${baseline.sceneGeometryOwners} ` +
      `registry=${baseline.registrySize} (${baseline.registryDisposed} disposed)`
  );

  const series = [baseline.rendererGeometries];
  const censuses = [baseline];
  for (let c = 1; c <= CYCLES; c++) {
    await cycle(page);
    await settleAt(page, 0);
    const now = await page.evaluate(census);
    series.push(now.rendererGeometries);
    censuses.push(now);
    console.log(
      `  after cycle ${String(c).padStart(2)}     geometries=${now.rendererGeometries} ` +
        `sceneObjects=${now.sceneObjects} owners=${now.sceneGeometryOwners} ` +
        `registry=${now.registrySize} (${now.registryDisposed} disposed)`
    );
  }

  // --- the set difference --------------------------------------------------
  const before = new Set(baseline.live.map((g) => g.uuid));
  const after = censuses[censuses.length - 1];
  const added = after.live.filter((g) => !before.has(g.uuid));
  const removed = baseline.live.filter((g) => !after.live.some((x) => x.uuid === g.uuid));

  // The geometries that appeared during the *first* cycle alone — the ones the
  // original 133 → 136 observation is about.
  const afterFirst = censuses[1];
  const addedFirst = afterFirst.live.filter((g) => !before.has(g.uuid));

  console.log(`\n  geometry series: ${series.join(' -> ')}`);
  console.log(`  retained after 1 cycle : ${addedFirst.length}`);
  console.log(`  retained after ${CYCLES} cycles: ${added.length}   (disposed since baseline: ${removed.length})`);

  // --- cycle-to-cycle: is the counter moving because objects are, or not? ----
  //
  // The renderer's counter and the creation registry answer different
  // questions, and the difference between them is the whole diagnosis.
  // `info.memory.geometries` is incremented by `WebGLGeometries` the first time
  // a geometry is *bound for drawing*, not when it is constructed. So a counter
  // that rises while the live registry set is unchanged means an existing
  // object reached the GPU for the first time — a lazy bind, with nothing
  // created and nothing leaked. A counter that rises *with* new live uuids is
  // the other thing entirely.
  console.log('\n  cycle    counter   live   new since previous   gone since previous');
  for (let i = 1; i < censuses.length; i++) {
    const prev = new Set(censuses[i - 1].live.map((g) => g.uuid));
    const now = new Set(censuses[i].live.map((g) => g.uuid));
    const fresh = [...now].filter((u) => !prev.has(u));
    const gone = [...prev].filter((u) => !now.has(u));
    console.log(
      `  ${String(i).padStart(5)}  ${String(censuses[i].rendererGeometries).padStart(9)}  ` +
        `${String(now.size).padStart(5)}  ${String(fresh.length).padStart(19)}  ${String(gone.length).padStart(19)}` +
        (censuses[i].rendererGeometries !== censuses[i - 1].rendererGeometries && fresh.length === 0
          ? '   <- counter moved with no new object: a first bind, not a creation'
          : '')
    );
    for (const u of fresh) {
      const g = censuses[i].live.find((x) => x.uuid === u);
      console.log(
        `           + ${u.slice(0, 8)} ${String(g.constructorName ?? g.type).padEnd(20)} ` +
          `${g.owner ? `${g.owner.object} (${g.owner.objectType})` : 'NOT IN SCENE'}`
      );
    }
  }

  if (added.length) {
    console.log('\n  --- geometries live at the end but not at the baseline ---');
    for (const g of added) {
      console.log(
        `   ${g.uuid.slice(0, 8)}  ${String(g.constructorName ?? g.type).padEnd(22)} ` +
          `attrs=[${g.attributes.join(',')}] idx=${g.indexCount ?? '-'} pos=${g.positionCount ?? '-'} ` +
          `draw=${g.drawRange ? `${g.drawRange.start}+${g.drawRange.count}` : '-'}`
      );
      console.log(`      owner   : ${g.owner ? `${g.owner.object} (${g.owner.objectType}) vis=${g.owner.visible ? 1 : 0}` : 'NOT IN SCENE'}`);
      if (g.owner) console.log(`      parents : ${g.owner.parents}`);
      console.log(`      created : ${g.stack || '(pre-existing — created before the registry was installed)'}`);
    }
  }

  out[view.id] = {
    series,
    baseline: { ...baseline, live: baseline.live.length },
    final: { ...after, live: after.live.length },
    addedAfterFirstCycle: addedFirst,
    addedAfterAllCycles: added,
    removed: removed.map((g) => ({ uuid: g.uuid, type: g.type, owner: g.owner })),
    errors: [...new Set(errors)],
  };

  if (errors.length) console.log(`\n  !! errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/geometry-census.json`, JSON.stringify(out, null, 1) + '\n');

console.log('\n--- verdict ----------------------------------------------------');
for (const [id, r] of Object.entries(out)) {
  const s = r.series;
  const grew = s[s.length - 1] - s[0];

  // "Plateaued" means the tail is flat, not that it was flat from the first
  // cycle. The first version of this asked whether every cycle equalled cycle
  // one, and so reported `63 -> 83 -> 84 -> 84 -> 84 -> 84` as STILL GROWING —
  // a series whose last four entries are identical. The question is whether it
  // is *still* rising at the end, and the answer is the last two entries.
  const tail = s.slice(1);
  const flatFrom = tail.findIndex((_, i) => tail.slice(i).every((v) => v === tail[i]));
  const rising = s[s.length - 1] > s[s.length - 2];
  console.log(
    `${id.padEnd(9)} ${s.join(' -> ')}  net ${grew >= 0 ? '+' : ''}${grew}  ` +
      (rising
        ? 'STILL GROWING'
        : grew === 0
          ? 'stable'
          : `flat from cycle ${flatFrom + 1} onward (${s.length - 1 - flatFrom} consecutive equal)`)
  );
}
console.log(`written: ${OUT}/geometry-census.json`);
