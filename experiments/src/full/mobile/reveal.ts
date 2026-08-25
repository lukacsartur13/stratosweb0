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
export const REVEAL_SELECTOR = '.mv-text, .mv-lines, .mv-copy, .mv-label, .mv-rule, .mv-head';

/**
 * The chapter markers, which are revealed on a different line from everything
 * else — see `HEAD_MARGIN`.
 */
export const HEAD_SELECTOR = '.mv-head';

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

/**
 * Where a CHAPTER MARKER is revealed, and this is the whole of reverse gravity
 * on the phone.
 *
 * ## The problem it solves
 *
 * Document content moves upward under a downward scroll. That is not negotiable
 * — the direction is explicit that the scroll must stay ordinary — so the only
 * thing a page can decide is WHERE a piece of copy is when it is first painted.
 * At the shared line above, a chapter's headline is painted the instant its
 * first pixel crosses 88% of the frame, which means the visitor watches it
 * travel the whole height of the screen from the bottom edge. Whatever else the
 * page does, that single gesture says "content is being fed to you", eleven
 * times over.
 *
 * ## The rule
 *
 * A chapter marker is not painted at all while it is in the lower half of the
 * frame. It is revealed once it has reached 54% — and then, because the reveal
 * itself now travels DOWNWARD (see `.mv-lines__in` in mobile.css), it settles
 * into place from above. What the visitor sees is a statement appearing
 * overhead and coming down to meet them, never one climbing up to them.
 *
 * The pair is observed as one box, `.mv-head`, so the altitude label and the
 * headline cross the line together.
 *
 * ## Why only the markers
 *
 * Body copy, list items and the marks rail keep the shared line, and that is
 * §2's instruction rather than a compromise: the rule is for chapter titles,
 * statements and transitions, and applying it to every paragraph would leave
 * the lower two thirds of the frame empty of anything painted while the visitor
 * scrolls through a seven-item timeline.
 *
 * ## Why nothing can be stranded
 *
 * An element that never reaches 54% would never be revealed. Nothing on this
 * page can be in that position: the homepage flow is followed by the site's
 * Arrival panel and the ground-control footer, which are together taller than a
 * phone screen, so every `.mv-head` is carried well past the middle of the frame
 * before the document runs out of scroll. The last chapter marker on the page
 * clears the line by more than a full viewport.
 */
const HEAD_MARGIN = '0px 0px -46% 0px';

let observer: IntersectionObserver | null = null;
let headObserver: IntersectionObserver | null = null;
let passedObserver: IntersectionObserver | null = null;

/** Chapter markers still waiting to be revealed. See `sweep`. */
const pending = new Set<Element>();

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


  // Two observers, one behaviour. They differ in exactly one option — where the
  // line sits — and a single observer cannot carry two `rootMargin` values.
  const reveal = (entries: IntersectionObserverEntry[], from: IntersectionObserver) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      from.unobserve(entry.target);
    }
  };

  observer ??= new IntersectionObserver((entries) => reveal(entries, observer!), {
    rootMargin: ROOT_MARGIN,
    threshold: THRESHOLD,
  });

  // A chapter marker resolves as ONE event, so the box is what is observed and
  // the label and the headline inside it are marked with it.
  //
  // Not merely tidier: `.mv-label` and `.mv-lines` are themselves reveal roles,
  // so left registered with the shared observer they would each be revealed at
  // 88% — on their own, a third of a screen apart, and a third of a screen
  // before the box they belong to reaches the line that is supposed to govern
  // them. The high line would then apply to a wrapper whose contents were
  // already painted, which is no line at all.
  const resolveHead = (el: Element) => {
    pending.delete(el);
    el.classList.add('is-in');
    for (const child of el.querySelectorAll(REVEAL_SELECTOR)) child.classList.add('is-in');
    headObserver?.unobserve(el);
    passedObserver?.unobserve(el);
  };

  /**
   * Anything already above the frame, resolved — whether or not an observer ever
   * saw it get there.
   *
   * Both observers report CROSSINGS, and a crossing can be missed twice over: a
   * scroll delta larger than the root skips it, and delivery is coalesced, so
   * two smaller deltas inside one delivery window skip it just as thoroughly.
   * The second is not hypothetical and it is not only a fling — measured on
   * WebKit, a scripted walk in eight-tenths-of-a-screen steps lost a marker
   * about one run in three, and the marker it lost was a different one each
   * time. A marker that is never reported stays at `opacity: 0` for the rest of
   * the session, which is not a motion defect, it is missing content.
   *
   * So the last word is a position rather than a crossing: when a marker leaves
   * the viewport, every marker still waiting is asked whether it is above the
   * frame, and one that is has been passed by definition.
   *
   * It is a layout read, which this page otherwise does not do — so it is worth
   * being exact about when. Only on `passedObserver`'s callback, which fires
   * when a marker enters or leaves the frame and not otherwise; never on a
   * scroll frame; only while something is still pending, which on a full read of
   * the document is the first two thirds of it; and over a set of at most eleven
   * elements that shrinks to nothing as the visitor descends. Measured on the
   * cost probe it is 96 reads over a twenty-step read of the whole page, against
   * the 138 the page already performs.
   *
   * Not on `headObserver`'s callback as well, which was the first version: that
   * one fires on every crossing of the reveal line, roughly doubling the reads
   * for a case it cannot catch — a marker it is firing for is a marker it is
   * already resolving.
   */
  const sweep = () => {
    if (pending.size === 0) return;
    for (const el of [...pending]) {
      if (el.getBoundingClientRect().bottom <= 0) resolveHead(el);
    }
  };

  headObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) resolveHead(entry.target);
    },
    { rootMargin: HEAD_MARGIN, threshold: THRESHOLD },
  );

  /**
   * The net, and it exists because the high line has a hole the shared line
   * does not.
   *
   * An `IntersectionObserver` reports a *crossing*, not a position. Its root
   * here is the top 54% of the frame, so a marker that is below that root on
   * one sampled frame and above the whole viewport on the next has been at a
   * ratio of zero throughout, has crossed no threshold, and is never reported —
   * which leaves it at `opacity: 0` for the rest of the session. Content that is
   * permanently invisible after a fast flick is not a motion defect, it is
   * missing content.
   *
   * The shared line is nearly immune to this by geometry: its root is 88% of the
   * frame, so a marker would have to travel most of a screen plus its own height
   * between two frames to slip through. At 54% the gap is a little over a third
   * of a screen — which a scroll walk of eight tenths of a screen steps straight
   * over, and which a real fling clears easily. Measured on WebKit at 430×932,
   * two of the eleven markers were never revealed.
   *
   * So a second observer watches the *whole* viewport and resolves a marker that
   * has left it upward. It is a catch, not a second reveal line: by the time it
   * fires the marker is off the top of the screen and the visitor has passed it,
   * so what it changes is what they find on the way back up.
   */
  passedObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) continue;
        const above = entry.rootBounds ? entry.rootBounds.top : 0;
        if (entry.boundingClientRect.bottom <= above) resolveHead(entry.target);
      }
      sweep();
    },
    { threshold: 0 },
  );

  for (const el of targets) {
    stagger(el);
    if (el.matches(HEAD_SELECTOR)) {
      pending.add(el);
      headObserver.observe(el);
      passedObserver.observe(el);
    }
    // Anything inside a marker is resolved by the marker, above.
    else if (!el.closest(HEAD_SELECTOR)) observer.observe(el);
  }

  return () => {
    observer?.disconnect();
    observer = null;
    headObserver?.disconnect();
    headObserver = null;
    passedObserver?.disconnect();
    passedObserver = null;
    pending.clear();
  };
}
