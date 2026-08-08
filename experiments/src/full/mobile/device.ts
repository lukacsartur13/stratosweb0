/**
 * Which homepage this device gets, decided once and never revisited.
 *
 * ## Why not a media query, and why not `innerWidth`
 *
 * Both of the obvious answers flip while the visitor is reading.
 *
 * `innerHeight` changes by ~90px every time Safari's toolbars collapse or
 * expand, and on iOS that happens on the first upward flick of every session.
 * A composition chosen from it therefore has a real chance of being chosen
 * twice, and the second choice tears down a mounted React tree and rebuilds it
 * underneath a finger that is still moving. §23 of the mobile brief names this
 * exactly: *"Avoid switching back and forth due to Safari toolbar resizing."*
 *
 * `innerWidth` is stable in portrait but not across a rotation, so it makes
 * orientation a composition change — and §23 wants mobile landscape on the same
 * simple composition, not thrown back to the desktop cinematic one.
 *
 * `screen.width` and `screen.height` are the physical panel. They do not move
 * when a toolbar collapses, and taking the *short* edge makes the answer
 * orientation-independent by construction: a phone is a phone in both
 * orientations, and there is no rotation that can change the verdict.
 *
 * ## The threshold
 *
 * 540 CSS px of short edge. The largest phone in the test matrix is 430 wide
 * (iPhone Pro Max) and the widest Android phones reach about 480; the smallest
 * tablet short edge is 744 (iPad mini). 540 sits in the middle of a gap with no
 * devices in it, which is the only kind of threshold that does not need
 * revisiting.
 *
 * A coarse pointer is required as well, so a narrow *desktop* window — a
 * side-by-side split, a devtools-narrowed viewport — keeps the desktop
 * composition it was designed for. Narrowness alone is not a phone.
 */
export const MOBILE_SHORT_EDGE_MAX = 540;

export function isMobileHomepage(): boolean {
  if (typeof matchMedia !== 'function' || typeof screen === 'undefined') return false;
  if (!matchMedia('(pointer: coarse)').matches) return false;

  // `screen` can report 0 in some automation contexts. Falling back to the
  // viewport is worse than the screen but far better than answering "desktop"
  // to a phone because a number was missing.
  const width = screen.width || innerWidth;
  const height = screen.height || innerHeight;
  const shortEdge = Math.min(width, height);
  return shortEdge > 0 && shortEdge <= MOBILE_SHORT_EDGE_MAX;
}

/**
 * Read once, at module scope, and threaded through everything.
 *
 * Not a hook and not re-read per component: the mobile composition asks this
 * question in five places, and five `matchMedia` calls that can disagree
 * mid-render is how a page ends up half-animated.
 */
export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
