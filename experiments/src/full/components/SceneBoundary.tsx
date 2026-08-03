import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * An error boundary around the WebGL subtree, and *only* the WebGL subtree.
 *
 * The route already had a boundary at the root, which was not enough and was
 * actively harmful. React cannot render half of a subtree that threw, so a
 * throw anywhere inside the Canvas — a lost context during teardown, a model
 * that decodes wrong, an out-of-memory eleven screens into a scroll — unwound
 * all the way to the root boundary and replaced the entire page with a static
 * dial. Everything the visitor came for went with it: the headline, the case
 * studies, the process, the call to action.
 *
 * Caught here instead, the blast radius is the canvas. The narrative, the HUD
 * and every CTA are outside this boundary and stay in the document, which is
 * the behaviour the fallback strategy claims and the reason it is worth
 * claiming: a visitor whose GPU process died still gets the page.
 *
 * Found by test, not by inspection — `the altitude clock is independent of the
 * render loop › reaches the ceiling even if the canvas never renders again`
 * killed the context and then could not find the altitude readout.
 */
export class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ascent scene failed, falling back to the static instrument:', error, info.componentStack);
    // Tell the route, so it swaps in the static instrument and stops trying to
    // mount a Canvas. Rendering `null` here and leaving the route believing the
    // scene is alive would give the visitor an empty stage instead.
    this.props.onError();
  }

  render() {
    // The route re-renders with `failure = 'context-lost'` and puts the static
    // instrument here itself, so this only has to avoid rendering the subtree
    // that threw.
    return this.state.failed ? null : this.props.children;
  }
}
