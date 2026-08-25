import { prefersReducedMotion } from './device';

/**
 * The portrait homepage's text motion, and all of it.
 *
 * One `IntersectionObserver` for the whole document. An element crosses the
 * threshold, gains `.is-in`, and is unobserved — after which no JavaScript is
 * involved in its animation at all, because the animation is a CSS transition
 * that was already declared. This is §8 of the brief and it is what the
 * Rapidkert audit found underneath that site's directness.
 *
 * Consequences worth stating, because each is a decision:
 *
 *   * **Fires once.** `unobserve` on intersect. Scrolling back up does not
 *     replay anything and does not re-arm anything; the observer's working set
 *     shrinks to nothing as the visitor descends. §6 explicitly does not ask
 *     for reverse animation.
 *   * **No per-element scroll maths.** Nothing here reads a scroll position.
 *   * **No React involvement.** The class lands on a DOM node. No state, no
 *     re-render, no reconciliation on a scroll frame.
 *   * **Stagger is a CSS custom property**, written once when the element is
 *     registered, not per frame.
 *
 * ## Reduced motion
 *
 * Everything is marked visible immediately and no observer is created. §24: the
 * content is all still there, it simply does not travel to get there. The
 * stylesheet resolves the same classes to their final state as well, so a
 * visitor with the preference set sees the composed page even if this module
 * never runs.
 */

/** The reveal roles, and the classes that carry them. See mobile.css. */
export const REVEAL_SELECTOR = '.mv-text, .mv-lines, .mv-copy, .mv-label, .mv-rule';

/**
 * 90 ms per sibling, capped at 0.55 s of total lead.
 *
 * Both numbers are Rapidkert's, measured rather than invented — see §3 of
 * `_build/reports/rapidkert-mobile-motion-reference.md`. The cap is the part
 * that matters: without it a nine-item list has the last item arriving 0.8 s
 * after the first, and a list that takes a second to finish assembling reads as
 * slow however well each item moves.
 */
export const STAGGER_STEP = 0.09;
export const STAGGER_MAX = 0.55;

/**
 * Where the reveal line sits.
 *
 * `-12%` at the bottom means an element starts its reveal when it is genuinely
 * entering the reading area rather than the instant its first pixel crosses the
 * fold — which on a phone is the difference between copy that arrives as you
 * reach it and copy that has already finished moving by the time you look at
 * it. `threshold: 0.08` keeps a tall block from triggering on a sliver.
 *
 * Both are Rapidkert's values.
 */
const ROOT_MARGIN = '0px 0px -12% 0px';
const THRESHOLD = 0.08;

let observer: IntersectionObserver | null = null;

/** Mark an element composed without animating it. */
const resolve = (el: Element) => el.classList.add('is-in');

/**
 * Give an element its stagger, if it asked for one and does not already have it.
 *
 * `data-stagger` is an index within its group, not a delay: the delay is
 * computed here so the cap is applied in one place and a group that grows does
 * not quietly start taking longer than the cap allows.
 */
function stagger(el: HTMLElement) {
  if (el.style.getPropertyValue('--mv-delay')) return;
  const index = Number(el.dataset.stagger || 0);
  if (index > 0) {
    el.style.setProperty('--mv-delay', `${Math.min(index * STAGGER_STEP, STAGGER_MAX)}s`);
  }
}

/**
 * Start revealing, and return a teardown.
 *
 * `root` is the subtree to scan, so a component can register its own late-
 * arriving nodes without rescanning the document.
 */
export function startReveals(root: ParentNode = document): () => void {
  const targets = root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);

  // No observer at all on either of these paths. A visitor who has asked for
  // reduced motion should not have an IntersectionObserver running to decide
  // not to animate, and a browser without the API gets the composed page rather
  // than a page of invisible text — which is the failure mode of every reveal
  // system that treats the observer as guaranteed.
  if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
    targets.forEach(resolve);
    return () => {};
  }

  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: ROOT_MARGIN, threshold: THRESHOLD },
    );
  }

  for (const el of targets) {
    stagger(el);
    observer.observe(el);
  }

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
