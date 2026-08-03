// =============================================================================
// Silhouette shape metrics, as one implementation.
//
// Consumed by `shots-mountains.mjs` on a mask rendered from the live scene, and
// by `validate-flatrun.mjs` on the mask PNGs kept from the rejected
// pre-correction passes. One function, two inputs, so a threshold calibrated
// against the rejected stills means the same thing when it gates a live run.
//
// ## What the existing gates missed
//
// `longestVerticalEdgeRun` counts *consecutive* columns whose silhouette jumps
// by more than 8% of frame height. A curtain has no such run: it has exactly
// one such column on each side, because a clean vertical edge is a single
// discontinuity, not a sequence of them. The metric was measuring a ragged
// staircase and the failure was a rectangle, so it read 0.0 on the frames it
// existed to reject. `touchingFrameTop` did fire on the desktop version of that
// failure, but not on the mobile one at the width the wedge actually occupies.
//
// The metric that separates them is the *flat* run — a curtain's defining
// property is a skyline that does not change — and it was already being
// computed and simply never gated.
//
// ## Why the raw `longestFlatRun` could not have been gated as it stood
//
// Flatness was defined as `|Δskyline| < 0.003` in frame-height fractions,
// between columns spaced `W / 240` device pixels apart. That makes the implied
// slope tolerance a function of the viewport:
//
//     desktop 1440×900 @1x   0.003·900  / (1440/240)  = 0.45 px per px
//     390×844 @3x            0.003·2532 / (1170/240)  = 1.56 px per px
//
// Mobile was calling a slope three and a half times steeper "flat", which is
// why the accepted mobile stills score 0.63–0.70 on it and the accepted desktop
// stills score 0.25–0.31 for compositions that are the same shape. The number
// was describing the device pixel ratio.
//
// Everything below is normalised to *frame* units instead: slope is measured in
// frame-heights per frame-width, so it is independent of resolution, of DPR and
// of the column count, and depends on the aspect ratio only through the picture
// itself — which is the thing being judged.
// =============================================================================

/**
 * A column has mountain in it. `skyline` is the fraction down the frame of the
 * topmost mountain pixel, and 1 means "no mountain in this column".
 */
const has = (v) => v < 1;

/**
 * Slope in frame-heights per frame-width.
 *
 * `× cols` converts "per column" to "per frame width", which is what makes the
 * number comparable between a 1440-wide desktop capture and a 1170-wide phone
 * one sampled into the same number of columns.
 */
const slopeAt = (skyline, i, cols) => Math.abs(skyline[i] - skyline[i - 1]) * cols;

/** Longest run of `true` in a predicate over [1, cols), as a fraction of cols. */
function longestRun(cols, predicate) {
  let run = 0;
  let longest = 0;
  let start = -1;
  let bestStart = -1;
  for (let i = 1; i < cols; i++) {
    if (predicate(i)) {
      if (run === 0) start = i - 1;
      run++;
      if (run > longest) {
        longest = run;
        bestStart = start;
      }
    } else {
      run = 0;
    }
  }
  return { fraction: longest / cols, start: bestStart, length: longest };
}

/**
 * Thresholds, and where each number came from.
 *
 * Measured, not chosen. The two populations are the six kept masks from the
 * rejected pre-correction passes and the sixteen accepted stills re-scored
 * through this same function; `validate-flatrun.mjs` prints both against these
 * numbers so the margin is visible rather than asserted.
 *
 *   metric        rejected            accepted            threshold
 *   ------------  ------------------  ------------------  -------------------
 *   contour       0.0000 (all six)    1.1080 … 1.5286     0.55  midpoint
 *   flatRun       0.8625 … 0.9958     0.1417 … 0.3333     0.55  midpoint
 *   curtainRun    0.8625 … 0.9958     0.0000 (all 12)     0.10  see below
 *   wallRun       0.0000              0.0000 … 0.0042     0.15  not exercised
 *   edgeWedgeRun  0.0000              0.0000 … 0.0417     0.18  not exercised
 *
 * Two of these are honestly labelled as not exercised by the rejected set, and
 * that is stated rather than hidden. `wallRun` and `edgeWedgeRun` describe
 * failure shapes the kept masks do not happen to contain — a full-height
 * featureless band that does not reach the frame top, and a flat mass hard
 * against a frame edge. They are gated well clear of the accepted maximum
 * (35× and 4× respectively) so they cannot reject accepted work, and they will
 * catch their own shapes if one ever appears. A gate calibrated only against
 * the one failure that has already happened is a gate against that failure.
 */
export const SHAPE = {
  /**
   * Below this slope a column pair is "flat", in frame-heights per frame-width.
   * At 0.35 a skyline moving less than a third of a percent of frame height
   * across a percent of its width counts as flat — a ridge does not do that for
   * long, and a wall does it everywhere.
   */
  FLAT_SLOPE: 0.35,
  /**
   * A column this covered is a wall rather than a peak against sky. The
   * accepted compositions peak at 0.859 and sit at 0.79–0.83 for their
   * ninetieth percentile, so this is just above the densest accepted column.
   */
  WALL_COVER: 0.85,
  /**
   * A skyline this close to the frame top counts as touching it. The accepted
   * stills' highest point is 0.1411 — the range never comes within a seventh of
   * the frame height of the top — so 0.02 is seven times clear of them, and the
   * rejected masks sit at exactly 0.
   */
  TOP_BAND: 0.02,

  /** A flat mass this wide against the frame top is the curtain failure. */
  MAX_CURTAIN_RUN: 0.1,
  /** A featureless full-height band this wide is a valley-wall slab. */
  MAX_WALL_RUN: 0.15,
  /** A flat mass this wide hard against a frame edge is the mobile wedge. */
  MAX_EDGE_WEDGE_RUN: 0.18,
  /** A skyline this flat for this long has no shape, curtain or not. */
  MAX_FLAT_RUN: 0.55,
  /** Below this mean slope the silhouette has no contour at all. */
  MIN_CONTOUR: 0.55,
};

/**
 * @param {number[]} skyline fraction down the frame of the topmost mountain
 *   pixel per column; 1 where the column has no mountain.
 * @param {number[]} cover   fraction of the column's height covered by mountain.
 */
export function shapeMetrics(skyline, cover) {
  const cols = skyline.length;
  const mountainCols = skyline.filter(has).length;

  // Nothing to judge. This is the 12 000 m state and it is a correct one — the
  // range has finished its pass below the cloud deck by then — so it returns
  // nulls rather than zeros, and every gate below skips a null. A metric that
  // reported "no contour" for an empty frame would reject the one altitude the
  // brief explicitly asks to be empty.
  if (mountainCols === 0) {
    return {
      present: false,
      mountainColumns: 0,
      contour: null,
      flatRun: null,
      curtainRun: null,
      wallRun: null,
      edgeWedgeRun: null,
      highestPoint: null,
    };
  }

  const pair = (i) => has(skyline[i]) && has(skyline[i - 1]);
  const flat = (i) => pair(i) && slopeAt(skyline, i, cols) < SHAPE.FLAT_SLOPE;

  // --- contour: how much shape the skyline has at all ----------------------
  let slopeSum = 0;
  let slopeN = 0;
  for (let i = 1; i < cols; i++) {
    if (!pair(i)) continue;
    slopeSum += slopeAt(skyline, i, cols);
    slopeN++;
  }

  // --- the runs ------------------------------------------------------------
  const flatRun = longestRun(cols, flat);

  // A curtain: a flat skyline *that is the frame top*.
  //
  // Deliberately not also requiring near-full column coverage, and that is a
  // correction rather than a simplification. The first version of this asked
  // for `cover >= WALL_COVER` as well, and scored the actual rejected masks at
  // zero: the mobile curtain runs from the frame top to a little past the
  // midline and covers 0.50–0.65 of its columns, not 0.85. It is unmistakably a
  // curtain and the extra condition was excluding it. What makes it one is that
  // the silhouette has stopped being a silhouette — the mass is clipped by the
  // frame top across most of the width, so there is no skyline left to read.
  //
  // The accepted compositions score zero on this because their highest point is
  // 0.1411, a seventh of the frame height clear of the top, so no column is
  // ever inside `TOP_BAND` at all. The separation is total.
  const curtainRun = longestRun(cols, (i) => flat(i) && skyline[i] <= SHAPE.TOP_BAND);

  // A valley wall: full-height and flat, wherever it sits vertically.
  const wallRun = longestRun(cols, (i) => flat(i) && cover[i] >= SHAPE.WALL_COVER);

  // The mobile failure: a flat, substantially tall mass hard against a frame
  // edge. Scored as the flat run that includes the first or last column.
  const edgeWedgeRun = (() => {
    let left = 0;
    for (let i = 1; i < cols && flat(i) && cover[i] >= 0.4; i++) left++;
    let right = 0;
    for (let i = cols - 1; i >= 1 && flat(i) && cover[i] >= 0.4; i--) right++;
    return Math.max(left, right) / cols;
  })();

  return {
    present: true,
    mountainColumns: +(mountainCols / cols).toFixed(4),
    /** Mean skyline slope, frame-heights per frame-width. A curtain is ~0. */
    contour: +(slopeSum / Math.max(1, slopeN)).toFixed(4),
    flatRun: +flatRun.fraction.toFixed(4),
    curtainRun: +curtainRun.fraction.toFixed(4),
    wallRun: +wallRun.fraction.toFixed(4),
    edgeWedgeRun: +edgeWedgeRun.toFixed(4),
    highestPoint: +Math.min(...skyline.filter(has)).toFixed(4),
  };
}

/**
 * The gate.
 *
 * `expectVisible` is the altitude question: below 12 000 m the range is part of
 * the picture and is judged; at and above it the range has passed below the
 * cloud deck and an empty frame is the correct answer. Nothing here rejects
 * intentional negative space — every threshold is on a *run of columns with
 * mountain in them*, so a composition that leaves two thirds of the frame as
 * sky is not penalised for it.
 */
export function shapeVerdict(metrics, { expectVisible }) {
  const failures = [];
  const warnings = [];

  if (!metrics.present) {
    if (expectVisible) failures.push('the range is expected to be visible and no mountain pixels were found');
    return { failures, warnings };
  }
  if (!expectVisible) {
    failures.push('the range is drawn at an altitude it should have passed below');
    return { failures, warnings };
  }

  if (metrics.curtainRun > SHAPE.MAX_CURTAIN_RUN) {
    failures.push(
      `full-height curtain: ${(metrics.curtainRun * 100).toFixed(1)}% of the frame width is a flat, ` +
        `full-height mass against the frame top (limit ${(SHAPE.MAX_CURTAIN_RUN * 100).toFixed(0)}%)`
    );
  }
  if (metrics.wallRun > SHAPE.MAX_WALL_RUN) {
    failures.push(
      `flat wall band: ${(metrics.wallRun * 100).toFixed(1)}% of the frame width is full-height and ` +
        `featureless (limit ${(SHAPE.MAX_WALL_RUN * 100).toFixed(0)}%)`
    );
  }
  if (metrics.edgeWedgeRun > SHAPE.MAX_EDGE_WEDGE_RUN) {
    failures.push(
      `edge wedge: ${(metrics.edgeWedgeRun * 100).toFixed(1)}% of the frame width at a frame edge is a ` +
        `flat mass (limit ${(SHAPE.MAX_EDGE_WEDGE_RUN * 100).toFixed(0)}%)`
    );
  }
  if (metrics.contour < SHAPE.MIN_CONTOUR) {
    failures.push(
      `no silhouette contour: mean slope ${metrics.contour} frame-heights per frame-width ` +
        `(floor ${SHAPE.MIN_CONTOUR})`
    );
  }
  if (metrics.flatRun > SHAPE.MAX_FLAT_RUN) {
    failures.push(
      `long flat skyline run: ${(metrics.flatRun * 100).toFixed(1)}% of the frame width has no ` +
        `shape in it (limit ${(SHAPE.MAX_FLAT_RUN * 100).toFixed(0)}%)`
    );
  } else if (metrics.flatRun > SHAPE.MAX_FLAT_RUN * 0.75) {
    // The soft band. The accepted stills top out at 0.3333, so nothing reaches
    // this today; it exists so a composition drifting towards the rejected
    // population is reported before it crosses.
    warnings.push(
      `flat skyline run approaching the limit: ${(metrics.flatRun * 100).toFixed(1)}% ` +
        `(limit ${(SHAPE.MAX_FLAT_RUN * 100).toFixed(0)}%)`
    );
  }

  return { failures, warnings };
}
