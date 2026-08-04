import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { FullAscent } from './FullAscent';
import { JourneyFallback } from './components/JourneyFallback';
import './styles.css';

/**
 * The last-resort net, and deliberately not the first one.
 *
 * WebGL failures — a bad driver, a lost context, a model that decodes wrong —
 * are caught much closer to where they happen, by `SceneBoundary` around the
 * canvas subtree, precisely so that they cost the visitor the canvas and not
 * the page. React cannot render half of a subtree that threw, so a boundary at
 * this level is all-or-nothing: it was catching context losses and replacing
 * the entire journey with a static dial, taking the headline, the case studies
 * and the call to action with it.
 *
 * What remains here catches the things that genuinely leave nothing to render —
 * a throw in the narrative itself, or during the initial mount — where a static
 * instrument really is better than a blank page.
 */
class JourneyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Full ascent crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="journey" id="main">
        <div className="journey__stage" style={{ position: 'relative' }}>
          <JourneyFallback reason="context-lost" />
        </div>
      </main>
    );
  }
}

/**
 * Development handle on the two singletons.
 *
 * The debug panel is the interface a person uses; this is the one a script
 * uses, and having it is what makes it possible to screenshot an exact altitude
 * state from a test without scrolling eleven screens to it or guessing a slider
 * position. `import.meta.env.DEV` is statically replaced, so neither the import
 * nor the assignment survives a production build.
 *
 * Merged into whatever is already there rather than assigned over it.
 * `JourneyScene`'s `DevSceneHandle` publishes the renderer's scene, camera and
 * context onto the same object, and the two have no ordering relationship: this
 * one waits on a dynamic import, that one waits on the canvas mounting, and
 * either can land first. Assigning a fresh object here — which is what this did
 * — silently dropped the scene whenever the canvas won the race, and the
 * validation script then timed out waiting for a handle that had existed and
 * been overwritten.
 */
if (import.meta.env.DEV) {
  void Promise.all([import('./journey'), import('./meridian'), import('./composition')]).then(([j, m, c]) => {
    const g = globalThis as { __stratos?: Record<string, unknown> };
    g.__stratos = {
      ...(g.__stratos ?? {}),
      journey: j.journey,
      meridian: m.meridian,
      // The portrait composition's own answers: which stages measured dense on
      // this viewport in this locale, and what usable box they were measured
      // against. A capture script that has to *infer* which stages recede picks
      // its own altitudes and then photographs whatever it guessed, which is
      // how a still set ends up not showing the thing it was made to show.
      composition: {
        denseStages: c.denseStages,
        fit: c.currentFit,
        measurement: c.measurement,
        stages: j.STAGES,
        // The rails, for the validator.
        //
        // §13 replaced the global centre tolerance with a deviation from the
        // *intended* rail, which means the check needs to know what the
        // composition intended — and it must not be allowed to work that out
        // for itself. A harness that reimplements `railAt` is a second
        // implementation of the thing under test, and the two agreeing proves
        // only that the same mistake was made twice. Reading the number the
        // page actually composed against is what makes the ±3% meaningful.
        railAt: c.railAt,
        railTrack: c.railTrack,
        railBudget: c.railBudgetNow,
        railOf: c.railOf,
        copySideOf: c.copySideOf,
        railTolerance: c.RAIL_TOLERANCE,
      },
    };
  });
}

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(
    <StrictMode>
      <JourneyBoundary>
        <FullAscent />
      </JourneyBoundary>
    </StrictMode>,
  );
}
