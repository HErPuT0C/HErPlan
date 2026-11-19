// A chart of the project map (0.9), drawn from its little table: columns or lines over round-number gridlines
// from zero, or a pie of the first series. Colours go to the series in a fixed order (eight at most), text stays
// in the text colours, a legend names the series when there are two or more, and every mark tells its row,
// series and value on hover.

import { getLocale, t } from '../../i18n';
import { formatValue, niceTicks, type ChartData } from '../../map/diagram';

/** Series colours, in their order (map.css); a ninth series is never made up. */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const OTHER = 'var(--series-other)';
/** Width of a character of the chart's small text, about. */
const CH = 6.2;
/** The pie names at most this many parts; smaller ones beyond them go together as "other". */
const PIE_PARTS = 6;

const clip = (text: string, room: number) => {
  const max = Math.floor(room / CH);
  if (max < 2) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function ChartView({ data, w, h, label }: { data: ChartData; w: number; h: number; label: string }) {
  if (w < 40 || h < 40) return null;
  return data.type === 'pie' ? (
    <Pie data={data} w={w} h={h} label={label} />
  ) : (
    <Axes data={data} w={w} h={h} label={label} />
  );
}

function Empty({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <svg className="map-chart-svg" width={w} height={h} role="img" aria-label={label}>
      <text className="map-chart-label" x={w / 2} y={h / 2} textAnchor="middle" dy="0.32em">
        {t('map.chart.empty')}
      </text>
    </svg>
  );
}

/** Swatches and names of the series in a row at the top; what does not fit is cut with "…". */
function Legend({ names, x, y, room }: { names: string[]; x: number; y: number; room: number }) {
  let at = x;
  const items: { name: string; x: number; color: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i] || t('map.chart.seriesName', { n: i + 1 });
    const wide = 16 + name.length * CH + 12;
    if (at + wide > x + room) {
      const fit = clip(name, x + room - at - 16);
      if (fit) items.push({ name: fit, x: at, color: SERIES[i] });
      break;
    }
    items.push({ name, x: at, color: SERIES[i] });
    at += wide;
  }
  return (
    <g>
      {items.map((it, i) => (
        <g key={i}>
          <rect x={it.x} y={y - 5} width={10} height={10} rx={2} fill={it.color} />
          <text className="map-chart-legend" x={it.x + 15} y={y} dy="0.32em">
            {it.name}
          </text>
        </g>
      ))}
    </g>
  );
}

/** A bar from the baseline to its value, its far end rounded (4px), square at the baseline. */
function barPath(x: number, w: number, base: number, end: number): string {
  const up = end <= base;
  const len = Math.abs(base - end);
  const r = Math.min(4, w / 2, len);
  const s = up ? 1 : -1;
  return (
    `M${x} ${base}V${end + s * r}Q${x} ${end} ${x + r} ${end}H${x + w - r}` +
    `Q${x + w} ${end} ${x + w} ${end + s * r}V${base}Z`
  );
}

function Axes({ data, w, h, label }: { data: ChartData; w: number; h: number; label: string }) {
  const locale = getLocale();
  const values = data.rows.flatMap((r) => r.values).filter((v): v is number => v !== null);
  if (!data.rows.length || !values.length) return <Empty w={w} h={h} label={label} />;
  const ticks = niceTicks(Math.min(...values), Math.max(...values), h < 150 ? 2 : 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickText = ticks.map((v) => formatValue(v, locale));
  const many = data.series.length > 1;
  const left = Math.min(w * 0.3, 10 + Math.max(...tickText.map((s) => s.length)) * CH);
  const right = 10;
  const top = many ? 28 : 12;
  const bottom = 22;
  const pw = Math.max(10, w - left - right);
  const ph = Math.max(10, h - top - bottom);
  const y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * ph;
  const band = pw / data.rows.length;
  const name = (j: number) => data.series[j] || t('map.chart.seriesName', { n: j + 1 });
  const tip = (row: string, j: number, v: number) =>
    many ? `${row} · ${name(j)}: ${formatValue(v, locale)}` : `${row}: ${formatValue(v, locale)}`;
  // Every label when they fit, else every second, third…
  const labelStep = Math.max(1, Math.ceil(28 / band));
  const n = data.series.length;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - (n - 1) * 2) / n));
  const group = n * barW + (n - 1) * 2;
  const valueLabels = !many && data.type === 'bar' && band >= 24;
  return (
    <svg className="map-chart-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {many && <Legend names={data.series} x={left} y={12} room={w - left - right} />}
      {ticks.map((v, i) => (
        <g key={i}>
          <line
            className={v === 0 ? 'map-chart-base' : 'map-chart-grid'}
            x1={left}
            x2={w - right}
            y1={y(v)}
            y2={y(v)}
          />
          <text className="map-chart-tick" x={left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {tickText[i]}
          </text>
        </g>
      ))}
      {data.type === 'bar'
        ? data.rows.map((row, i) => {
            const start = left + band * i + (band - group) / 2;
            return (
              <g key={i}>
                {row.values.map((v, j) =>
                  v === null ? null : (
                    <path
                      key={j}
                      className="map-chart-bar"
                      d={barPath(start + j * (barW + 2), barW, y(0), y(v))}
                      fill={SERIES[j]}
                    >
                      <title>{tip(row.label, j, v)}</title>
                    </path>
                  ),
                )}
                {valueLabels && row.values[0] !== null && (
                  <text
                    className="map-chart-value"
                    x={start + barW / 2}
                    y={y(row.values[0]) + (row.values[0] >= 0 ? -5 : 12)}
                    textAnchor="middle"
                  >
                    {formatValue(row.values[0], locale)}
                  </text>
                )}
              </g>
            );
          })
        : data.series.map((_, j) => {
            const x = (i: number) => left + band * (i + 0.5);
            let d = '';
            let pen = false;
            data.rows.forEach((row, i) => {
              const v = row.values[j];
              if (v === null) {
                pen = false;
                return;
              }
              d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
              pen = true;
            });
            return (
              <g key={j}>
                <path className="map-chart-line" d={d} stroke={SERIES[j]} />
                {data.rows.map((row, i) => {
                  const v = row.values[j];
                  return v === null ? null : (
                    <circle key={i} className="map-chart-dot" cx={x(i)} cy={y(v)} r={4} fill={SERIES[j]}>
                      <title>{tip(row.label, j, v)}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
      {data.rows.map((row, i) =>
        i % labelStep ? null : (
          <text key={i} className="map-chart-label" x={left + band * (i + 0.5)} y={h - bottom + 14} textAnchor="middle">
            {clip(row.label, band * labelStep - 4)}
          </text>
        ),
      )}
    </svg>
  );
}

interface Part {
  label: string;
  value: number;
  color: string;
}

/** The parts of a pie: rows of the first series above zero, in their order; the smallest beyond six as "other". */
export function pieParts(data: ChartData): Part[] {
  const rows = data.rows.map((r, i) => ({ label: r.label, value: r.values[0] ?? 0, i })).filter((r) => r.value > 0);
  let kept = rows;
  let rest = 0;
  if (rows.length > PIE_PARTS + 1) {
    const big = new Set(
      [...rows]
        .sort((a, b) => b.value - a.value)
        .slice(0, PIE_PARTS)
        .map((r) => r.i),
    );
    kept = rows.filter((r) => big.has(r.i));
    rest = rows.filter((r) => !big.has(r.i)).reduce((sum, r) => sum + r.value, 0);
  }
  const parts = kept.map((r, k) => ({ label: r.label, value: r.value, color: SERIES[k] }));
  if (rest > 0) parts.push({ label: t('map.chart.other'), value: rest, color: OTHER });
  return parts;
}

function Pie({ data, w, h, label }: { data: ChartData; w: number; h: number; label: string }) {
  const locale = getLocale();
  const parts = pieParts(data);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return <Empty w={w} h={h} label={label} />;
  // The legend beside the pie when there is room, under it otherwise.
  const side = w >= h * 1.25;
  const legendW = side ? Math.min(w * 0.45, 190) : w - 20;
  const legendH = side ? 0 : parts.length * 17 + 6;
  const r = Math.max(10, Math.min((side ? w - legendW - 30 : w - 20) / 2, (h - legendH - 20) / 2));
  const cx = side ? 10 + r : w / 2;
  const cy = side ? h / 2 : 10 + r;
  const pct = (v: number) => `${formatValue(Math.round((v / total) * 1000) / 10, locale)}%`;
  // Each part starts where the ones before it end, from twelve o'clock clockwise.
  const ends = parts.map((_, i) => parts.slice(0, i + 1).reduce((sum, p) => sum + p.value, 0));
  const slices = parts.map((p, i) => {
    const a0 = -Math.PI / 2 + ((ends[i] - p.value) / total) * Math.PI * 2;
    const a1 = -Math.PI / 2 + (ends[i] / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const d =
      parts.length === 1
        ? ''
        : `M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`;
    return { ...p, d };
  });
  const lx = side ? cx + r + 20 : 10;
  const ly = side ? cy - (parts.length * 17) / 2 + 8 : cy + r + 16;
  return (
    <svg className="map-chart-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {slices.map((s, i) =>
        s.d ? (
          <path key={i} className="map-chart-slice" d={s.d} fill={s.color}>
            <title>{`${s.label}: ${formatValue(s.value, locale)} (${pct(s.value)})`}</title>
          </path>
        ) : (
          <circle key={i} className="map-chart-slice" cx={cx} cy={cy} r={r} fill={s.color}>
            <title>{`${s.label}: ${formatValue(s.value, locale)} (${pct(s.value)})`}</title>
          </circle>
        ),
      )}
      {slices.map((s, i) => (
        <g key={i}>
          <rect x={lx} y={ly + i * 17 - 5} width={10} height={10} rx={2} fill={s.color} />
          <text className="map-chart-legend" x={lx + 15} y={ly + i * 17} dy="0.32em">
            {clip(s.label, legendW - 60)}
          </text>
          <text className="map-chart-tick" x={lx + legendW - 6} y={ly + i * 17} dy="0.32em" textAnchor="end">
            {pct(s.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
