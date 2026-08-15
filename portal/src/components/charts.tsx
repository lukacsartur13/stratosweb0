import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui';

/**
 * The Portal's charts, and there are three of them.
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
 * time, a row of bars, and a funnel. All three are `path` and `rect` elements
 * over a linear scale, and the arithmetic is visible in the file rather than
 * behind an options object.
 *
 * ## The palette, and why it is nearly monochrome
 *
 * One accent — `signal`, the site's yellow — and everything else is the chrome
 * greys the rest of the portal uses. A colour here has to MEAN something: the
 * accent marks the series being read, and nothing else is coloured at all.
 * Where a second series is needed it is drawn in `chrome` at a lower opacity,
 * which reads as "the same measurement, less important" rather than as a
 * different category. That is a deliberate rejection of the categorical-colour
 * default: on a dashboard with five panels, five palettes is noise.
 */

const AXIS = 'rgba(244,244,244,0.10)';

/* =================================================================== line == */

export interface Series {
  id: string;
  label: string;
  points: number[];
}

/**
 * A time series, as one line over a filled area.
 *
 * Deliberately one series at a time rather than three overlaid: sessions, users
 * and views are all counts of different things on wildly different scales, and
 * plotting them together either needs three axes or squashes two of them flat
 * against the floor. The screen offers a switch instead, which is one click and
 * a chart you can actually read.
 */
export function TrendChart({
  points,
  labels,
  label,
  height = 168,
}: {
  points: number[];
  labels: string[];
  label: string;
  height?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const w = 1000;
    const h = height;
    // A floor of 1 on the maximum stops a flat zero series collapsing the
    // scale to nothing and dividing by it.
    const max = Math.max(1, ...points);
    const step = points.length > 1 ? w / (points.length - 1) : 0;
    const x = (i: number) => (points.length > 1 ? i * step : w / 2);
    const y = (v: number) => h - (v / max) * (h - 12) - 6;

    const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = points.length
      ? `${line} L${x(points.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`
      : '';
    return { w, h, max, line, area, x, y };
  }, [points, height]);

  if (points.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-haze">
        No data in this range.
      </p>
    );
  }

  const active = hover === null ? null : { value: points[hover], label: labels[hover] };

  return (
    <div className="px-5 pb-4 pt-3">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="label">{label}</p>
        <p className="num text-xs text-haze">
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
        className="block h-[168px] w-full"
        role="img"
        aria-label={`${label} over time. Peak ${geometry.max}.`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFEE25" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#FFEE25" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Two gridlines, at a third and two thirds. Not five: the point of a
            gridline is to let the eye estimate, and past two they start being
            the thing you see instead of the data. */}
        {[1 / 3, 2 / 3].map((f) => (
          <line
            key={f}
            x1={0}
            x2={geometry.w}
            y1={geometry.h * f}
            y2={geometry.h * f}
            stroke={AXIS}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={geometry.area} fill={`url(#${id}-fill)`} />
        <path
          d={geometry.line}
          fill="none"
          stroke="#FFEE25"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          // Without this the horizontal stretch from `preserveAspectRatio:
          // none` scales the stroke too, and the line is four pixels thick on a
          // wide panel and one on a narrow one.
          vectorEffect="non-scaling-stroke"
        />

        {hover !== null && (
          <g>
            <line
              x1={geometry.x(hover)} x2={geometry.x(hover)} y1={0} y2={geometry.h}
              stroke="rgba(244,244,244,0.28)" strokeWidth={1} vectorEffect="non-scaling-stroke"
            />
            <circle cx={geometry.x(hover)} cy={geometry.y(points[hover])} r={3} fill="#FFEE25"
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

      <div className="mt-1 flex justify-between">
        <span className="num text-[10px] text-haze">{labels[0]}</span>
        <span className="num text-[10px] text-haze">{labels[labels.length - 1]}</span>
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
export function Meter({ value, max, tone = 'signal' }: { value: number; max: number; tone?: 'signal' | 'chrome' }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span className="mt-1 block h-px w-full bg-hair" aria-hidden="true">
      <span
        className={cn('block h-px', tone === 'signal' ? 'bg-signal' : 'bg-chrome/50')}
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
  format = (v: number) => v.toLocaleString('en-GB'),
}: {
  rows: { key: string; value: number; note?: string }[];
  empty: string;
  format?: (value: number) => string;
}) {
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-haze">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="grid gap-2.5 px-5 py-4">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-xs text-paper">{row.key || '—'}</span>
            <span className="num shrink-0 text-xs text-haze">
              {row.note && <span className="mr-2 text-haze/70">{row.note}</span>}
              {format(row.value)}
            </span>
          </div>
          <Meter value={row.value} max={max} />
        </li>
      ))}
    </ul>
  );
}

/* ================================================================= funnel == */

/**
 * The conversion funnel, as stacked proportional bars.
 *
 * Width is the share of the entry stage, which is what makes the drop-off
 * legible as a shape rather than as a column of numbers. The stage-to-stage
 * percentage sits in the gap between bars, because that is the number a reader
 * is actually looking for — "where do people stop" — and putting it on the bar
 * would make it look like a property of the stage rather than of the step into
 * it.
 */
export function Funnel({
  stages,
}: {
  stages: { id: string; label: string; count: number; ofPrevious: number | null; ofEntry: number | null; hint?: string }[];
}) {
  const entry = stages[0]?.count ?? 0;

  return (
    <ol className="grid gap-0 px-5 py-4">
      {stages.map((stage, i) => {
        const share = entry > 0 ? Math.max(stage.count / entry, 0) : 0;
        return (
          <li key={stage.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1.5 pl-3">
                <span className="h-3 w-px bg-hair" aria-hidden="true" />
                <span className="num text-[10px] text-haze">
                  {stage.ofPrevious === null ? '—' : `${(stage.ofPrevious * 100).toFixed(1)}% continue`}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-paper">{stage.label}</span>
              <span className="num text-xs text-paper">
                {stage.count.toLocaleString('en-GB')}
                {stage.ofEntry !== null && (
                  <span className="ml-2 text-haze">{(stage.ofEntry * 100).toFixed(2)}%</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-sm bg-white/[0.04]" aria-hidden="true">
              <div
                className={cn('h-2 rounded-sm', i === stages.length - 1 ? 'bg-signal' : 'bg-chrome/35')}
                // A visible sliver for a non-zero stage that would otherwise
                // round to nothing: "two leads out of nine hundred sessions" is
                // a real number and a bar of zero width says it did not happen.
                style={{ width: `${Math.max(share * 100, stage.count > 0 ? 0.6 : 0).toFixed(2)}%` }}
              />
            </div>
            {stage.hint && <p className="num mt-1 text-[10px] text-haze">{stage.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/* ================================================================ controls == */

/**
 * A segmented control — the range and environment selectors.
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
            'px-3 py-1.5 font-data text-[10px] uppercase tracking-[0.14em] transition-colors',
            'focus-visible:outline-2 focus-visible:outline-signal',
            value === id ? 'bg-white/[0.07] text-paper' : 'text-haze hover:text-paper',
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
    <span
      className={cn(
        'num text-[10px]',
        flat ? 'text-haze' : good ? 'text-good' : 'text-danger',
      )}
    >
      {flat ? '±0%' : `${value > 0 ? '▲' : '▼'} ${Math.abs(value * 100).toFixed(1)}%`}
    </span>
  );
}

/**
 * A KPI, and it is deliberately not a card the size of a postcard.
 *
 * The brief rules out giant empty KPI cards, and the reason is a real one: a
 * dashboard is read by scanning, and eight tiles that each hold one number in a
 * lot of air means scrolling to compare figures that belong side by side. This
 * is the compact form — label, figure, one line of context — and eight of them
 * fit above the fold on a laptop.
 */
export function Stat({
  label, value, note, delta, inverse, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  delta?: number | null;
  inverse?: boolean;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="rounded-lg border border-hair bg-panel/60 px-4 py-3 shadow-panel">
      <p className="label truncate">{label}</p>
      <p className={cn('num mt-1 text-xl', tone === 'accent' ? 'text-signal' : 'text-paper')}>{value}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {delta !== undefined && <Delta value={delta ?? null} inverse={inverse} />}
        {note && <span className="text-[10px] text-haze">{note}</span>}
      </div>
    </div>
  );
}
