/**
 * The single number the whole prototype is a function of: altitude.
 *
 * This mirrors how the production hero already works — flight.js drives every
 * layer from one altitude value so they can never fall out of step — and it is
 * deliberately *not* React state. At 60fps a `setState` per frame would rerender
 * the tree sixty times a second for a number that only ever reaches a canvas
 * and two text nodes. Scroll writes `target`; the render loop eases `current`
 * toward it; everything else reads.
 */

export const FLOOR_M = 0;
export const CEILING_M = 8000;

/** Where each chapter of the sequence sits on the 0..1 scroll track. */
export const CHAPTERS = [
  { id: 'ground', from: 0.0, to: 0.14 },
  { id: 'activation', from: 0.06, to: 0.24 },
  { id: 'ascent', from: 0.24, to: 0.56 },
  { id: 'haze', from: 0.56, to: 0.78 },
  { id: 'clouds', from: 0.78, to: 1.0 },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];

export const ascent = {
  /** Scroll progress, 0..1, written by ScrollTrigger. */
  target: 0,
  /** Eased progress, 0..1, advanced once per frame. */
  current: 0,
  /** `current` expressed in metres. */
  altitude: FLOOR_M,
  /** 0..1 across the instrument's power-on ramp. */
  power: 0,
  /** Pointer position in clip space, -1..1, for the parallax budget. */
  pointer: { x: 0, y: 0 },
  /** Set false while the tab is hidden so nothing integrates against a stalled clock. */
  running: true,
};

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0..1 progress through an arbitrary sub-range of the track. */
export const span = (v: number, from: number, to: number) => clamp((v - from) / (to - from || 1));

/** Smoothstep, for anything that should arrive rather than stop. */
export const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Frame-rate independent damping. `lerp(a, b, 0.1)` moves ten percent of the
 * way per *frame*, which is twice as fast on a 120Hz display as on a 60Hz one;
 * this moves ten percent of the way per fixed slice of *time* instead.
 */
export function damp(current: number, target: number, smoothing: number, dt: number) {
  return lerp(current, target, 1 - Math.pow(smoothing, dt * 60));
}

/** Advance the eased value. Called once per frame, by exactly one owner. */
export function advance(dt: number) {
  ascent.current = damp(ascent.current, ascent.target, 0.82, Math.min(dt, 1 / 20));
  ascent.altitude = FLOOR_M + (CEILING_M - FLOOR_M) * ascent.current;
  ascent.power = ease(span(ascent.current, 0.05, 0.2));
  return ascent;
}

/** Hungarian thousands separator, matching the readout the live site already uses. */
const fmt = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 });
export const formatAltitude = (m: number) => fmt.format(Math.round(m));
