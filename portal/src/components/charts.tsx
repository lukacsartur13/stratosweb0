import { useId, useMemo, useState } from 'react';
import { cn } from '@/components/ui';

/**
 * The Portal's charts, and there are four of them.
 *
 * ## Why no chart library
 *
 * Three reasons, in the order they matter.
 *
 * The first is the Content Security Policy. The portal ships no third-party
 * runtime and loads nothing from a CDN; a charting library would be a
 * dependency in the bundle rather than a script tag, but it would also be
 * ~50-150 KB of code to draw four shapes, on a screen whose whole point is to
 * load fast enough to be checked between other things.
 *
 * The second is that a chart library's defaults are the thing this design is
 * trying not to look like. Rainbow categorical palettes, drop shadows,
 * animated tooltips, a legend for one series, gridlines every twenty pixels —
 * every one of those is a default someone would then have to turn off, and the
 * result of turning them all off is the SVG below.
 *
 * The third is that what this dashboard needs is genuinely small: a line over
 * time, a row of bars, a funnel and a rule under a table row. All four are
 * `path` and `rect` elements over a linear scale, and the arithmetic is visible
 * in the file rather than behind an options object.
 *
 * ## One chart system
 *
 * Every chart here shares the same axis colour, the same two gridlines, the
 * same accent, the same empty state and the same rule about labels being text
 * nodes. Nothing on any screen should look like it arrived from a different
 * theme, which is what happens the moment a second charting approach appears.
 *
 * ## The palette, and why it is nearly monochrome
 *
 * One accent — `signal`, the site's yellow — and everything else is the chrome
 * greys the rest of the portal uses. A colour here has to MEAN something: the
 * accent marks the series being read, and nothing else is coloured at all.
 * Where a second measure is needed it is drawn in `chrome` at a lower opacity,
 * which reads as "the same measurement, less important" rather than as a
 * different category. That is a deliberate rejection of the categorical-colour
 * default: on a dashboard with five panels, five palettes is noise.
 */

const AXIS = 'rgba(244,244,244,0.09)';
const ACCENT = '#FFEE25';

/* =================================================================== line == */

/**
 * A time series, as one line over a filled area.
 *
 * Deliberately one series at a time rather than three overlaid: sessions, users
 * and views are all counts of different things on wildly different scales, and
 * plotting them together either needs three axes or squashes two of them flat
 * against the floor. The screen offers a switch instead, which is one click and
 * a chart you can actually read.
 *
 * ## `baseline`, and why it is not a second line
 *
 * GA4's Data API returns ONE time series for the range that was asked for.
 * There is no previous-period series in the payload, and drawing one would mean
 * inventing its shape. What the payload does carry is the previous period's
 * TOTAL, so the comparison is drawn as what it honestly is: a dashed rule at the
 * previous period's mean per interval, labelled as an average. A reader can see
 * whether today is above or below where the last period sat without being shown
 * a curve that nobody measured.
 */
export function TrendChart({
  points,
  labels,
  label,
  baseline,
  height = 200,
}: {
  points: number[];
  labels: string[];
  label: string;
  baseline?: { value: number; label: string } | null;
  height?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const w = 1000;
    const h = height;
    // A floor of 1 on the maximum stops a flat zero series collapsing the
    // scale to nothing and dividing by it. The baseline participates so that a
    // previous period well above this one is still on the canvas.
    const max = Math.max(1, ...points, baseline?.value ?? 0);
    const step = points.length > 1 ? w / (points.length - 1) : 0;
    const x = (i: number) => (points.length > 1 ? i * step : w / 2);
    const y = (v: number) => h - (v / max) * (h - 14) - 7;

    const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = points.length
      ? `${line} L${x(points.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`
      : '';
    return { w, h, max, line, area, x, y };
  }, [points, height, baseline?.value]);

  if (points.length === 0) {
    return <p className="px-4 py-12 text-center text-xs text-haze">No data in this range.</p>;
  }

  const active = hover === null ? null : { value: points[hover], label: labels[hover] };

  return (
    <div className="px-4 pb-3 pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="t-section">{label}</p>
        <p className="t-meta">
          {active
            ? <><span className="text-paper">{active.value.toLocaleString('en-GB')}</span> · {active.label}</>
            : <>peak {geometry.max.toLocaleString('en-GB')}</>}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${geometry.w} ${geometry.h}`}
        // `none` so the line stretches to the panel's width rather than keeping
        // a ratio and leaving a gutter. A time series has no natural aspect.
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`${label} over time. Peak ${geometry.max}.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.16" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Two gridlines, at a third and two thirds. Not five: the point of a
            gridline is to let the eye estimate, and past two they start being
            the thing you see instead of the data. */}
        {[1 / 3, 2 / 3].map((f) => (
          <line
            key={f}
            x1={0} x2={geometry.w} y1={geometry.h * f} y2={geometry.h * f}
            stroke={AXIS} strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={geometry.area} fill={`url(#${id}-fill)`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Without this the horizontal stretch from `preserveAspectRatio:
          // none` scales the stroke too, and the line is four pixels thick on a
          // wide panel and one on a narrow one.
          vectorEffect="non-scaling-stroke"
        />

        {baseline && baseline.value > 0 && (
          <line
            x1={0} x2={geometry.w} y1={geometry.y(baseline.value)} y2={geometry.y(baseline.value)}
            stroke="rgba(203,220,233,0.45)" strokeWidth={1} strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {hover !== null && (
          <g>
            <line
              x1={geometry.x(hover)} x2={geometry.x(hover)} y1={0} y2={geometry.h}
              stroke="rgba(244,244,244,0.26)" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
            <circle cx={geometry.x(hover)} cy={geometry.y(points[hover])} r={3} fill={ACCENT}
              vectorEffect="non-scaling-stroke" />
          </g>
        )}

        {/* One invisible column per point, so the pointer target is the whole
            band rather than the 1.5px line. */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={geometry.x(i) - (geometry.w / Math.max(points.length, 1)) / 2}
            y={0}
            width={geometry.w / Math.max(points.length, 1)}
            height={geometry.h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      <div className="mt-1 flex items-baseline justify-between gap-4">
        <span className="t-note">{labels[0]}</span>
        {baseline && baseline.value > 0 && (
          <span className="t-note flex items-center gap-1.5">
            <span className="inline-block h-px w-4 bg-chrome/45" aria-hidden="true" />
            {baseline.label}
          </span>
        )}
        <span className="t-note">{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

/* =================================================================== bars == */

/**
 * A proportion, as a rule under a row.
 *
 * Not a bar chart with an axis: these appear inside tables, where the number is
 * already printed beside them and the bar's job is only to make the shape of
 * the distribution visible at a glance. A 1px rule does that; a filled bar
 * competes with the text it is annotating.
 */
export function Meter({ value, max, tone = 'chrome' }: { value: number; max: number; tone?: 'signal' | 'chrome' }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span className="mt-1 block h-px w-full bg-hairline" aria-hidden="true">
      <span
        className={cn('block h-px', tone === 'signal' ? 'bg-signal' : 'bg-chrome/45')}
        style={{ width: `${(share * 100).toFixed(2)}%` }}
      />
    </span>
  );
}

/**
 * A horizontal bar list — the shape every "top N by count" panel wants.
 *
 * The label is a text node, always. Every key on this screen is a page path, a
 * referrer host or a campaign name that GA4 collected from the open internet: a
 * referrer is whatever the referring site put in a header, and a campaign name
 * is whatever somebody typed into a UTM parameter. None of it is ever rendered
 * as markup and none of it becomes an `href` — there is no `href` anywhere on
 * this screen, which is the same rule the Leads screen follows and for the same
 * reason.
 */
export function BarList({
  rows,
  empty,
  tone = 'chrome',
  format = (v: number) => v.toLocaleString('en-GB'),
}: {
  rows: { key: string; value: number; note?: string }[];
  empty: string;
  tone?: 'signal' | 'chrome';
  format?: (value: number) => string;
}) {
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-xs text-haze">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="grid gap-2 px-4 py-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-xs text-paper">{row.key || '—'}</span>
            <span className="num shrink-0 text-xs text-haze">
              {row.note && <span className="mr-2 text-haze/70">{row.note}</span>}
              {format(row.value)}
            </span>
          </div>
          <Meter value={row.value} max={max} tone={tone} />
        </li>
      ))}
    </ul>
  );
}

/* ================================================================= funnel == */

/**
 * The conversion path, as an editorial column rather than a graphic.
 *
 * §13 of the brief rules out the giant coloured funnel, and the reason is that
 * a funnel drawn as a shape is read as a shape: the eye takes in "it narrows"
 * and stops. What the reader actually wants is two numbers per step — how many
 * arrived, and what share of the previous step that is — and those are typography,
 * not geometry.
 *
 * So: the count is the largest thing on each row, the stage name sits under it
 * in the section face, and the step conversion lives in the gap BETWEEN two
 * stages, because that is a property of the step and not of either stage. The
 * only geometry left is a 1px rule showing the share of entry, which costs
 * nothing and lets the shape be seen by anyone who wants it.
 */
export function Funnel({
  stages,
}: {
  stages: {
    id: string; label: string; count: number;
    ofPrevious: number | null; ofEntry: number | null; hint?: string;
  }[];
}) {
  const entry = stages[0]?.count ?? 0;

  return (
    <ol className="grid gap-0 px-4 py-3">
      {stages.map((stage, i) => {
        const share = entry > 0 ? Math.max(stage.count / entry, 0) : 0;
        const last = i === stages.length - 1;
        return (
          <li key={stage.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1.5">
                <span className="text-[10px] leading-none text-haze/70" aria-hidden="true">↓</span>
                <span className="num text-[10px] text-haze">
                  {stage.ofPrevious === null ? '—' : `${(stage.ofPrevious * 100).toFixed(1)}%`}
                </span>
                <span className="h-px flex-1 bg-hairline" aria-hidden="true" />
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className={cn('num text-xl leading-none', last ? 'text-signal' : 'text-paper')}>
                  {stage.count.toLocaleString('en-GB')}
                </p>
                <p className="t-section mt-1 truncate">{stage.label}</p>
              </div>
              {stage.ofEntry !== null && (
                <span className="num shrink-0 text-[10px] text-haze">
                  {(stage.ofEntry * 100).toFixed(2)}% of entry
                </span>
              )}
            </div>
            <div className="mt-1.5 h-px w-full bg-hairline" aria-hidden="true">
              <div
                className={cn('h-px', last ? 'bg-signal' : 'bg-chrome/45')}
                // A visible sliver for a non-zero stage that would otherwise
                // round to nothing: "two leads out of nine hundred sessions" is
                // a real number and a bar of zero width says it did not happen.
                style={{ width: `${Math.max(share * 100, stage.count > 0 ? 0.6 : 0).toFixed(2)}%` }}
              />
            </div>
            {stage.hint && <p className="num mt-1 text-[10px] leading-relaxed text-haze/80">{stage.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/* ================================================================ controls == */

/**
 * A segmented control — the range, environment and metric selectors.
 *
 * `aria-pressed` on real buttons rather than a `radiogroup`, because these are
 * not a form field: nothing is submitted, and each press takes effect
 * immediately. A screen reader announcing "pressed" is describing what actually
 * happened.
 */
export function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-sm border border-hair">
      {options.map(({ id, label: text }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.14em] transition-colors',
            'focus-visible:outline-2 focus-visible:outline-signal',
            value === id ? 'bg-flare text-paper' : 'text-haze hover:text-paper',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The change against the previous period.
 *
 * Colour is the LAST thing this uses, not the first: the arrow and the sign
 * carry the direction, and the tint only reinforces it. `inverse` is for the
 * metrics where down is good — bounce rate is the one on this screen — and it
 * exists because a dashboard that paints a falling bounce rate red is a
 * dashboard that has confused "went down" with "got worse".
 */
export function Delta({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return <span className="num text-[10px] text-haze">no comparison</span>;
  const flat = Math.abs(value) < 0.005;
  const good = inverse ? value < 0 : value > 0;
  return (
    <span className={cn('num text-[10px]', flat ? 'text-haze' : good ? 'text-good' : 'text-danger')}>
      {flat ? '±0%' : `${value > 0 ? '↑' : '↓'} ${Math.abs(value * 100).toFixed(1)}%`}
    </span>
  );
}
