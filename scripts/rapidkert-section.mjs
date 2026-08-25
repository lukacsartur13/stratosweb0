// =============================================================================
// The Proof act's plate, derived from the Rapidkert capture the site already
// publishes.
//
// §7–§10 of the production brief: the homepage capture
// `assets/img/work-rapidkert.jpg` is a screenshot of the Rapidkert site, so it
// carries that site's own display headline — `A GREAT GARDEN STARTS BELOW THE
// SURFACE.` — across its upper left. In the Proof act, whose dominant thought
// is a figure, that is a second voice, and the six-act study could only
// suppress it with a mask running to 64% of the plate's width.
//
// The audit found no second Rapidkert asset in the repository: one hero
// capture, one client mark, and nothing else. It also found that the thing the
// project actually is — the interactive 3D cross-section of the garden and the
// ground under it — occupies the right half of that same capture with no
// typography on it at all, apart from two of the Rapidkert site's own micro
// labels near the right edge.
//
// So the plate is a WINDOW ON THE EXISTING FRAME rather than a new image. No
// pixel is painted, retouched, resampled non-uniformly, blurred or generated.
// The rectangle is chosen to hold the whole cross-section and none of the
// typography:
//
//     x  690 … 1330   left of 690 is `…OW` / `…CE.`, the tail of the headline
//     y  300 …  758   above 300 is the headline's second line; below 758 is
//                     `SCROLL BELOW THE SURFACE`, and the block is cut by the
//                     foot of the frame there anyway
//     right edge 1330 stops short of `0.00 M`
//
// 640 × 458 at the source's own pixels and its own aspect. The block is cut by
// the right and bottom edges, which is the reading the study asked for: a
// fragment of something larger rather than a card in a portfolio grid.
//
// Run:  node scripts/rapidkert-section.mjs
// =============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = 'assets/img/work-rapidkert.jpg';
const OUT = 'assets/img/work-rapidkert-section.jpg';
const CROP = { x: 690, y: 300, w: 640, h: 458 };

const work = mkdtempSync(join(tmpdir(), 'rk-'));
const staged = join(work, 'section.jpg');
copyFileSync(SRC, staged);

// sips is on every macOS; ImageMagick is not, and this has to be runnable by
// anyone who has the repository checked out.
execFileSync('sips', [
  '--cropOffset', String(CROP.y), String(CROP.x),
  '-c', String(CROP.h), String(CROP.w),
  '-s', 'formatOptions', '86',
  staged,
]);
copyFileSync(staged, OUT);
rmSync(work, { recursive: true, force: true });

const size = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', OUT]).toString();
console.log(`${OUT}\n${size.trim()}`);
