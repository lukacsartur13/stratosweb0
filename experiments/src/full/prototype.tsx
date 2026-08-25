// =============================================================================
// The prototype's entry: mount, immediately, exactly as it always has.
//
// WHY THIS EXISTS SEPARATELY FROM `main.tsx`
// -----------------------------------------
// `/experiments/stratos-ascent-full/` is the fixed comparison baseline. The
// benchmarks, `MERIDIAN_PERFORMANCE_AUDIT.md` and the whole of
// `experiments/tests/` are written against it, and the rule stated in
// `vite.full.config.ts` is that it stays exactly where it is.
//
// The production homepage's entry no longer mounts on load: it ships a static
// opening frame in the shell and imports the journey on the visitor's first
// move, which is what took Total Blocking Time from 1 470 ms to under 100 on a
// mid-range phone. See the long note in `main.tsx`.
//
// The prototype has no opening frame — its shell is a bare `<main>` — so
// waiting there would be waiting in front of a blank page, and every test that
// navigates and measures would be racing a mount that used to be synchronous.
// It was, briefly, and the suite said so: four tests in
// `full-ascent.spec.ts` and `portrait-journey.spec.ts` began failing on
// `.journey__stage` not existing yet.
//
// A build-time flag was the first attempt and is the wrong shape. Whichever way
// the flag falls, `main.tsx` still contains `import('./boot')`, and a dynamic
// import is a chunk boundary in both builds — so the prototype kept paying a
// round trip before its mount whether it deferred or not. Two entries over one
// journey is what actually restores it: this file imports `boot` statically, so
// Rollup inlines it back into a single chunk here, and the homepage's entry
// splits it, because that is the whole point of the homepage's entry.
// =============================================================================

import './styles.css';
import { mount } from './boot';

const host = document.getElementById('main');
if (host) mount(host);
