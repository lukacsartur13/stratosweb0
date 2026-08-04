// =============================================================================
// The Phase 7 human visual review package.
//
// §32 reserves visual acceptance to a person. This assembles the smallest set
// of stills that decision actually needs, and nothing else — the three still
// sets between them hold 146 PNGs and 123 MB, which is not a thing anyone
// reviews. What is copied here is:
//
//   * 12 000 m, baseline beside current, at three viewports — the one altitude
//     where the cloud work changes what the page looks like most, shown as a
//     comparison because "is this better" is not a question a single image can
//     be asked;
//   * 11 500 / 11 800 / 12 200 / 12 500 m — the approach, the breakthrough and
//     the two altitudes after it, so the structure can be judged as a sequence
//     rather than as one frame;
//   * the four transition categories, mid-animation, from
//     `shots-transitions.mjs`.
//
// The desktop still at 12 000 m carries an explicit question rather than being
// presented as accepted. It is the one frame where the cloud deck may read as
// uniform haze at full coverage, and a review package that does not say so is a
// review package that hopes nobody looks.
//
// **Nothing about the cloud design is changed here.** This copies files and
// writes an index. §32's answer comes from a person looking at it.
//
// Usage (repo root):
//   node experiments/shots-transitions.mjs      # if the transition stills are stale
//   node experiments/pack-phase7-review.mjs
// =============================================================================
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT ?? '_build/reports/phase7-review';

const BASELINE = '_build/reports/phase7-baseline-shots';
/* The current 12 000 m still comes from the cloud set, not from the regenerated
   baseline set, because that is the pair the report names as the comparison to
   make — see phase7-report.md §11.1. Both sets contain a 12 000 m capture of the
   same state; pointing the package at a different one than the prose does would
   invite exactly the confusion this is meant to remove. */
const CLOUD = 'experiments/screenshots/phase7-cloud';

/* §32's minimum: one desktop, one portrait phone, one landscape phone. */
const VIEWS = [
  { id: '1440x900', label: 'Desktop — 1440 × 900' },
  { id: '390x844', label: 'Phone, portrait — 390 × 844' },
  { id: '844x390', label: 'Phone, landscape — 844 × 390' },
];

const SEQUENCE = [11_500, 11_800, 12_200, 12_500];

/* The one still this package exists to ask a question about. */
const QUESTIONED = { view: '1440x900', altitude: 12_000 };
const QUESTION =
  'Human review required: cloud structure may read as uniform haze at full coverage.';

const pad = (n) => String(n).padStart(5, '0');
const missing = [];

mkdirSync(`${OUT}/stills`, { recursive: true });

function take(from, to) {
  if (!existsSync(from)) {
    missing.push(from);
    return null;
  }
  copyFileSync(from, `${OUT}/stills/${to}`);
  return `stills/${to}`;
}

const pairs = VIEWS.map((v) => ({
  ...v,
  before: take(`${BASELINE}/${v.id}-12000.png`, `${v.id}-12000-baseline.png`),
  after: take(`${CLOUD}/${v.id}-12000.png`, `${v.id}-12000-current.png`),
  questioned: v.id === QUESTIONED.view,
}));

const sequence = VIEWS.map((v) => ({
  ...v,
  frames: SEQUENCE.map((alt) => ({
    altitude: alt,
    src: take(`${CLOUD}/${v.id}-${pad(alt)}.png`, `${v.id}-${pad(alt)}-current.png`),
  })),
}));

/* The transition stills, if `shots-transitions.mjs` has been run. Absent is
   reported in the page rather than silently producing a package with a section
   missing. */
let transitions = [];
const tIndex = `${OUT}/transitions/index.json`;
if (existsSync(tIndex)) {
  transitions = JSON.parse(readFileSync(tIndex, 'utf8')).shots;
} else {
  missing.push(tIndex);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const metres = (m) => m.toLocaleString('en-GB').replace(/,/g, ' ') + ' m';

const shot = (src, caption) =>
  src
    ? `<figure><img src="${src}" alt="${esc(caption)}" loading="lazy"><figcaption>${esc(caption)}</figcaption></figure>`
    : `<figure class="gap"><div class="missing">not captured</div><figcaption>${esc(caption)}</figcaption></figure>`;

const byRow = {};
for (const s of transitions) (byRow[s.row] ??= []).push(s);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase 7 — visual review package</title>
<style>
  :root { color-scheme: dark; --ink:#0a0d12; --paper:#e9edf2; --haze:#8a929b; --signal:#ffee25; --warn:#ff6b4a; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem clamp(1rem,4vw,3rem) 6rem; background:var(--ink); color:var(--paper);
         font:16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  h1 { font-size:clamp(1.5rem,3vw,2.2rem); margin:0 0 .3rem; letter-spacing:-.02em; }
  h2 { font-size:1.25rem; margin:3rem 0 .4rem; border-top:1px solid #222a33; padding-top:1.5rem; }
  h3 { font-size:.95rem; margin:2rem 0 .6rem; color:var(--haze); font-weight:600;
       text-transform:uppercase; letter-spacing:.08em; }
  p  { max-width:74ch; color:#c3ccd6; }
  .lede { color:var(--haze); margin:0 0 2rem; }
  .grid { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); align-items:start; }
  .pair { display:grid; gap:1rem; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); }
  figure { margin:0; background:#11161d; border:1px solid #222a33; border-radius:6px; overflow:hidden; }
  figure img { display:block; width:100%; height:auto; }
  figcaption { padding:.5rem .7rem; font-size:.8rem; color:var(--haze); }
  .missing { padding:3rem 1rem; text-align:center; color:#5a636d; font-size:.85rem; }
  .flag { border-color:var(--warn); box-shadow:0 0 0 1px var(--warn); }
  .flag figcaption { color:var(--warn); font-weight:600; }
  .banner { margin:.75rem 0 0; padding:.8rem 1rem; border-left:3px solid var(--warn);
            background:rgba(255,107,74,.09); color:#ffd9cf; font-size:.9rem; max-width:74ch; }
  .note { font-size:.85rem; color:var(--haze); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; color:var(--signal); }
  .miss { color:var(--warn); font-size:.85rem; }
</style>
</head>
<body>

<h1>Phase 7 — visual review package</h1>
<p class="lede">Generated ${new Date().toISOString()} · not committed · nothing here has been accepted.</p>

<p>§32 reserves visual acceptance to a person. This is the set of stills that
decision needs: the cloud result at and around the breakthrough, and one still of
each transition category mid-animation. The cloud design has <strong>not</strong>
been altered pending this review.</p>

<h2>1 · 12 000 m — Phase 7 baseline beside the current result</h2>
<p>The altitude where the cloud work changes the page most. Left is the accepted
Phase 7 baseline, right is what the current source produces. Same altitude, same
viewport, same parked instrument.</p>

${pairs
  .map(
    (v) => `
<h3>${esc(v.label)}</h3>
<div class="pair">
  ${shot(v.before, 'Phase 7 baseline — 12 000 m')}
  ${
    v.questioned
      ? `<figure class="flag"><img src="${v.after}" alt="${esc(QUESTION)}" loading="lazy"><figcaption>Current — 12 000 m · ${esc(QUESTION)}</figcaption></figure>`
      : shot(v.after, 'Current — 12 000 m')
  }
</div>
${v.questioned ? `<p class="banner"><strong>${esc(QUESTION)}</strong><br>This is the still the package exists to ask about. It has not been changed in anticipation of an answer.</p>` : ''}`,
  )
  .join('\n')}

<h2>2 · The approach and the breakthrough</h2>
<p>11 500 m, 11 800 m, 12 200 m and 12 500 m, current source. The question at
12 000 m is about structure, and structure is a property of the sequence rather
than of one frame — these are here so it can be judged as one.</p>

${sequence
  .map(
    (v) => `
<h3>${esc(v.label)}</h3>
<div class="grid">
  ${v.frames.map((f) => shot(f.src, metres(f.altitude))).join('\n  ')}
</div>`,
  )
  .join('\n')}

<h2>3 · Transitions</h2>
<p>Each category captured at 250 ms, 500 ms and 1 500 ms from the click. There is
no event meaning "halfway through a transition" — <code>ready</code> resolves when
the animation starts and <code>finished</code> when it is over — so these are fixed
offsets against the authored durations, and each still says which offset it is.</p>

${
  transitions.length
    ? Object.entries(byRow)
        .map(
          ([id, shots]) => `
<h3>${esc(shots[0].label)}</h3>
<div class="grid">
  ${shots
    .map((s) => shot(`transitions/${s.file}`, `${s.view} · ${s.at} ms — ${s.note}`))
    .join('\n  ')}
</div>`,
        )
        .join('\n')
    : '<p class="miss">Not captured. Run <code>node experiments/shots-transitions.mjs</code> and re-run this script.</p>'
}

${
  missing.length
    ? `<h2>Missing sources</h2><ul class="miss">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
    : ''
}

</body>
</html>
`;

writeFileSync(`${OUT}/index.html`, html);
writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify(
    { ranAt: new Date().toISOString(), views: VIEWS, sequence: SEQUENCE, questioned: QUESTIONED, question: QUESTION, missing },
    null,
    2,
  ),
);

console.log(`review package: ${OUT}/index.html`);
console.log(`  comparisons: ${pairs.length} viewports at 12 000 m`);
console.log(`  sequence:    ${sequence.length} viewports x ${SEQUENCE.length} altitudes`);
console.log(`  transitions: ${transitions.length} stills`);
if (missing.length) {
  console.log(`  MISSING (${missing.length}):`);
  for (const m of missing) console.log(`    - ${m}`);
}
