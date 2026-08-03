import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AltitudeHUD } from '@/components/AltitudeHUD';
import { PrototypeFallback } from '@/components/PrototypeFallback';
import { detect, hasFinePointer, type Capability } from '@/lib/capabilities';
import { usePointerDriver, useScrollDriver, useVisibilityDriver } from '@/lib/useScrollDriver';

// Lazy, and lazy on purpose. This is the only import path to `three`,
// `@react-three/*` and the GLB; a visitor on the reduced-motion or no-WebGL
// path never requests any of it.
const AscentScene = lazy(() => import('@/components/AscentScene'));

type Failure = 'reduced-motion' | 'no-webgl' | 'context-lost';

export function AscentPrototype() {
  const track = useRef<HTMLDivElement>(null);

  // Capabilities are read after mount, never during render: `matchMedia` and a
  // WebGL probe are both side effects, and reading them in the render body
  // would make the first paint depend on them.
  const [capability, setCapability] = useState<Capability | null>(null);
  const [crashed, setCrashed] = useState(false);

  useEffect(() => setCapability(detect()), []);

  const live = capability?.ok === true && !crashed;
  useScrollDriver(track, live);
  usePointerDriver(live && capability?.tier === 'full' && hasFinePointer());
  useVisibilityDriver();

  const onContextLost = useCallback(() => setCrashed(true), []);

  const failure: Failure | null =
    crashed ? 'context-lost' : capability && !capability.ok ? capability.reason : null;

  return (
    <main className="ascent" id="main">
      <a className="skip" href="#ascent-content">
        Ugrás a tartalomra
      </a>

      <div className="ascent__track" ref={track} data-testid="ascent-track">
        {/* The stage is sticky; the narrative scrolls over it. */}
        <div className="ascent__stage">
          {/* The rendered scene carries no information the prose does not, so
              it is hidden from assistive technology rather than described. The
              fallback is not: its SVG has a label and is the only instrument
              a non-WebGL visitor gets. */}
          <div className="stage__surface" aria-hidden={failure ? undefined : 'true'}>
            {failure ? (
              <PrototypeFallback reason={failure} />
            ) : capability?.ok ? (
              <Suspense fallback={<div className="stage__loading" data-testid="scene-loading" />}>
                <AscentScene
                  simplified={capability.tier === 'reduced'}
                  parallax={capability.tier === 'full'}
                  onContextLost={onContextLost}
                />
              </Suspense>
            ) : (
              // Pre-detection. Deliberately empty and dark rather than a
              // spinner: the check takes a single frame.
              <div className="stage__loading" />
            )}
          </div>

          {/* The readout drives the clock, so it is mounted on every path that
              has an ascent to show. Reduced motion is the one exception: there
              is nothing to advance when nothing moves. */}
          {failure !== 'reduced-motion' && <AltitudeHUD />}
        </div>

        <div className="ascent__narrative" id="ascent-content">
          <Chapter
            level="h1"
            eyebrow="Prototípus · 0 méter"
            altitude="0 m"
            title={
              <>
                Minden emelkedés <em>a földön</em> kezdődik.
              </>
            }
          >
            <p>
              Ez a lap egy fejlesztői kísérlet: a jelenlegi, könnyűsúlyú SVG-és-WebGL főoldali hero
              mellé állít egy valódi, Blenderben modellezett 3D műszert. Nem éles tartalom, és nem
              váltja le a főoldalt.
            </p>
            <p className="chapter__meta">
              A műszer egyedi modell — nem katalógusból vett pilótafülke-óra.
            </p>
          </Chapter>

          <Chapter eyebrow="I · Bekapcsolás" altitude="≈ 400 m" title={<>A műszer <em>életre kel.</em></>}>
            <p>
              A számlap sötétből világosodik ki: a jelölések, a mutató és a 8 000 méteres határív
              kap fényt. Innentől minden, amit látsz, egyetlen számnak a függvénye — a magasságnak.
            </p>
          </Chapter>

          <Chapter eyebrow="II · Emelkedés" altitude="≈ 2 600 m" title={<>A hosszú mutató <em>ezresével</em> számol.</>}>
            <p>
              A hosszú mutató körönként 1 000 métert tesz meg, a rövid a teljes 10 000 méteres
              skálát járja be. Ugyanaz a leképezés, mint egy valódi magasságmérőn — a görgetés csak
              a bemenet.
            </p>
          </Chapter>

          <Chapter eyebrow="III · Páraréteg" altitude="≈ 5 000 m" title={<>A levegő <em>ritkul.</em></>}>
            <p>
              A köd sűrűsége és színe is a magassággal változik: a földi feketéből grafitkékbe, majd
              hideg szürkébe vált. Egyetlen textúra sem érkezik a hálózatról — a párát a böngésző
              rajzolja meg futásidőben.
            </p>
          </Chapter>

          <Chapter
            eyebrow="IV · Első felhőréteg"
            altitude="8 000 m"
            title={<>És itt kezdődik a <em>sztratoszféra felé</em> vezető út.</>}
            last
          >
            <p>
              A prototípus 8 000 méternél megáll. A teljes út — 30 000 méterig — a jelenlegi
              főoldal narratívája; ez a kísérlet csak az első szakaszt vizsgálja, technikailag.
            </p>
            <p className="chapter__actions">
              <a className="btn" href="/arajanlat.html">
                Váltsuk valóra
              </a>
              <a className="btn btn--ghost" href="/index.html">
                Jelenlegi főoldal
              </a>
            </p>
          </Chapter>
        </div>
      </div>

      <footer className="ascent__footer">
        <p>
          Stratos — fejlesztői prototípus. Nem publikus oldal, nem indexelt, és nem része az éles
          buildnek.
        </p>
      </footer>
    </main>
  );
}

function Chapter({
  eyebrow,
  altitude,
  title,
  children,
  level = 'h2',
  last = false,
}: {
  eyebrow: string;
  altitude: string;
  title: React.ReactNode;
  children: React.ReactNode;
  level?: 'h1' | 'h2';
  last?: boolean;
}) {
  // Every chapter is a real section with real prose. Nothing that matters —
  // no heading, no paragraph, no call to action — exists only inside the
  // canvas, which is what keeps the page readable when the canvas does not run.
  const Heading = level;
  return (
    <section className={`chapter${last ? ' chapter--last' : ''}`}>
      <div className="chapter__card">
        <p className="chapter__eyebrow">
          {eyebrow}
          <span className="chapter__altitude">{altitude}</span>
        </p>
        <Heading className="chapter__title">{title}</Heading>
        {children}
      </div>
    </section>
  );
}
