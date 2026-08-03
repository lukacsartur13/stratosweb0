/**
 * The instrument's mechanical sounds.
 *
 * Optional in the strongest sense: off by default, never started without a
 * gesture, and nothing in the experience depends on it. There are no audio
 * files — every sound is synthesised from a filtered noise burst and a short
 * body tone, which is a few hundred bytes of code instead of a few hundred
 * kilobytes of samples, and which suits the palette anyway. A ring locking is a
 * dry click and a small settle, not an impact.
 *
 * Three things are being defended against, and all three are the same problem
 * wearing different hats:
 *
 *   1. **Autoplay.** The context is created on the gesture that enables sound
 *      and never before, so nothing is ever suspended-then-resumed behind the
 *      visitor's back.
 *   2. **Reverse-scroll spam.** Every event the instrument can make is a
 *      *threshold crossing*, and a visitor flicking a trackpad over a lock
 *      crosses it repeatedly. Each threshold therefore has hysteresis — it must
 *      be left by a real margin before it can fire again — plus a global
 *      minimum interval.
 *   3. **A stalled clock.** A tab that comes back after ten minutes has an
 *      altitude that jumped; the crossing detector would fire every threshold
 *      between the two positions at once. A jump larger than the hysteresis
 *      band re-arms the thresholds silently instead.
 */

export type MeridianSoundId = 'aperture-step' | 'ring-lock' | 'aperture-snap' | 'settle';

/** Minimum gap between any two sounds. */
const MIN_INTERVAL_MS = 260;

type Threshold = {
  id: MeridianSoundId;
  /** Altitude at which the event happens. */
  at: number;
  /** How far the altitude has to leave the threshold before it can fire again. */
  hysteresis: number;
  armed: boolean;
};

function thresholds(): Threshold[] {
  return [
    { id: 'aperture-step', at: 2_200, hysteresis: 700, armed: true },
    { id: 'ring-lock', at: 7_000, hysteresis: 900, armed: true },
    { id: 'aperture-snap', at: 12_000, hysteresis: 1_100, armed: true },
    { id: 'ring-lock', at: 18_000, hysteresis: 900, armed: true },
    { id: 'ring-lock', at: 24_000, hysteresis: 900, armed: true },
    { id: 'settle', at: 29_600, hysteresis: 600, armed: true },
  ];
}

class MeridianSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private lastPlayed = 0;
  private lastAltitude: number | null = null;
  private marks = thresholds();

  get isEnabled() {
    return this.enabled;
  }

  /**
   * Turn sound on or off. Must be called from a user gesture the first time —
   * that is where the AudioContext comes from.
   */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      void this.context?.suspend();
      return;
    }
    if (!this.context) {
      const Ctor: typeof AudioContext | undefined =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return;
      }
      this.context = new Ctor();
      this.master = this.context.createGain();
      // Quiet. These are mechanism sounds heard from across a room, not
      // foley in the foreground.
      this.master.gain.value = 0.16;
      this.master.connect(this.context.destination);
    }
    void this.context.resume();
    // Coming back on mid-journey must not replay everything already passed.
    this.rearm();
  }

  dispose() {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.enabled = false;
  }

  /** Re-arm every threshold against the current position without firing. */
  private rearm() {
    this.lastAltitude = null;
    for (const mark of this.marks) mark.armed = true;
  }

  /**
   * Feed the altitude in. Called once per frame by the clock's owner, whether
   * or not sound is on — the arming state has to stay honest so that switching
   * it on does not produce a burst.
   */
  update(altitude: number) {
    const previous = this.lastAltitude;
    this.lastAltitude = altitude;
    if (previous === null) return;

    const jump = Math.abs(altitude - previous);

    for (const mark of this.marks) {
      const outside = Math.abs(altitude - mark.at) > mark.hysteresis;
      if (outside) {
        mark.armed = true;
        continue;
      }
      if (!mark.armed) continue;
      // A crossing, in either direction. Reversing back through a lock is a
      // real mechanical event and gets its click.
      const crossed = previous < mark.at !== altitude < mark.at;
      if (!crossed) continue;
      mark.armed = false;
      // A tab that has been in the background has a discontinuous altitude.
      // Nothing mechanical happened; it just resumed.
      if (jump > mark.hysteresis) continue;
      this.play(mark.id);
    }
  }

  play(id: MeridianSoundId) {
    const ctx = this.context;
    const master = this.master;
    if (!this.enabled || !ctx || !master || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    if (performance.now() - this.lastPlayed < MIN_INTERVAL_MS) return;
    this.lastPlayed = performance.now();

    switch (id) {
      case 'ring-lock':
        // Dry, high, short: metal arriving on a stop.
        this.click(now, 2_600, 0.035, 0.9);
        this.body(now + 0.012, 190, 0.09, 0.28);
        break;
      case 'aperture-step':
        // One detent on a lens ring.
        this.click(now, 3_400, 0.02, 0.5);
        break;
      case 'aperture-snap':
        // Blades travelling, then the exact stop at the end of the travel.
        this.sweep(now, 0.26);
        this.click(now + 0.26, 2_100, 0.03, 0.75);
        break;
      case 'settle':
        this.body(now, 130, 0.5, 0.18);
        break;
    }
  }

  /** A filtered noise burst — the transient. */
  private click(at: number, frequency: number, duration: number, level: number) {
    const ctx = this.context!;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Exponential decay, so it reads as a strike rather than a burst.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 6);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 1.6;
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  /** A short damped tone — the mass behind the transient. */
  private body(at: number, frequency: number, duration: number, level: number) {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  /** Blades moving: quiet filtered noise that opens as they travel. */
  private sweep(at: number, duration: number) {
    const ctx = this.context!;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(700, at);
    filter.frequency.linearRampToValueAtTime(2_400, at + duration);
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.22, at + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(at);
    source.stop(at + duration + 0.02);
  }
}

export const meridianSound = new MeridianSound();
