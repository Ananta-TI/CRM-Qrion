// Hand-built data visualisation primitives.
//
// There is no chart library in this project on purpose: every mark below is a
// plain SVG element or a styled <div>, painted with the --chart* tokens, so the
// analytics page keeps the same glass language as the rest of the app and ships
// no extra JavaScript. All components are server-safe (no hooks, no state).

const round = (n: number) => Math.round(n * 100) / 100;

/** Rounds an axis maximum up to a friendly integer step (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number, ticks: number) {
  const raw = Math.max(1, value);
  const rough = Math.ceil(raw / ticks);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step =
    (norm <= 1
      ? 1
      : norm <= 2
        ? 2
        : norm <= 2.5
          ? 2.5
          : norm <= 3
            ? 3
            : norm <= 4
              ? 4
              : norm <= 5
                ? 5
                : 10) * mag;
  return step * ticks;
}

// -----------------------------------------------------------------------------
// Area / line chart
// -----------------------------------------------------------------------------
export type ChartSeries = {
  label: string;
  color: string;
  values: number[];
  /** Fill the area under the line. */
  area?: boolean;
};

export function AreaChart({
  labels,
  series,
  height = 220,
  ticks = 4,
  unit = "",
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  ticks?: number;
  unit?: string;
}) {
  const W = 720;
  const H = height;
  const pad = { top: 14, right: 10, bottom: 26, left: 34 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const n = labels.length;
  const max = niceMax(
    Math.max(1, ...series.flatMap((s) => s.values)),
    ticks,
  );
  const x = (i: number) => pad.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const clampY = (v: number) => Math.min(pad.top + ih, Math.max(pad.top, v));

  // Catmull-Rom → cubic bezier: smooth without the overshoot a naive spline
  // would add on spiky daily counts. Control points are clamped to the plot so
  // the curve never dips below the baseline.
  const line = (values: number[]) => {
    const pts = values.map((v, i) => [x(i), y(v)] as const);
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${round(pts[0][0])} ${round(pts[0][1])}`;
    let d = `M${round(pts[0][0])} ${round(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6);
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6);
      d += ` C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2[0])} ${round(p2[1])}`;
    }
    return d;
  };

  const area = (values: number[]) => {
    const d = line(values);
    if (!d) return "";
    return `${d} L${round(x(values.length - 1))} ${round(pad.top + ih)} L${round(x(0))} ${round(pad.top + ih)} Z`;
  };

  const labelStep = Math.max(1, Math.ceil(n / 6));
  const gridValues = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Grafik ${series.map((s) => s.label).join(" dan ")}`}
    >
      {gridValues.map((v) => (
        <g key={v}>
          <line
            className="chart__grid"
            x1={pad.left}
            x2={W - pad.right}
            y1={round(y(v))}
            y2={round(y(v))}
          />
          <text
            className="chart__tick"
            x={pad.left - 8}
            y={round(y(v)) + 3.5}
            textAnchor="end"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}

      {series.map((s) =>
        s.area ? (
          <path
            key={`${s.label}-area`}
            className="rpt__area"
            d={area(s.values)}
            fill={s.color}
            fillOpacity={0.14}
            stroke="none"
          />
        ) : null,
      )}

      {series.map((s) => (
        <path
          key={`${s.label}-line`}
          className="rpt__line chart__line"
          d={line(s.values)}
          stroke={s.color}
          pathLength={1}
        />
      ))}

      {series.map((s) =>
        s.values.map((v, i) => (
          <circle
            key={`${s.label}-${i}`}
            className="chart__dot"
            cx={round(x(i))}
            cy={round(y(v))}
            r={2.6}
            fill={s.color}
          >
            <title>{`${labels[i]}: ${v}${unit ? ` ${unit}` : ""} ${s.label}`}</title>
          </circle>
        )),
      )}

      {labels.map((label, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text
            key={`${label}-${i}`}
            className="chart__tick"
            x={round(x(i))}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Donut
// -----------------------------------------------------------------------------
export type DonutDatum = { label: string; value: number; color: string };

export function Donut({
  data,
  centerValue,
  centerLabel,
  size = 148,
}: {
  data: DonutDatum[];
  centerValue: string | number;
  centerLabel: string;
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const visible = data.filter((d) => d.value > 0);
  const segments = visible.map((d, i) => {
    const pct = (d.value / total) * 100;
    // Prefix sum instead of a running accumulator: the render pass stays pure.
    const offset = visible
      .slice(0, i)
      .reduce((s, x) => s + (x.value / total) * 100, 0);
    return { ...d, pct, offset };
  });

  return (
    <div className="donut">
      <div className="donut__ring" style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx={60}
            cy={60}
            r={44}
            fill="none"
            stroke="var(--well)"
            strokeWidth={14}
          />
          {segments.map((s) => {
            // A hair of gap between slices keeps adjacent colours legible.
            const len = Math.max(s.pct - 0.9, 0.4);
            return (
              <circle
                key={s.label}
                cx={60}
                cy={60}
                r={44}
                fill="none"
                stroke={s.color}
                strokeWidth={14}
                strokeLinecap="butt"
                pathLength={100}
                strokeDasharray={`${round(len)} ${round(100 - len)}`}
                strokeDashoffset={round(-s.offset)}
                transform="rotate(-90 60 60)"
              >
                <title>{`${s.label}: ${s.value} (${Math.round(s.pct)}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="donut__center">
          <span className="donut__num">{centerValue}</span>
          <span className="donut__lbl">{centerLabel}</span>
        </div>
      </div>

      <ul className="donut__legend">
        {data.map((d) => (
          <li key={d.label}>
            <span className="sw" style={{ ["--c" as string]: d.color }} />
            <span className="donut__name">{d.label}</span>
            <b>{d.value}</b>
            <span className="donut__pct">
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Horizontal bar list
// -----------------------------------------------------------------------------
export function BarList({
  items,
  max,
}: {
  items: { label: string; value: number; color?: string }[];
  max?: number;
}) {
  const top = Math.max(max ?? 0, ...items.map((i) => i.value), 1);
  return (
    <div className="barlist">
      {items.map((item) => (
        <div className="barlist__row" key={item.label}>
          <span className="barlist__label" title={item.label}>
            {item.label}
          </span>
          <span className="barlist__track">
            <span
              className="barlist__fill"
              style={{
                width: `${Math.max((item.value / top) * 100, item.value > 0 ? 3 : 0)}%`,
                background: item.color ?? "var(--chart)",
              }}
            />
          </span>
          <span className="barlist__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Vertical columns (histogram)
// -----------------------------------------------------------------------------
export function Columns({
  items,
  height = 132,
}: {
  items: { label: string; value: number; color?: string }[];
  height?: number;
}) {
  const top = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="cols" style={{ height }}>
      {items.map((item) => (
        <div className="cols__item" key={item.label}>
          <span className="cols__val">{item.value}</span>
          <div className="cols__plot">
            <span
              className="cols__bar"
              style={{
                height: `${Math.max((item.value / top) * 100, item.value > 0 ? 4 : 0)}%`,
                background: item.color ?? "var(--chart)",
              }}
              title={`${item.label}: ${item.value}`}
            />
          </div>
          <span className="cols__lbl">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Heatmap (weekday × time bucket)
// -----------------------------------------------------------------------------
export function Heatmap({
  rows,
  cols,
  values,
  max,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  max: number;
}) {
  const top = Math.max(max, 1);
  return (
    <div className="heat" style={{ ["--heat-cols" as string]: cols.length }}>
      <div className="heat__row">
        <span />
        {cols.map((c) => (
          <span className="heat__head" key={c}>
            {c}
          </span>
        ))}
      </div>
      {rows.map((row, r) => (
        <div className="heat__row" key={row}>
          <span className="heat__lbl">{row}</span>
          {cols.map((c, i) => {
            const v = values[r]?.[i] ?? 0;
            const pct = Math.round((v / top) * 100);
            return (
              <span
                className="heat__cell"
                key={c}
                title={`${row} ${c}: ${v} tiket`}
                style={{
                  background:
                    v === 0
                      ? "var(--well)"
                      : `color-mix(in srgb, var(--iris) ${Math.max(pct, 12)}%, var(--well))`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Semicircle gauge
// -----------------------------------------------------------------------------
export function Gauge({
  pct,
  label,
  caption,
}: {
  pct: number;
  label: string;
  caption?: string;
}) {
  const value = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="gauge">
      <svg className="gauge__svg" viewBox="0 0 260 142" aria-hidden="true">
        <path
          className="gauge__track"
          d="M32 120a98 98 0 0 1 196 0"
          pathLength={100}
        />
        <path
          className="gauge__seg gauge__seg--done"
          d="M32 120a98 98 0 0 1 196 0"
          pathLength={100}
          strokeDasharray={`${value} ${100 - value}`}
        />
      </svg>
      <p className="gauge__read">
        <span className="gauge__pct">{value}%</span>
        <span className="gauge__lbl">{label}</span>
      </p>
      {caption && <p className="gauge__cap">{caption}</p>}
    </div>
  );
}
