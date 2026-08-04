import { useEffect, useRef, useState } from 'react';
import {
  STAGES,
  formatAltitude,
  journey,
  notifyDebugChange,
  stageStart,
  type MountainDebug,
} from '../journey';
import { ALTITUDE_STOPS, RINGS, meridian } from '../meridian';
import { meridianSound } from '../meridianSound';
import { MOUNTAIN_LOOK } from '../mountainLook';

/**
 * Development-only controls.
 *
 * Two guarantees, and the second is the one that matters:
 *
 *   1. this module is only ever imported inside an `import.meta.env.DEV`
 *      branch, which Rollup statically replaces with `false` in a production
 *      build and then dead-code-eliminates along with the dynamic import — so
 *      the chunk is never emitted, not merely never rendered;
 *   2. it writes to `journey.debug`, where every value defaults to `null`,
 *      `'auto'` or `1` and is consumed as a null check or a multiply, so
 *      removing the panel cannot change what the scene looks like.
 *
 * It is deliberately plain: sliders and jump lists, no dependency, no styling
 * framework. A debug panel that needs its own build tooling is a second thing
 * to maintain.
 *
 * `?meridianDebug=1` opens it on load, which is what makes it useful for
 * inspecting an exact altitude state without scrolling eleven screens to it —
 * pair it with the altitude override and the jump buttons below.
 */
type Knob = { key: keyof typeof journey.debug; label: string; min: number; max: number; step: number };

const ATMOSPHERE: Knob[] = [
  { key: 'cloudDensity', label: 'Felhősűrűség', min: 0, max: 2, step: 0.05 },
  { key: 'starDensity', label: 'Csillagsűrűség', min: 0, max: 2, step: 0.05 },
  { key: 'earthScale', label: 'Föld mérete', min: 0.4, max: 2.2, step: 0.05 },
  { key: 'horizonGlow', label: 'Horizontfény', min: 0, max: 2, step: 0.05 },
  { key: 'atmosphereDark', label: 'Légkör sötétsége', min: 0.2, max: 1.6, step: 0.05 },
  { key: 'cameraZ', label: 'Kamera Z eltolás', min: -1.5, max: 1.5, step: 0.02 },
];

const INSTRUMENT: Knob[] = [
  { key: 'ringRotation', label: 'Gyűrűk forgása', min: 0, max: 4, step: 0.1 },
  { key: 'instrumentYaw', label: 'Műszer szöge', min: -0.9, max: 0.9, step: 0.01 },
  { key: 'lightGain', label: 'Áttörési fény', min: 0, max: 3, step: 0.05 },
];

/** The instrument's own stops, which are not the narrative's stage boundaries. */
const STOPS = Object.entries(ALTITUDE_STOPS) as [keyof typeof ALTITUDE_STOPS, number][];

/** The shape of `WebGLRenderer.info` this panel reads. Declared locally so the
 *  panel does not import `three` — it is reachable from the eager chunk. */
type THREE_INFO = {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
  programs?: { length: number };
};

export default function DebugPanel() {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('meridianDebug'));
  const [, force] = useState(0);
  const readout = useRef<HTMLSpanElement>(null);

  const rerender = () => {
    notifyDebugChange();
    force((n) => n + 1);
  };

  // The readouts in here are debug instruments, so they sample rather than
  // subscribe: four times a second is plenty to work against and costs nothing
  // next to the scene.
  useEffect(() => {
    const id = setInterval(() => {
      if (!readout.current) return;
      const r = meridian.rings;
      // §12 asks for the quality state to be *recorded*, and this is where a
      // person reads it. The renderer's own numbers come off the dev handle the
      // scene publishes; the cloud line is the canonical state, not a second
      // derivation of it.
      const h = globalThis as unknown as {
        __stratos?: { cloud?: import('../cloud').CloudState; gl?: { info: THREE_INFO; getPixelRatio(): number } };
      };
      const cloud = h.__stratos?.cloud;
      const gl = h.__stratos?.gl;
      readout.current.textContent =
        `${formatAltitude(journey.altitude)} m · ${journey.stage} · p=${journey.current.toFixed(3)}\n` +
        `rekesz ${meridian.apertureOpen.toFixed(3)} · fény ${meridian.lightBreakthrough.toFixed(2)} · ` +
        `gimbal ${meridian.gimbalStrength.toFixed(2)} · kalibráció ${meridian.finalCalibration.toFixed(2)}\n` +
        r
          .map((s, i) => `gy${i + 1} varrat ${s.seam.toFixed(2)} emelés ${s.lift.toFixed(2)} zár ${s.settle.toFixed(2)}${s.locked ? ' ✔' : ''}`)
          .join('\n') +
        (cloud
          ? `\nfelhő ${cloud.art} · fedés ${cloud.coverage.toFixed(3)} · átlátszatlanság ${cloud.opacity.toFixed(3)}\n` +
            `rétegek ${cloud.layers.distant}/${cloud.layers.enclosure}/${cloud.layers.floor} = ${cloud.layerCount} · ` +
            `mintavétel ${cloud.sampling} · szint ${cloud.qualityTier}\n` +
            `y ${cloud.verticalPosition.toFixed(2)} · rekesz-szabad ${cloud.apertureClearance.toFixed(2)} · ` +
            `hegyhalványulás ${cloud.mountainFade.toFixed(2)} · Meridián-kontraszt ${cloud.meridianContrast.toFixed(3)}`
          : '\nfelhő —') +
        (gl
          ? `\nDPR ${gl.getPixelRatio()} · rajzhívás ${gl.info.render.calls} · háromszög ${gl.info.render.triangles}\n` +
            `geometria ${gl.info.memory.geometries} · textúra ${gl.info.memory.textures} · program ${gl.info.programs?.length ?? 0}`
          : '');
    }, 250);
    return () => clearInterval(id);
  }, []);

  // `d` toggles it. Not a modifier chord: this is a dev build, nothing else is
  // listening, and a one-key toggle is what actually gets used.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (e.key === 'd' || e.key === 'D') setOpen((v) => !v);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const jump = (id: string) => {
    const track = document.querySelector('[data-testid="journey-track"]') as HTMLElement | null;
    if (!track) return;
    const travel = track.offsetHeight - innerHeight;
    scrollTo({ top: track.offsetTop + travel * stageStart(id as never), behavior: 'instant' as ScrollBehavior });
  };

  if (!open) {
    return (
      <button className="debug__toggle" onClick={() => setOpen(true)} title="Debug (d)">
        debug
      </button>
    );
  }

  const altitudeOverride = journey.debug.altitude;

  return (
    <aside className="debug" data-testid="debug-panel">
      <header className="debug__head">
        <b>Meridian debug</b>
        <button onClick={() => setOpen(false)} aria-label="Bezárás">
          ×
        </button>
      </header>

      <pre className="debug__readout">
        <span ref={readout}>—</span>
      </pre>

      {/* --- altitude ------------------------------------------------------ */}
      <p className="debug__label">Magasság</p>
      <label className="debug__check">
        <input
          type="checkbox"
          checked={altitudeOverride !== null}
          onChange={(e) => {
            journey.debug.altitude = e.currentTarget.checked ? journey.altitude : null;
            rerender();
          }}
        />
        Magasság felülírása
      </label>
      <label className="debug__knob">
        <span>
          Magasság <i>{formatAltitude(altitudeOverride ?? journey.altitude)} m</i>
        </span>
        <input
          type="range"
          min={0}
          max={30_000}
          step={50}
          disabled={altitudeOverride === null}
          value={altitudeOverride ?? journey.altitude}
          onInput={(e) => {
            journey.debug.altitude = Number(e.currentTarget.value);
            force((n) => n + 1);
          }}
        />
      </label>

      <div className="debug__jumps">
        {STOPS.map(([id, metres]) => (
          <button
            key={id}
            onClick={() => {
              journey.debug.altitude = metres;
              rerender();
            }}
          >
            {formatAltitude(metres)} m<i>{id}</i>
          </button>
        ))}
      </div>

      {/* --- the mechanism -------------------------------------------------- */}
      <p className="debug__label">Szerkezet</p>
      <Override
        label="Rekesznyitás"
        value={journey.debug.aperture}
        derived={meridian.apertureOpen}
        onChange={(v) => {
          journey.debug.aperture = v;
          force((n) => n + 1);
        }}
      />
      {RINGS.map((ring, i) => (
        <Override
          key={ring.id}
          label={`Gyűrű ${i + 1} zárása`}
          value={journey.debug.ringLock[i] ?? null}
          derived={meridian.rings[i].settle}
          onChange={(v) => {
            journey.debug.ringLock[i] = v;
            force((n) => n + 1);
          }}
        />
      ))}
      <Override
        label="Végső kalibráció"
        value={journey.debug.finalCalibration}
        derived={meridian.finalCalibration}
        onChange={(v) => {
          journey.debug.finalCalibration = v;
          force((n) => n + 1);
        }}
      />

      {INSTRUMENT.map((k) => (
        <label className="debug__knob" key={k.key}>
          <span>
            {k.label} <i>{String(journey.debug[k.key])}</i>
          </span>
          <input
            type="range"
            min={k.min}
            max={k.max}
            step={k.step}
            defaultValue={journey.debug[k.key] as number}
            onInput={(e) => {
              (journey.debug[k.key] as number) = Number(e.currentTarget.value);
              force((n) => n + 1);
            }}
          />
        </label>
      ))}

      {/* --- capability ----------------------------------------------------- */}
      <p className="debug__label">Képesség</p>
      <label className="debug__knob">
        <span>Minőségi szint</span>
        <select
          value={journey.debug.quality}
          onChange={(e) => {
            journey.debug.quality = e.currentTarget.value as typeof journey.debug.quality;
            rerender();
          }}
        >
          <option value="auto">auto (eszköz szerint)</option>
          <option value="full">full</option>
          <option value="reduced">reduced (mobil)</option>
        </select>
      </label>
      <label className="debug__knob">
        <span>Kényszerített tartalék</span>
        <select
          value={journey.debug.forceFallback}
          onChange={(e) => {
            journey.debug.forceFallback = e.currentTarget.value as typeof journey.debug.forceFallback;
            rerender();
          }}
        >
          <option value="none">nincs (3D fut)</option>
          <option value="reduced-motion">csökkentett mozgás</option>
          <option value="no-webgl">nincs WebGL</option>
        </select>
      </label>
      <p className="debug__note">
        A csökkentett mozgás valódi médialekérdezését ez nem állítja át — a tesztek mindig az igazit
        olvassák. Ez csak a tartalék útvonal megtekintésére van.
      </p>

      <label className="debug__check">
        <input
          type="checkbox"
          defaultChecked={meridianSound.isEnabled}
          onChange={(e) => meridianSound.setEnabled(e.currentTarget.checked)}
        />
        Műszerhangok
      </label>
      <label className="debug__check">
        <input
          type="checkbox"
          defaultChecked={journey.debug.freeze}
          onChange={(e) => {
            journey.debug.freeze = e.currentTarget.checked;
          }}
        />
        Óra megállítása
      </label>

      {/* --- atmosphere ----------------------------------------------------- */}
      <p className="debug__label">Légkör</p>
      {ATMOSPHERE.map((k) => (
        <label className="debug__knob" key={k.key}>
          <span>
            {k.label} <i>{String(journey.debug[k.key])}</i>
          </span>
          <input
            type="range"
            min={k.min}
            max={k.max}
            step={k.step}
            defaultValue={journey.debug[k.key] as number}
            onInput={(e) => {
              (journey.debug[k.key] as number) = Number(e.currentTarget.value);
              force((n) => n + 1);
            }}
          />
        </label>
      ))}

      {/* --- mountains ------------------------------------------------------ */}
      <MountainSection onChange={rerender} />

      <p className="debug__label">Szakaszhatárok</p>
      <div className="debug__jumps">
        {STAGES.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              journey.debug.altitude = null;
              jump(s.id);
              rerender();
            }}
          >
            {s.label}
            <i>{formatAltitude(s.from)}</i>
          </button>
        ))}
      </div>
    </aside>
  );
}

/**
 * Mountain art direction.
 *
 * Every control here writes `journey.debug.mountainLook`, which `applyLook`
 * reads once per frame and layers over the preset in `mountainLook.ts`. The
 * point of the section is that the presets get *chosen* rather than guessed:
 * the constants in that file are the ones these sliders settled on, and the
 * numbers in the comments beside them are what these sliders measured.
 *
 * The whole panel is dev-only — the module is imported inside an
 * `import.meta.env.DEV` branch that Rollup removes along with its chunk — so
 * none of this is shipped, and `MountainRange` passes `null` for the override
 * bag in a production build, which removes the reads as well.
 */
const KEY_KNOBS: {
  key: keyof MountainDebug;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Where the preset's own value comes from, for the "off" readout. */
  preset: (v: 'desktop' | 'mobile') => number;
}[] = [
  { key: 'keyAzimuth', label: 'Kulcsfény iránya (°)', min: -180, max: 180, step: 1, preset: (v) => MOUNTAIN_LOOK[v].key.azimuth },
  { key: 'keyElevation', label: 'Kulcsfény magassága (°)', min: -20, max: 80, step: 1, preset: (v) => MOUNTAIN_LOOK[v].key.elevation },
  { key: 'keyIntensity', label: 'Kulcsfény erőssége', min: 0, max: 1.6, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].keyIntensity },
  { key: 'fillIntensity', label: 'Derítés', min: 0, max: 0.6, step: 0.005, preset: (v) => MOUNTAIN_LOOK[v].fillIntensity },
  { key: 'levelNear', label: 'Előtér szintje', min: 0, max: 2, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].level[0] },
  { key: 'levelMid', label: 'Középtér szintje', min: 0, max: 2, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].level[1] },
  { key: 'levelFar', label: 'Háttér szintje', min: 0, max: 2, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].level[2] },
  { key: 'crestGain', label: 'Gerincek kiemelése', min: 0, max: 1.2, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].crestGain },
  { key: 'valleyDarken', label: 'Völgytalp sötétítése', min: 0, max: 1, step: 0.01, preset: (v) => MOUNTAIN_LOOK[v].valleyDarken },
  { key: 'depthFog', label: 'Mélységi köd ×', min: 0, max: 3, step: 0.02, preset: () => 1 },
  { key: 'heightFog', label: 'Magassági köd ×', min: 0, max: 3, step: 0.02, preset: () => 1 },
];

function MountainSection({ onChange }: { onChange: () => void }) {
  const [, force] = useState(0);
  const look = journey.debug.mountainLook;
  // `auto` follows the loaded GLB; for the readouts, guess the same way the
  // asset picker does so the "off" values shown are the ones actually in use.
  const active = look.preset !== 'auto' ? look.preset : innerWidth / innerHeight < 1 ? 'mobile' : 'desktop';
  const bump = () => force((n) => n + 1);

  return (
    <>
      <p className="debug__label">Hegyek</p>

      <label className="debug__knob">
        <span>Megjelenítés</span>
        <select
          value={journey.debug.mountains}
          onChange={(e) => {
            journey.debug.mountains = e.currentTarget.value as typeof journey.debug.mountains;
            onChange();
          }}
        >
          <option value="timeline">idővonal (élő)</option>
          <option value="forced-on">mindig látszik</option>
          <option value="forced-off">kikapcsolva (A/B alap)</option>
        </select>
      </label>

      <label className="debug__knob">
        <span>Fénybeállítás</span>
        <select
          value={look.preset}
          onChange={(e) => {
            look.preset = e.currentTarget.value as MountainDebug['preset'];
            bump();
          }}
        >
          <option value="auto">auto (betöltött változat)</option>
          <option value="desktop">desktop</option>
          <option value="mobile">mobil</option>
        </select>
      </label>

      {KEY_KNOBS.map((k) => (
        <MountainKnob
          key={k.key}
          label={k.label}
          min={k.min}
          max={k.max}
          step={k.step}
          value={look[k.key] as number | null}
          fallback={k.preset(active)}
          onChange={(v) => {
            (look[k.key] as number | null) = v;
            bump();
          }}
        />
      ))}

      <label className="debug__knob">
        <span>
          Légkör színe <i>{look.atmosphere === null ? 'preset' : `#${look.atmosphere.toString(16).padStart(6, '0')}`}</i>
        </span>
        <input
          type="color"
          value={`#${(look.atmosphere ?? MOUNTAIN_LOOK[active].fogColor).toString(16).padStart(6, '0')}`}
          onInput={(e) => {
            look.atmosphere = Number.parseInt(e.currentTarget.value.slice(1), 16);
            bump();
          }}
        />
      </label>
      <button
        className="debug__reset"
        onClick={() => {
          look.atmosphere = null;
          bump();
        }}
      >
        Légkör színe vissza
      </button>

      {/* The station nudge. Not a light, but it is the other half of the mobile
          composition problem and it has to be findable by moving it, not by
          rebuilding the terrain to test a hypothesis about 100 metres. */}
      <label className="debug__knob">
        <span>
          Kamera előre (m) <i>{look.stationForward}</i>
        </span>
        <input
          type="range"
          min={-600}
          max={600}
          step={10}
          value={look.stationForward}
          onInput={(e) => {
            look.stationForward = Number(e.currentTarget.value);
            bump();
          }}
        />
      </label>
      <label className="debug__knob">
        <span>
          Kamera emelés (m) <i>{look.stationRise}</i>
        </span>
        <input
          type="range"
          min={-400}
          max={400}
          step={10}
          value={look.stationRise}
          onInput={(e) => {
            look.stationRise = Number(e.currentTarget.value);
            bump();
          }}
        />
      </label>

      <button
        className="debug__reset"
        onClick={() => {
          for (const k of KEY_KNOBS) (look[k.key] as number | null) = null;
          look.atmosphere = null;
          look.preset = 'auto';
          look.stationForward = 0;
          look.stationRise = 0;
          journey.debug.mountains = 'timeline';
          onChange();
          bump();
        }}
      >
        Hegyek alaphelyzetbe
      </button>
    </>
  );
}

/**
 * A slider that reports the preset's value while it is off.
 *
 * Same idea as `Override` below, and a separate component only because these
 * are not all 0..1 and because showing the number the preset would have used is
 * what makes a session of these sliders produce constants rather than a feeling.
 */
function MountainKnob({
  label,
  min,
  max,
  step,
  value,
  fallback,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  fallback: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="debug__knob debug__knob--override">
      <span>
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.currentTarget.checked ? fallback : null)}
        />
        {label} <i>{value === null ? `preset ${fallback}` : value}</i>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={value === null}
        value={value ?? fallback}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

/**
 * A slider that is off until you turn it on.
 *
 * Overrides start as `null` — "the altitude decides" — and a slider that always
 * has a value cannot express that. The checkbox is the difference between
 * inspecting a state and pinning one.
 */
function Override({
  label,
  value,
  derived,
  onChange,
}: {
  label: string;
  value: number | null;
  derived: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="debug__knob debug__knob--override">
      <span>
        <input
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.currentTarget.checked ? derived : null)}
        />
        {label} <i>{(value ?? derived).toFixed(2)}</i>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        disabled={value === null}
        value={value ?? derived}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}
