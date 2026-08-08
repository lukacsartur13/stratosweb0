// =============================================================================
// Valley framing metrics — the portrait composition, measured row by row.
//
// ## Why a second metrics module, next to silhouette-metrics.mjs
//
// `silhouette-metrics.mjs` scores the *skyline*: for each column, how far down
// the frame the topmost mountain pixel is. Every gate in it is a statement about
// that one curve — is it flat, does it touch the frame top, does it have
// contour.
//
// The portrait curtain defect is invisible to all of them, and that is not a
// tuning failure. The two masses that produce it have ragged, jagged tops with
// plenty of contour: measured on the committed build they score `curtainRun`
// 0.0000 and `contour` 1.05–1.08, comfortably inside every threshold, at every
// altitude and every portrait viewport. What is wrong with the picture is not
// the shape of the top of the rock — it is that the rock's *inner faces* run
// almost exactly parallel to the screen edges from the frame top down to the
// horizon, leaving a tall slit rather than a valley. A skyline curve cannot see
// a vertical edge: it stores one number per column, and a vertical edge is the
// boundary *between* two columns.
//
// So this module scans the other way, and measures the curve the brief is
// actually drawing — the width of the clear central gap as a function of height:
//
//     TARGET (and the accepted desktop)      CURRENT PORTRAIT (the defect)
//            /\          /\
//        ___/  \__    __/  \___             |  |            |  |
//     __/         \__/         \__          |  |            |  |
//                                           |  |____________|  |
//     opening tapers 0.79 -> 0.30           opening 0.75 -> 0.66, then a cliff
//     inner faces slope ~0.55 wide/high     inner faces slope ~0.08
//
// Those are measured numbers, not a sketch: `openingProfile` on the committed
// build reads [0.79, 0.61, 0.46, 0.38, 0.30] on desktop at 1 500 m and
// [0.76, 0.74, 0.71, 0.68, 0.00] on portrait at 2 500 m. The desktop valley
// narrows steadily all the way down because its walls lean; the portrait valley
// holds one width for two thirds of the frame and then terminates in a horizon.
// That difference *is* the defect, and the two numbers below name it.
//
// ## The input is a mask, not an image
//
// The page renders the range as white-on-black with everything else hidden (see
// terrain-mask.mjs for why a luminance threshold cannot work on this palette)
// and hands back a downsampled boolean grid. Everything here is arithmetic on
// that grid, so the identical function scores a live run and a stored one and
// there is no threshold that means two things.
// =============================================================================

/** Sampling resolution of the mask the page hands back. Both sides agree here. */
export const GRID = { cols: 240, rows: 180 };

/**
 * How many rows a slope is measured over.
 *
 * Not 1, and the reason is quantisation rather than smoothing taste. One column
 * is 1/240 of the frame width and one row is 1/180 of its height, so a
 * single-column step between adjacent rows is already a slope of 0.75 frame
 * widths per frame height — three times the threshold below. Measured row to
 * row, *every* edge in every composition reads as non-vertical and the metric
 * reports the mask's own resolution. Over eight rows the quantisation floor
 * drops to 0.094, comfortably under the threshold, and a real wall still reads
 * as one.
 */
const SLOPE_ROWS = 8;

/**
 * Thresholds, and where each came from.
 *
 * Calibrated against two measured populations rather than chosen: the portrait
 * baseline captured from the committed build before this pass (the defect), and
 * the accepted desktop composition re-scored through this same function (the
 * picture §4 is asking portrait to become). Both are printed in
 * `_build/reports/mountain-camera-material-baseline.md`.
 *
 * The gate sits between the two populations, nearer the defect than the target,
 * so it rejects the shape this pass exists to remove without demanding that
 * portrait become a copy of the landscape composition.
 */
export const VALLEY = {
  /** §5: the central usable valley, as a fraction of viewport width. */
  MIN_OPENING: 0.42,
  /**
   * §5 asks for 45–60%. The floor is 42 rather than 45 so a composition inside
   * the brief cannot fail on a two-point sampling difference, and there is
   * deliberately *no* ceiling: a wider valley is not a regression, and gating
   * one would fight §6's requirement that the valley opens with altitude.
   */
  MIN_OPENING_LOW: 0.38,

  /**
   * How much the opening must narrow between the top of the wall band and its
   * bottom, in frame widths. This is "clear outward-sloping mountain faces"
   * stated as a number: parallel walls taper by nothing, leaning ones taper by
   * the whole difference between the ridge line and the valley floor.
   */
  MIN_TAPER: 0.18,

  /**
   * A face steeper than this reads as parallel to the screen edge. Frame widths
   * per frame height, so it is independent of resolution, DPR and column count.
   * 0.25 is about 76 degrees in screen space.
   */
  VERTICAL_SLOPE: 0.25,
  /** …and no inner face may be that steep for more than half its height. */
  MAX_VERTICAL_RUN: 0.5,
  /** Mean slope of an inner face over the wall band. A curtain is near zero. */
  MIN_INNER_SLOPE: 0.3,

  /** §4: "some visible terrain floor/depth below the instrument". */
  MIN_FLOOR_DEPTH: 0.05,
};

/**
 * The valley opening on one row: the clear central run containing the frame
 * centre, and the two inner edges bounding it.
 *
 * `closed` is a row the terrain seals from side to side — below the horizon,
 * where there is no valley left to measure. It is recorded rather than skipped
 * because *where* the sealing starts is itself part of the composition.
 */
export function rowOpening(row, cols) {
  const mid = cols >> 1;
  if (row[mid]) return { opening: 0, left: 0.5, right: 0.5, closed: true, empty: false };

  let l = mid;
  while (l > 0 && !row[l - 1]) l--;
  let r = mid;
  while (r < cols - 1 && !row[r + 1]) r++;

  return {
    opening: (r - l + 1) / cols,
    left: l / cols,
    right: (r + 1) / cols,
    closed: false,
    /** No terrain anywhere on the row: it says nothing about where the walls are. */
    empty: l === 0 && r === cols - 1,
    unboundedLeft: l === 0,
    unboundedRight: r === cols - 1,
  };
}

/** Mean |dx/dy| over a `SLOPE_ROWS` baseline, and the longest near-vertical run. */
function edgeShape(rows, dyPerRow) {
  if (rows.length < SLOPE_ROWS + 2) return { slope: null, verticalRun: null, samples: rows.length };
  const span = SLOPE_ROWS * dyPerRow;
  let sum = 0;
  let n = 0;
  let run = 0;
  let longest = 0;
  for (let i = SLOPE_ROWS; i < rows.length; i++) {
    const slope = Math.abs(rows[i] - rows[i - SLOPE_ROWS]) / span;
    sum += slope;
    n++;
    if (slope < VALLEY.VERTICAL_SLOPE) run++;
    else run = 0;
    longest = Math.max(longest, run);
  }
  return {
    slope: +(sum / n).toFixed(4),
    verticalRun: +(longest / n).toFixed(4),
    samples: rows.length,
  };
}

/**
 * @param {Uint8Array|number[]} mask row-major, `rows × cols`, 1 = terrain,
 *   row 0 at the top of the frame.
 * @param {{rows:number, cols:number}} grid
 * @param {{centreX:number, centreY:number, radiusX:number, radiusY:number}|null} instrument
 *   the projected disc, in frame fractions.
 */
export function valleyMetrics(mask, grid = GRID, instrument = null) {
  const { rows, cols } = grid;
  const at = (y, x) => mask[y * cols + x] === 1;

  let covered = 0;
  for (let i = 0; i < rows * cols; i++) if (mask[i] === 1) covered++;

  const empty = {
    present: false,
    openingAtInstrument: null,
    openingProfile: null,
    taper: null,
    innerSlopeLeft: null,
    innerSlopeRight: null,
    verticalRunLeft: null,
    verticalRunRight: null,
    floorDepth: null,
    instrumentMargin: null,
    wallBand: null,
    coverage: 0,
  };
  if (covered === 0) return empty;

  // --- the opening profile, row by row -------------------------------------
  const profile = [];
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    for (let x = 0; x < cols; x++) row[x] = at(y, x);
    profile.push({ row: y, y: (y + 0.5) / rows, ...rowOpening(row, cols) });
  }

  /*
   * The wall band: the rows over which there is a valley to describe.
   *
   * It starts at the first row with terrain in it — above that is sky and there
   * are no walls — and ends at the row before the terrain seals the frame from
   * side to side, which is the horizon. Bounding the band by the picture rather
   * than by a fixed fraction of the frame is what makes the same thresholds
   * apply to a portrait frame whose horizon sits at 0.55 and a landscape one
   * whose horizon sits at 0.75.
   */
  const firstTerrain = profile.findIndex((p) => !p.empty);
  const sealed = profile.findIndex((p, i) => i > firstTerrain && p.closed);
  const bandEnd = sealed === -1 ? rows : sealed;
  const band = profile.slice(Math.max(0, firstTerrain), bandEnd).filter((p) => !p.empty && !p.closed);

  if (band.length < SLOPE_ROWS + 2) {
    return { ...empty, present: true, coverage: +(covered / (rows * cols)).toFixed(4),
             wallBand: { from: null, to: null, rows: band.length } };
  }

  // --- taper: does the valley narrow as it descends -------------------------
  // Measured between the top eighth and the bottom eighth of the band rather
  // than between its two extreme rows, so one clipped spur cannot set it.
  const eighth = Math.max(1, Math.round(band.length / 8));
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const openTop = mean(band.slice(0, eighth).map((p) => p.opening));
  const openBottom = mean(band.slice(-eighth).map((p) => p.opening));

  // --- how each inner face leans -------------------------------------------
  // A side with no wall on it in a given row contributes nothing: counting an
  // unbounded gap's edge as 0 would report a curtain as having travelled the
  // whole frame, which is how the first version of this module scored the
  // defect as healthier than the accepted composition.
  const left = edgeShape(band.filter((p) => !p.unboundedLeft).map((p) => p.left), 1 / rows);
  const right = edgeShape(band.filter((p) => !p.unboundedRight).map((p) => p.right), 1 / rows);

  /*
   * --- the opening where the instrument actually sits -----------------------
   *
   * `instrumentMargin` is reported and deliberately *not* gated.
   *
   * It measures how much clear sky separates the instrument's projected disc
   * from the nearest inner face, in units of the disc's own radius, and it is a
   * useful composition number — but it is a 2D overlap and it says nothing
   * about occlusion, because the instrument is drawn in front of the range at
   * every altitude. Scored as a gate it rejects the *accepted desktop*
   * composition at -0.26 to -1.07, where the dial is parked to the right and
   * simply overlaps the right-hand mass on screen with several scene units of
   * depth between them. A number that fails the picture it is calibrated
   * against is not a threshold.
   *
   * §18's actual requirement — "no mountain edge crossing the instrument focal
   * safe zone" — is a depth question, and it is answered by raycasting a grid
   * over the disc and asking what the nearest hit belongs to. That check lives
   * in the regression spec, where a camera and a scene graph are available.
   */
  let openingAtInstrument = null;
  let instrumentMargin = null;
  if (instrument) {
    const y = Math.min(rows - 1, Math.max(0, Math.round(instrument.centreY * rows)));
    const p = profile[y];
    openingAtInstrument = p.opening;
    if (!p.closed && instrument.radiusX > 0) {
      const gapL = instrument.centreX - instrument.radiusX - p.left;
      const gapR = p.right - (instrument.centreX + instrument.radiusX);
      instrumentMargin = +(Math.min(gapL, gapR) / instrument.radiusX).toFixed(4);
    }
  }

  // --- terrain floor below the instrument ----------------------------------
  // §4 asks for visible floor/depth under the dial. The question is simply
  // whether terrain is drawn there at all, over how much of the frame's height:
  // a row that the floor fills edge to edge is still floor, and an earlier
  // version that excluded those rows scored every composition at zero.
  let floorDepth = null;
  if (instrument) {
    const from = Math.min(1, Math.max(0, instrument.centreY + instrument.radiusY));
    const lo = Math.floor(cols * 0.3);
    const hi = Math.ceil(cols * 0.7);
    let n = 0;
    let total = 0;
    for (const p of profile) {
      if (p.y <= from) continue;
      total++;
      let hit = 0;
      for (let x = lo; x < hi; x++) if (at(p.row, x)) hit++;
      if (hit / (hi - lo) > 0.1) n++;
    }
    floorDepth = total ? +(n / rows).toFixed(4) : 0;
  }

  return {
    present: true,
    /** §5's headline, read at the instrument's own row. */
    openingAtInstrument: openingAtInstrument === null ? null : +openingAtInstrument.toFixed(4),
    /** The opening at five heights, so the shape is legible and not just scored. */
    openingProfile: [0.2, 0.3, 0.4, 0.5, 0.6].map((y) => {
      const p = profile[Math.min(rows - 1, Math.floor(y * rows))];
      return +p.opening.toFixed(4);
    }),
    /** How much the valley narrows from the ridge line to the horizon. */
    taper: +(openTop - openBottom).toFixed(4),
    innerSlopeLeft: left.slope,
    innerSlopeRight: right.slope,
    verticalRunLeft: left.verticalRun,
    verticalRunRight: right.verticalRun,
    floorDepth,
    instrumentMargin,
    wallBand: {
      from: +(band[0].y).toFixed(4),
      to: +(band[band.length - 1].y).toFixed(4),
      rows: band.length,
    },
    coverage: +(covered / (rows * cols)).toFixed(4),
  };
}

/**
 * The gate.
 *
 * `expectVisible` is the altitude question, exactly as in `shapeVerdict`: above
 * 12 000 m the range has passed below the cloud deck and an empty frame is the
 * right answer, so nothing is judged.
 *
 * `low` relaxes the opening floor only. At 0 m the composition is deliberately
 * closest to the terrain — §6's "low altitude: closer terrain presence, broad
 * framing" — so the valley is legitimately narrower there than at the mountain
 * stages §5 measures. Nothing else is relaxed: a vertical wall at 0 m is the
 * same defect as a vertical wall at 3 000 m.
 */
export function valleyVerdict(m, { expectVisible, low = false } = {}) {
  const failures = [];

  if (!m.present) {
    if (expectVisible) failures.push('the range is expected to be visible and the mask is empty');
    return { failures };
  }
  if (!expectVisible) {
    failures.push('the range is drawn at an altitude it should have passed below');
    return { failures };
  }

  const floor = low ? VALLEY.MIN_OPENING_LOW : VALLEY.MIN_OPENING;
  if (m.openingAtInstrument !== null && m.openingAtInstrument < floor) {
    failures.push(
      `valley too narrow: the central opening is ${(m.openingAtInstrument * 100).toFixed(1)}% of the ` +
        `frame width at the instrument's row (floor ${(floor * 100).toFixed(0)}%)`
    );
  }

  if (m.taper !== null && m.taper < VALLEY.MIN_TAPER) {
    failures.push(
      `the valley does not open: its width changes by ${(m.taper * 100).toFixed(1)}% of the frame ` +
        `between the ridge line and the horizon (floor ${(VALLEY.MIN_TAPER * 100).toFixed(0)}%) — ` +
        `parallel walls, not sloping faces`
    );
  }

  for (const side of ['Left', 'Right']) {
    const s = m[`innerSlope${side}`];
    const v = m[`verticalRun${side}`];
    if (s !== null && s < VALLEY.MIN_INNER_SLOPE) {
      failures.push(
        `${side.toLowerCase()} inner face is a wall: mean slope ${s} frame-widths per frame-height ` +
          `(floor ${VALLEY.MIN_INNER_SLOPE})`
      );
    }
    if (v !== null && v > VALLEY.MAX_VERTICAL_RUN) {
      failures.push(
        `${side.toLowerCase()} inner face runs parallel to the screen edge for ` +
          `${(v * 100).toFixed(1)}% of its height (limit ${(VALLEY.MAX_VERTICAL_RUN * 100).toFixed(0)}%)`
      );
    }
  }

  if (m.floorDepth !== null && m.floorDepth < VALLEY.MIN_FLOOR_DEPTH) {
    failures.push(
      `no terrain floor under the instrument: ${(m.floorDepth * 100).toFixed(1)}% of the frame height ` +
        `(floor ${(VALLEY.MIN_FLOOR_DEPTH * 100).toFixed(0)}%)`
    );
  }

  return { failures };
}
