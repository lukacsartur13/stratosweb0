// =============================================================================
// The homepage entry, and the whole of what it does is decide WHEN the journey
// is allowed to start.
//
// This is the entry for `/`, `/en/` and `/de/` only. The prototype at
// /experiments/stratos-ascent-full/ has `prototype.tsx`, which mounts the same
// journey immediately; see the note there for why one entry could not be both.
//
// WHY THE MOUNT IS NOT HERE ANY MORE
// ----------------------------------
// It used to be. `createRoot(main).render(<Homepage/>)` ran the moment this
// module was evaluated, which meant React, both compositions and — one dynamic
// import later — three.js all executed while the visitor was still waiting for
// the first screen. Measured on the deployed site, on the device Lighthouse
// emulates:
//
//     Total Blocking Time     1 470 ms   (budget: 200)
//     Largest Contentful Paint  2 300 ms   (budget: 2 500, but see below)
//     longest single task         839 ms
//
// and the largest contentful paint was the *footer's* headline, because for the
// first two and a half seconds that was the biggest thing the document had.
//
// None of that is the journey being slow. It is the journey being early. A
// scroll-driven ascent through 30 000 m is, by construction, a thing that
// begins when the visitor begins it, and there is no reading of this page on
// which a WebGL renderer has to exist before they have touched it.
//
// So the document now ships its own opening frame — the same headline and the
// same lead sentence, as static markup in the shell (`openingFrame()` in
// `experiments/vite.home.config.ts`) — and this file waits.
//
// WHAT COUNTS AS "BEGINNING"
// --------------------------
// Any of `EVENTS` below. They are chosen to fire *before* the visitor could
// notice anything missing rather than after:
//
//   pointermove   a mouse crossing the document. On a laptop this is the first
//                 thing that happens, usually before the page has finished
//                 painting.
//   wheel         fires before the scroll it causes.
//   touchstart    fires when the finger lands, before it has moved.
//   pointerdown   the same for a stylus or a mouse press.
//   keydown       space, Page Down, Tab.
//   focusin       a keyboard visitor reaching the skip link.
//   scroll        the backstop, for scrolls none of the above preceded —
//                 momentum, a fragment link, an assistive technology.
//
// Plus three states that mean the visitor is *already* past the opening and
// waiting for the journey rather than about to ask for it: a restored scroll
// position, a fragment aimed inside the journey, and a BFCache restore.
//
// WHAT IT COSTS, HONESTLY
// -----------------------
// A visitor who never interacts sees the opening frame, the Arrival and the
// footer, and never the journey. That is the correct outcome — they read the
// two sentences the page opens with and left — but it is a real difference from
// before, and it is the reason the chunk is prefetched at idle: by the time the
// first `pointermove` arrives, the bytes are usually already local, so what the
// deferral costs at the moment of engagement is the mount, not the download.
// =============================================================================

// Eager, and the only thing in this file that is: `styles.css` carries the skip
// link, the focus ring and the layer order, all of which have to be right for
// the static opening frame that ships in the HTML. `mobile.css` is NOT imported
// here on purpose — it belongs to a composition that has not been chosen yet,
// so it travels with the chunk that chooses.
import './styles.css';
// The one module this entry pulls in beyond its stylesheet: forty lines of
// `matchMedia` and `screen`, no React and no composition. It is here so the
// prefetch below asks the same question `boot.tsx` will ask, rather than a
// second copy of it that could answer differently.
import { isMobileHomepage } from './mobile/device';

const host = document.getElementById('main');

/** See the note above. `capture` so nothing inside can stop one first. */
const EVENTS = [
  'pointermove',
  'pointerdown',
  'touchstart',
  'wheel',
  'keydown',
  'focusin',
  'scroll',
] as const;

const LISTEN: AddEventListenerOptions = { passive: true, capture: true };

let started = false;

function start(): void {
  if (started || !host) return;
  started = true;
  for (const type of EVENTS) removeEventListener(type, start, LISTEN);
  void import('./boot').then((boot) => boot.mount(host));
}

for (const type of EVENTS) addEventListener(type, start, LISTEN);

/**
 * When there is nothing to wait for.
 *
 * The dev server is one: `vite dev` serves the shell with its opening-frame
 * placeholder unsubstituted, so waiting there would mean developing against a
 * blank page. (The prototype at `/experiments/stratos-ascent-full/` is not on
 * this list any more — it has an entry of its own, `prototype.tsx`, for
 * reasons worth reading there.)
 *
 * The rest are the "already past the opening" cases — a visitor who is not
 * about to ask for the journey but is already inside it:
 *
 *   a restored scroll position   `scrollY` is read at module evaluation, which
 *                                for a `type="module"` script is after the
 *                                document is parsed and after the browser has
 *                                applied its scroll restoration. A Back
 *                                navigation into the middle of the journey
 *                                finds a non-zero offset here and mounts with
 *                                no interaction to wait for.
 *                                `assets/js/home-history.js` is what made the
 *                                document tall enough for that offset to
 *                                survive; this is the other half of it.
 *   a fragment                   `/#stage-selected-work` is a request for
 *                                something only the journey renders. `#main` is
 *                                excluded: that is the skip link, and it points
 *                                at the opening frame, which is already there.
 *   a BFCache restore            the same document handed back with a life
 *                                ahead of it, and a scroll position it had
 *                                before.
 */
if (import.meta.env.DEV) {
  start();
} else if (scrollY > 0 || (location.hash && location.hash !== '#main')) {
  start();
}

addEventListener('pageshow', (event) => {
  if (event.persisted) start();
});

/* --------------------------------------------------------------- prefetching

   The chunk list is emitted by `journeyChunks()` in
   `experiments/vite.home.config.ts`, because the file names are hashed and this
   file cannot know them.

   `rel="prefetch"` and not `rel="modulepreload"`, and the difference is the
   whole point: `modulepreload` compiles the module as well as fetching it, and
   compiling 300 KB of React and three.js is exactly the main-thread work this
   file exists to keep out of the load. `prefetch` puts the bytes in the HTTP
   cache at the lowest priority the browser has and does not touch them again.

   WHY IT WAITS TWICE, AND WHY THE SECOND WAIT IS A CLOCK

   `load` alone was not late enough, and the way it failed is worth writing
   down. On a fast machine the whole document lands in about 250 ms, so `load`
   fired *before* the browser had reported its largest contentful paint — and a
   prefetch issued in that window is, to anything reconstructing the load, a
   request the page made while it was still painting. Lighthouse put 300 KB of
   renderer into the dependency graph of a headline that was already on screen
   and simulated the paint at 4.3 s instead of 1.9 s. Nothing was slower; the
   measurement was simply told the wrong story.

   Two seconds past `load` is well clear of the largest contentful paint on any
   device — on a slow one the paint happens long before the load event, and on a
   fast one two seconds is an age — and then the browser's own idle callback
   decides the exact moment. `saveData` and a 2G connection opt out entirely:
   this is a convenience for the scroll that is probably coming, and it is not
   worth a metered megabyte to someone who has said so. */
const PREFETCH_DELAY_MS = 2_000;

addEventListener(
  'load',
  () => {
    if (started) return;
    const link = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    if (link?.saveData || /^(slow-)?2g$/.test(link?.effectiveType ?? '')) return;
    const source = document.getElementById('journey-chunks');
    if (!source?.textContent) return;
    let manifest: { core: string[]; mobile: string[]; desktop: string[] };
    try {
      manifest = JSON.parse(source.textContent);
    } catch {
      return;
    }
    // React and both compositions, then the renderer for the composition this
    // device will actually choose — never both renderers.
    const chunks = [
      ...manifest.core,
      ...(isMobileHomepage() ? manifest.mobile : manifest.desktop),
    ];

    const fetchThem = () => {
      // A visitor who engaged during the wait already has the real import in
      // flight; a prefetch behind it would be a second request for the same
      // bytes.
      if (started) return;
      for (const href of chunks) {
        const tag = document.createElement('link');
        tag.rel = 'prefetch';
        tag.href = href;
        document.head.appendChild(tag);
      }
    };

    setTimeout(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(fetchThem, { timeout: 4_000 });
      else fetchThem();
    }, PREFETCH_DELAY_MS);
  },
  { once: true },
);
