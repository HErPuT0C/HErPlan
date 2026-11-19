// The data of a chart of the project map (0.9): its kind (columns, lines, pie) and a small table — rows with
// a name each, a column of numbers per series — with the chart drawn beside it as it is being typed.

import { ChartColumn, ChartLine, ChartPie, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { t, type MessageKey } from '../../i18n';
import { CHART_TYPES, MAX_CHART_ROWS, MAX_SERIES, type ChartData, type ChartType } from '../../map/diagram';
import { Button, Dialog, IconButton } from '../components';
import { ChartView } from './ChartView';

interface Draft {
  type: ChartType;
  series: string[];
  rows: { label: string; values: string[] }[];
}

const TYPE_LOOK: Record<ChartType, { label: MessageKey; icon: typeof ChartColumn }> = {
  bar: { label: 'map.chart.bar', icon: ChartColumn },
  line: { label: 'map.chart.line', icon: ChartLine },
  pie: { label: 'map.chart.pie', icon: ChartPie },
};

/** A number as typed: "1 200", "2,5", "-3"; null when empty or not a number. */
export function parseValue(text: string): number | null {
  const s = text.replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const toDraft = (d: ChartData): Draft => ({
  type: d.type,
  series: d.series,
  rows: d.rows.map((r) => ({ label: r.label, values: r.values.map((v) => (v === null ? '' : String(v))) })),
});

const fromDraft = (d: Draft): ChartData => ({
  type: d.type,
  series: d.series,
  rows: d.rows.map((r) => ({ label: r.label, values: r.values.map(parseValue) })),
});

export function ChartDialog({
  title,
  data,
  onSave,
  onClose,
}: {
  title: string;
  data: ChartData;
  onSave: (data: ChartData) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(data));
  const edit = (change: (d: Draft) => Draft) => setDraft((d) => change(d));
  const setSeries = (j: number, name: string) =>
    edit((d) => ({ ...d, series: d.series.map((s, k) => (k === j ? name : s)) }));
  const setLabel = (i: number, label: string) =>
    edit((d) => ({ ...d, rows: d.rows.map((r, k) => (k === i ? { ...r, label } : r)) }));
  const setValue = (i: number, j: number, value: string) =>
    edit((d) => ({
      ...d,
      rows: d.rows.map((r, k) => (k === i ? { ...r, values: r.values.map((v, m) => (m === j ? value : v)) } : r)),
    }));
  const addSeries = () =>
    edit((d) => ({
      ...d,
      series: [...d.series, t('map.chart.seriesName', { n: d.series.length + 1 })],
      rows: d.rows.map((r) => ({ ...r, values: [...r.values, ''] })),
    }));
  const removeSeries = (j: number) =>
    edit((d) => ({
      ...d,
      series: d.series.filter((_, k) => k !== j),
      rows: d.rows.map((r) => ({ ...r, values: r.values.filter((_, k) => k !== j) })),
    }));
  const addRow = () => edit((d) => ({ ...d, rows: [...d.rows, { label: '', values: d.series.map(() => '') }] }));
  const removeRow = (i: number) => edit((d) => ({ ...d, rows: d.rows.filter((_, k) => k !== i) }));
  const bad = (text: string) => text.trim() !== '' && parseValue(text) === null;
  const preview = fromDraft(draft);

  return (
    <Dialog
      open
      size="xl"
      className="chart-dialog"
      title={t('map.chart.dataTitle', { name: title })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(preview);
              onClose();
            }}
          >
            {t('draw.save')}
          </Button>
        </>
      }
    >
      <div className="chart-dialog-body">
        <div className="chart-dialog-data">
          <div className="chart-dialog-types" role="radiogroup" aria-label={t('map.chart.type')}>
            {CHART_TYPES.map((type) => {
              const look = TYPE_LOOK[type];
              const Icon = look.icon;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={draft.type === type}
                  className={['chart-type', draft.type === type && 'chart-type-on'].filter(Boolean).join(' ')}
                  onClick={() => edit((d) => ({ ...d, type }))}
                >
                  <Icon size={16} aria-hidden="true" />
                  {t(look.label)}
                </button>
              );
            })}
          </div>
          {draft.type === 'pie' && draft.series.length > 1 && <p className="muted small">{t('map.chart.pieFirst')}</p>}
          <div className="chart-grid-scroll">
            <table className="chart-grid">
              <thead>
                <tr>
                  <th scope="col" className="chart-grid-corner">
                    {t('map.chart.rowName')}
                  </th>
                  {draft.series.map((name, j) => (
                    <th key={j} scope="col">
                      <div className="chart-grid-series">
                        <span className="chart-grid-swatch" style={{ background: `var(--series-${j + 1})` }} />
                        <input
                          className="input"
                          value={name}
                          aria-label={t('map.chart.seriesField', { n: j + 1 })}
                          onChange={(e) => setSeries(j, e.target.value)}
                        />
                        {draft.series.length > 1 && (
                          <IconButton
                            size="sm"
                            label={t('map.chart.removeSeries', { name: name || String(j + 1) })}
                            icon={<X size={14} />}
                            onClick={() => removeSeries(j)}
                          />
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="chart-grid-tools">
                    {draft.series.length < MAX_SERIES && (
                      <IconButton
                        size="sm"
                        label={t('map.chart.addSeries')}
                        icon={<Plus size={14} />}
                        onClick={addSeries}
                      />
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">
                      <input
                        className="input"
                        value={row.label}
                        aria-label={t('map.chart.rowField', { n: i + 1 })}
                        onChange={(e) => setLabel(i, e.target.value)}
                      />
                    </th>
                    {row.values.map((v, j) => (
                      <td key={j}>
                        <input
                          className={['input', 'chart-grid-value', bad(v) && 'input-invalid'].filter(Boolean).join(' ')}
                          value={v}
                          inputMode="decimal"
                          aria-invalid={bad(v) || undefined}
                          aria-label={t('map.chart.valueField', {
                            row: row.label || String(i + 1),
                            series: draft.series[j] || String(j + 1),
                          })}
                          onChange={(e) => setValue(i, j, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="chart-grid-tools">
                      <IconButton
                        size="sm"
                        label={t('map.chart.removeRow', { name: row.label || String(i + 1) })}
                        icon={<X size={14} />}
                        onClick={() => removeRow(i)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft.rows.length < MAX_CHART_ROWS && (
            <Button size="sm" icon={<Plus size={14} />} onClick={addRow}>
              {t('map.chart.addRow')}
            </Button>
          )}
          <p className="muted small">{t('map.chart.hint')}</p>
        </div>
        <div className="chart-dialog-preview" aria-hidden="true">
          <ChartView data={preview} w={380} h={280} label={title} />
        </div>
      </div>
    </Dialog>
  );
}
