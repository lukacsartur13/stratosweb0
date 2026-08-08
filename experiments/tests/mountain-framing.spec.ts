import { test, expect, type Page } from '@playwright/test';
import { GRID, valleyMetrics, valleyVerdict, VALLEY } from '../valley-metrics.mjs';
import { terrainMask, frameState } from '../terrain-mask.mjs';

/**
 * Portrait terrain framing. §18 of the mountain camera and material brief.
 *
 * ## What this file is for, and what it deliberately is not
 *
 * The real-device recordings showed the portrait range as two near-vertical
 * curtains running the height of the frame with a slit between them, and every
 * check that existed at the time passed on it. `shots-mountains.mjs` scored the
 * defect at `curtainRun` 0.0000 and `contour` 1.05–1.08 — comfortably inside
 * every threshold — because those gates read the *skyline*, and the skyline of
 * a curtain is a perfectly respectable jagged ridge. The thing that was wrong
 * was the inner faces, and a per-column skyline cannot see a vertical edge: it
 * stores one number per column, and a vertical edge is the boundary between two
 * of them.
 *
 * So these assertions scan the other way — the width of the clear central gap
 * as a function of height — and every threshold is calibrated between two
 * measured populations rather than chosen: the portrait baseline captured from
 * the committed build before this pass, and the accepted desktop composition
 * scored through the same function. Both are printed in
 * `_build/reports/mountain-camera-material-baseline.md`.
 *
 * Nothing here asserts a colour, a pixel or a hash. §18 is explicit that
 * artistic colour is not to be gated, and it is right: a screenshot test on a
 * WebGL page that fades between damped states fails for the weather. What the
 * frames *look* like is the review package's job and a human's decision. These
 * measure structure only — where the rock is, not what shade it is.
 */

/** The altitudes §18 names. The range has passed below the deck by 12 000 m. */
const STOPS = [0, 1_500, 2_500, 3_000, 6_000, 8_500] as const;

/** Portrait phone projects only. Everything below is a portrait composition. */
const portraitOnly = (page: Page) => {
  const vp = page.viewportSize();
  return !!vp && vp.width / vp.height < 1;
};

/**
 * Park the journey at an altitude and wait for the clock to *converge* rather
 * than for a duration.
 *
 * The same construction `shots-mountains.mjs` uses, and for the same reason: the
 * journey clock is damped, so the first poll after a jump can still read the
 * previous value simply because it has not started moving. Several consecutive
 * stable polls is the condition; a fixed wait would be a timeout in disguise.
 */
async function settleAt(page: Page, metres: number) {
  await page.evaluate((m) => {
    (globalThis as any).__stratos.journey.debug.altitude = m;
  }, metres);
  await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: max * (globalThis as any).__stratos.journey.current, behavior: 'instant' });
    (globalThis as any).__stable = 0;
    (globalThis as any).__lastCurrent = undefined;
  });
  await page.waitForFunction(
    () => {
      const g = globalThis as any;
      const j = g.__stratos.journey;
      const last = g.__lastCurrent;
      g.__lastCurrent = j.current;
      if (last !== undefined && Math.abs(j.current - last) < 1e-7) g.__stable++;
      else g.__stable = 0;
      return g.__stable >= 5;
    },
    undefined,
    { polling: 100 }
  );
}

/**
 * The scene handle, the fonts, the measured portrait composition, and the range
 * decoded and attached.
 *
 * Every one of those is waited for as a *named condition* rather than as a
 * duration, and the composition one is not optional. `openingAtInstrument` is
 * read at the instrument's own projected row, and on portrait the instrument
 * group is scaled and pushed back on dense stages once `measureComposition` has
 * published its decision. Measure before that lands and the dial is at a
 * different size in a different place, so the opening is sampled on the wrong
 * row: 37.9% against the settled 47.5% at 2 500 m. That is not a framing
 * regression, it is a photograph of a page that has not finished arranging
 * itself, and it is exactly the class of flake a bare `waitForTimeout` would
 * have papered over here.
 */
async function sceneReady(page: Page) {
  await page.goto('/home/hu.html');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => !!(globalThis as any).__stratos?.scene);
  await page.evaluate(() => document.fonts.ready);
  // The portrait window is not the state the page loads in — it defaults to
  // natural flow so a measurement that never happens degrades to a readable
  // document. `data-composition` is the exact event, not a duration that usually
  // covers it.
  await page.waitForFunction(() => document.documentElement.dataset.composition !== undefined);
  // The range is fetched and DRACO-decoded after the first frame, and it is the
  // subject of every assertion here, so wait for the geometry itself.
  await page.waitForFunction(() => {
    let found = false;
    (globalThis as any).__stratos.scene.traverse((o: any) => {
      if (o.userData?.mountainRoot) found = true;
    });
    return found;
  });
}

/**
 * Is any mountain triangle drawn *in front of* the instrument.
 *
 * §18's "no mountain edge crossing the instrument focal safe zone", asked as
 * the depth question it actually is. A 2D overlap test cannot answer it — the
 * instrument is drawn in front of the range at every altitude, so on the
 * accepted desktop composition the dial overlaps the right-hand mass on screen
 * with several scene units between them. Raycasting a grid over the disc and
 * asking what the nearest hit belongs to is the only formulation that means
 * anything.
 */
function occlusion() {
  const s = (globalThis as any).__stratos;
  const THREE = s.three;
  const { scene, camera } = s;
  camera.updateMatrixWorld();

  const isMountain = (o: any) => {
    let p = o;
    while (p) {
      if (p.userData?.mountainRoot) return true;
      p = p.parent;
    }
    return false;
  };

  let meridianRoot: any = null;
  const mountain: any[] = [];
  const other: any[] = [];
  scene.traverse((o: any) => {
    if (o.userData?.meridianRoot) meridianRoot = o;
    if (!o.isMesh || !o.visible) return;
    (isMountain(o) ? mountain : other).push(o);
  });
  if (!meridianRoot || !mountain.length) return { sampled: 0, occluded: [] as string[] };

  const box = new THREE.Box3().setFromObject(meridianRoot);
  if (box.isEmpty()) return { sampled: 0, occluded: [] as string[] };
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const project = (v: any) => {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  };
  const c = project(centre);
  const edge = project(centre.clone().add(new THREE.Vector3(radius, 0, 0)));
  const R = Math.max(Math.abs(edge.x - c.x), 0.02);

  const ray = new THREE.Raycaster();
  const occluded: string[] = [];
  let sampled = 0;
  for (let iy = -3; iy <= 3; iy++) {
    for (let ix = -3; ix <= 3; ix++) {
      if (Math.hypot(ix / 3, iy / 3) > 1) continue;
      const nx = (c.x + (ix / 3) * R) * 2 - 1;
      const ny = 1 - (c.y + (iy / 3) * R * (innerWidth / innerHeight)) * 2;
      ray.setFromCamera({ x: nx, y: ny } as any, camera);
      sampled++;
      const hits = ray.intersectObjects([...mountain, ...other], true);
      const first = hits.find((h: any) => h.object.visible);
      if (first && isMountain(first.object)) occluded.push(first.object.name);
    }
  }
  return { sampled, occluded };
}

test.describe('portrait mountain framing', () => {
  test.beforeEach(({ page }) => {
    test.skip(!portraitOnly(page), 'portrait composition only');
  });

  for (const metres of STOPS) {
    test(`the valley is a valley at ${metres} m`, async ({ page }) => {
      await sceneReady(page);
      await settleAt(page, metres);

      const state = await page.evaluate(frameState);
      const mask = await page.evaluate(terrainMask, GRID);
      const m = valleyMetrics(mask, GRID, state.meridian);

      // The range is drawn at every altitude in STOPS — all of them are below
      // the 10 800 m fade and well below the 12 000 m handoff to the deck.
      expect(m.present, 'the range is drawn').toBe(true);

      const verdict = valleyVerdict(m, { expectVisible: true, low: metres < 500 });
      expect(verdict.failures, `framing at ${metres} m`).toEqual([]);

      // §5's numeric target, asserted as a band at the altitudes it names. A
      // ceiling as well as a floor here and nowhere else: above 3 000 m §6 asks
      // for the valley to keep opening, so capping it there would gate against
      // the brief.
      if (metres >= 1_500 && metres <= 3_000) {
        expect(m.openingAtInstrument).toBeGreaterThanOrEqual(VALLEY.MIN_OPENING);
        expect(m.openingAtInstrument).toBeLessThanOrEqual(0.68);
      }

      // The instrument is in frame and centred. Not a framing metric so much as
      // the precondition for every other number here meaning anything: the
      // opening is read at the instrument's own row.
      expect(state.meridian, 'the instrument is projected').not.toBeNull();
      expect(state.meridian!.centreX).toBeGreaterThan(0.4);
      expect(state.meridian!.centreX).toBeLessThan(0.6);
    });
  }

  test('no mountain is drawn in front of the instrument', async ({ page }) => {
    await sceneReady(page);
    for (const metres of STOPS) {
      await settleAt(page, metres);
      const { sampled, occluded } = await page.evaluate(occlusion);
      expect(sampled, `samples taken at ${metres} m`).toBeGreaterThan(20);
      expect(occluded, `mountains in front of the instrument at ${metres} m`).toEqual([]);
    }
  });

  test('the foreground has no near-plane hole or terrain edge gap', async ({ page }) => {
    await sceneReady(page);
    for (const metres of STOPS) {
      await settleAt(page, metres);
      const state = await page.evaluate(frameState);
      const mask = await page.evaluate(terrainMask, GRID);

      expect(state.range, `the range is resident at ${metres} m`).not.toBeNull();

      /*
       * §18 asks for "no near-plane clipping" and "no terrain edge gap", and
       * both are asserted here as the same observable: the bottom band of the
       * frame is terrain from edge to edge.
       *
       * The obvious formulation — the nearest corner of the range's world
       * bounding box stays in front of the near plane — is *wrong*, and it was
       * the first thing this test did. It measured −9.7 scene units at every
       * altitude and every viewport, which looks like catastrophic clipping and
       * is nothing of the sort: `VALLEY_FLOOR` runs from behind the camera out
       * to nine kilometres, because the composition has the visitor standing in
       * the valley rather than looking at it from outside. Geometry behind the
       * near plane is the correct state of that scene, an axis-aligned box
       * corner is not even real geometry, and a check that fails on correct
       * output every time is a check that will be deleted rather than believed.
       *
       * What actual near-plane clipping would do is punch a hole in the
       * foreground — sky where the floor should be, under the copy. So that is
       * what is asked, of the mask, over a band rather than a single row so one
       * sampling artefact at the very edge cannot decide it. The same assertion
       * catches a terrain edge gap, which produces the identical observable.
       *
       * `nearestAlongView` is still recorded in the frame state for the report;
       * it is a useful number and a bad gate.
       */
      let covered = 0;
      let cells = 0;
      for (let r = GRID.rows - 8; r < GRID.rows; r++) {
        for (let c = 0; c < GRID.cols; c++) {
          cells++;
          if (mask[r * GRID.cols + c] === 1) covered++;
        }
      }
      expect(covered / cells, `floor coverage across the bottom band at ${metres} m`)
        .toBeGreaterThan(0.98);
    }
  });

  test('the camera path survives a toolbar resize', async ({ page }) => {
    await sceneReady(page);
    const vp = page.viewportSize()!;

    await settleAt(page, 2_500);
    const before = await page.evaluate(frameState);
    const maskBefore = await page.evaluate(terrainMask, GRID);
    const mBefore = valleyMetrics(maskBefore, GRID, before.meridian);

    // A phone's address bar collapsing is a viewport *height* change of roughly
    // this much, and it fires resize on every scroll tick. The station is a pure
    // function of altitude, so it must not move at all; the projected opening
    // may move a little because the frame genuinely changed shape.
    await page.setViewportSize({ width: vp.width, height: vp.height - 60 });
    await settleAt(page, 2_500);
    const after = await page.evaluate(frameState);
    const maskAfter = await page.evaluate(terrainMask, GRID);
    const mAfter = valleyMetrics(maskAfter, GRID, after.meridian);

    expect(after.range!.station, 'the station is a pure function of altitude')
      .toEqual(before.range!.station);
    expect(after.range!.quaternion, 'the range carries no rotation')
      .toEqual([0, 0, 0, 1]);
    expect(
      Math.abs((mAfter.openingAtInstrument ?? 0) - (mBefore.openingAtInstrument ?? 0)),
      'the valley opening under a toolbar-sized height change'
    ).toBeLessThan(0.08);

    // And the composition is still a composition at the new height.
    expect(valleyVerdict(mAfter, { expectVisible: true }).failures).toEqual([]);
  });

  test('the range has left the frame once the deck takes it', async ({ page }) => {
    await sceneReady(page);
    await settleAt(page, 12_600);
    const mask = await page.evaluate(terrainMask, GRID);
    const m = valleyMetrics(mask, GRID, null);
    // Above HIDE_ABOVE the range is not drawn. Asserted through the same mask
    // the framing metrics use, so "not drawn" means the same thing in both.
    expect(m.present, 'the range is not drawn above the cloud handoff').toBe(false);
  });
});
