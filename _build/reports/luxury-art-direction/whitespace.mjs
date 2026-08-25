/**
 * §26 — WHITESPACE, AS A MEASUREMENT RATHER THAN AS AN ADJECTIVE.
 *
 * "More spacious" is easy to claim and easy to get wrong. Ink coverage — the
 * share of the frame covered by the bounding boxes of type — is the obvious
 * metric and it is the WRONG one here: Direction D sets larger than A and C,
 * so it covers MORE of the frame with ink while having fewer things in it.
 * By that number D would look like the most crowded direction in the study,
 * which is the opposite of what the eye reports.
 *
 * What §26 actually asks for is "large areas where nothing competes" with the
 * centre of gravity. So the number this file computes is the LARGEST EMPTY
 * RECTANGLE: the biggest axis-aligned area in the frame that contains no
 * object at all. It is the honest version of the squint test — one large
 * silence scores well, the same amount of emptiness scattered into six gaps
 * between six objects does not.
 *
 * Three numbers, because no single one of them is honest on its own:
 *
 *   objects        how many things are in the frame at all
 *   covered        the share of the frame under an object, as a UNION rather
 *                  than a sum — the old study's `ink` figure added overlapping
 *                  boxes together and could exceed the truth
 *   largest void   the single biggest rectangle with nothing in it
 *
 * A and C are measured from the previous study's own measurements.json, so
 * the comparison uses their real geometry rather than a re-creation of it.
 * The instrument is included for all three directions, as its drawn circle.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const W = 1440, H = 900, STEP = 4;

/* The instrument in the previous study's hero frames. Taken from
   typography.css — `width:700px;height:700px;right:-190px;top:210px` — and
   reduced to the drawn circle with the ink fractions measured in scale.json,
   which is the same treatment shoot-d.mjs gives Direction D's. The old
   measurements.json never recorded the dial, and leaving it out would credit
   A1 and C1 with 700px of emptiness that has an altimeter in it. */
const D = JSON.parse(readFileSync(`${here}direction-d/scale.json`, 'utf8')).dial.inkFractionOfBox;
const OLD_DIAL = { l: Math.round(930 + D.l * 700), t: Math.round(210 + D.t * 700),
                   r: Math.min(W, Math.round(930 + D.r * 700)), b: Math.round(210 + D.b * 700) };

function measure(boxes) {
  const cols = Math.ceil(W / STEP), rows = Math.ceil(H / STEP);
  const blocked = Array.from({ length: rows }, () => new Uint8Array(cols));
  for (const b of boxes) {
    for (let y = Math.max(0, Math.floor(b.t / STEP)); y < Math.min(rows, Math.ceil(b.b / STEP)); y++)
      for (let x = Math.max(0, Math.floor(b.l / STEP)); x < Math.min(cols, Math.ceil(b.r / STEP)); x++)
        blocked[y][x] = 1;
  }
  let filled = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (blocked[y][x]) filled++;
  const coveredPct = Math.round((filled / (rows * cols)) * 1000) / 10;
  /* Maximal rectangle in a binary matrix, by histogram: for each row, the run
     of free cells above each column, then the largest rectangle in that
     histogram with a monotonic stack. */
  const height = new Int32Array(cols);
  let best = 0, bestRect = null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) height[x] = blocked[y][x] ? 0 : height[x] + 1;
    const stack = [];
    for (let x = 0; x <= cols; x++) {
      const h = x === cols ? 0 : height[x];
      let start = x;
      while (stack.length && stack[stack.length - 1].h >= h) {
        const top = stack.pop();
        const area = top.h * (x - top.x);
        if (area > best) { best = area; bestRect = { l: top.x * STEP, t: (y - top.h + 1) * STEP, r: x * STEP, b: (y + 1) * STEP }; }
        start = top.x;
      }
      stack.push({ x: start, h });
    }
  }
  return { coveredPct, pctOfFrame: Math.round((best * STEP * STEP / (W * H)) * 1000) / 10, rect: bestRect };
}

const rows = [];
const dNew = JSON.parse(readFileSync(`${here}direction-d/measurements.json`, 'utf8'));
for (const [id, r] of Object.entries(dNew)) {
  const le = measure(r.items);
  rows.push({ frame: id, direction: 'D', objects: r.objects, coveredPct: le.coveredPct, emptiestPct: le.pctOfFrame, rect: le.rect });
}
const old = JSON.parse(readFileSync(`${here}typography/measurements.json`, 'utf8'));
for (const id of ['a1', 'a2', 'a3', 'c1', 'c2', 'c3']) {
  const r = old[id];
  const boxes = [...r.items];
  if (id.endsWith('1')) boxes.push(OLD_DIAL);
  const le = measure(boxes);
  rows.push({ frame: id, direction: id[0].toUpperCase(), objects: boxes.length, coveredPct: le.coveredPct, emptiestPct: le.pctOfFrame, rect: le.rect });
}

const scene = (f) => (f.includes('1') ? 'hero' : f.includes('2') ? 'system' : 'high altitude');
console.log('frame      dir  objects  covered  empty  largest void');
for (const r of rows.sort((a, b) => scene(a.frame).localeCompare(scene(b.frame)) || a.direction.localeCompare(b.direction)))
  console.log(`${r.frame.padEnd(9)}  ${r.direction}    ${String(r.objects).padStart(5)}   ${String(r.coveredPct).padStart(5)}%  ${String(Math.round((100 - r.coveredPct) * 10) / 10).padStart(5)}%  ${String(r.emptiestPct).padStart(5)}%  (${r.rect.r - r.rect.l} × ${r.rect.b - r.rect.t})`);
