// Diagrams on the project map (0.9): flowchart figures with words in them, joined by the canvas's own arrows;
// tables whose cells are typed in on the map; charts drawn from a small table of numbers; and a "canvas" card
// that holds a drawing (a picture of the project, made in the drawing window). Pen strokes on the map itself
// are a node kind of the canvas (canvas/ink.ts).

import { registerKind, sideAnchors, type NodeShape, type Port } from '../canvas/kinds';
import { HEADER_H, type GraphNode } from '../canvas/model';
import { paraOffset } from '../canvas/shapes';
import { t, type MessageKey } from '../i18n';
import { textRows } from '../story/kinds';

// --- Figures of flowcharts ---

export type ShapeName = 'rect' | 'round' | 'ellipse' | 'diamond' | 'para' | 'text';
export const SHAPES: readonly ShapeName[] = ['rect', 'round', 'ellipse', 'diamond', 'para', 'text'];

export const shapeKind = (shape: ShapeName): string => `shape-${shape}`;

export function shapeOf(kind: string): ShapeName | null {
  const name = kind.startsWith('shape-') ? kind.slice(6) : '';
  return (SHAPES as readonly string[]).includes(name) ? (name as ShapeName) : null;
}

/** Arrows join figures at the middles of their sides: on the slanted sides of a parallelogram, not its box. */
function shapePorts(shape: ShapeName) {
  return (n: GraphNode): Port[] => {
    const ports = sideAnchors(n, 'both', ['left', 'top', 'right', 'bottom'], 0);
    if (shape !== 'para') return ports;
    const half = paraOffset(n.w, n.h) / 2;
    return ports.map((p) => (p.face === 'left' ? { ...p, x: half } : p.face === 'right' ? { ...p, x: n.w - half } : p));
  };
}

const SHAPE_LOOK: Record<ShapeName, { shape: NodeShape; label: MessageKey; color: string; w: number; h: number }> = {
  rect: { shape: 'rect', label: 'map.shape.rect', color: '#3b74c9', w: 160, h: 80 },
  round: { shape: 'round', label: 'map.shape.round', color: '#23917f', w: 160, h: 80 },
  ellipse: { shape: 'ellipse', label: 'map.shape.ellipse', color: '#3a9a5b', w: 160, h: 80 },
  diamond: { shape: 'diamond', label: 'map.shape.diamond', color: '#b88a1e', w: 160, h: 120 },
  para: { shape: 'para', label: 'map.shape.para', color: '#7656c9', w: 180, h: 80 },
  text: { shape: 'none', label: 'map.shape.text', color: '#5b6474', w: 160, h: 60 },
};

SHAPES.forEach((name, order) => {
  const look = SHAPE_LOOK[name];
  registerKind({
    id: shapeKind(name),
    label: look.label,
    color: look.color,
    size: { w: look.w, h: look.h },
    ports: shapePorts(name),
    shape: look.shape,
    min: { w: 40, h: 40 },
    graphs: ['projectMap'],
    menu: { group: 'diagram', order },
  });
});

// --- Tables ---

export const TABLE_KIND = 'table';
/** A row of text in a cell, and the room above and below it. */
export const CELL_LINE_H = 18;
const CELL_PAD_Y = 5;
const CELL_PAD_X = 8;
export const MAX_TABLE = { rows: 100, cols: 20 };

/** The cells of a table node, rows of the same length; at least one cell. */
export function tableCells(node: GraphNode): string[][] {
  const raw = Array.isArray(node.cells) ? (node.cells as unknown[]) : [];
  const rows = raw
    .filter((r): r is unknown[] => Array.isArray(r))
    .slice(0, MAX_TABLE.rows)
    .map((r) => r.slice(0, MAX_TABLE.cols).map((c) => (typeof c === 'string' ? c : c == null ? '' : String(c))));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  if (!rows.length) rows.push([]);
  return rows.map((r) => (r.length < cols ? [...r, ...Array<string>(cols - r.length).fill('')] : r));
}

export function emptyTable(rows = 3, cols = 3): string[][] {
  return Array.from({ length: rows }, () => Array<string>(cols).fill(''));
}

export interface TableLayout {
  cols: number;
  colW: number;
  /** Heights of the rows, stretched to fill the node when it was made taller than its text needs. */
  rows: number[];
  /** The height the text needs (the header included). */
  need: number;
}

/**
 * Where the rows and columns of a table node are, and how tall its text needs it to be: the card's border (1px
 * around), its header, then the rows; a cell has room around its text and a line under it and on its right.
 */
export function tableLayout(node: Pick<GraphNode, 'w' | 'h'>, cells: string[][]): TableLayout {
  const cols = cells[0].length;
  const colW = (node.w - 2) / cols;
  const heights = cells.map(
    (row) => Math.max(...row.map((c) => textRows(c, colW - CELL_PAD_X * 2 - 1))) * CELL_LINE_H + CELL_PAD_Y * 2 + 1,
  );
  const need = HEADER_H + 2 + heights.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, node.h - need) / heights.length;
  return { cols, colW, rows: heights.map((h) => h + extra), need };
}

/** Makes a table node as tall as its text needs; never shorter than it is unless `shrink`. */
export function fitTable(node: GraphNode, shrink = false): void {
  const { need } = tableLayout(node, tableCells(node));
  node.h = shrink ? need : Math.max(node.h, need);
}

/** The cell under a point of the node (relative to its top-left corner); null on the header or outside. */
export function cellAt(node: GraphNode, x: number, y: number): { row: number; col: number } | null {
  if (x < 0 || x > node.w || y < HEADER_H + 1) return null;
  const layout = tableLayout(node, tableCells(node));
  let top = HEADER_H + 1;
  for (let row = 0; row < layout.rows.length; row++) {
    if (y < top + layout.rows[row]) {
      return { row, col: Math.max(0, Math.min(layout.cols - 1, Math.floor((x - 1) / layout.colW))) };
    }
    top += layout.rows[row];
  }
  return null;
}

export function setCell(cells: string[][], row: number, col: number, text: string): string[][] {
  return cells.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r));
}

export function insertRow(cells: string[][], at: number): string[][] {
  if (cells.length >= MAX_TABLE.rows) return cells;
  const out = cells.slice();
  out.splice(Math.max(0, Math.min(at, cells.length)), 0, Array<string>(cells[0].length).fill(''));
  return out;
}

export function removeRow(cells: string[][], at: number): string[][] {
  return cells.length <= 1 ? cells : cells.filter((_, i) => i !== at);
}

export function insertColumn(cells: string[][], at: number): string[][] {
  if (cells[0].length >= MAX_TABLE.cols) return cells;
  const k = Math.max(0, Math.min(at, cells[0].length));
  return cells.map((r) => [...r.slice(0, k), '', ...r.slice(k)]);
}

export function removeColumn(cells: string[][], at: number): string[][] {
  return cells[0].length <= 1 ? cells : cells.map((r) => r.filter((_, j) => j !== at));
}

/** Puts an empty row at `at` (0: on top), keeping the text in view. */
export function addRowAt(node: GraphNode, at: number): void {
  node.cells = insertRow(tableCells(node), at);
  fitTable(node, true);
}

/** Puts an empty column at `at` (0: on the left); the table grows by a column, the others keep their width. */
export function addColumnAt(node: GraphNode, at: number): void {
  const cells = tableCells(node);
  const cols = cells[0].length;
  if (cols >= MAX_TABLE.cols) return;
  node.cells = insertColumn(cells, at);
  node.w = Math.round(node.w + (node.w - 2) / cols);
  fitTable(node, true);
}

export function removeRowAt(node: GraphNode, at: number): void {
  node.cells = removeRow(tableCells(node), at);
  fitTable(node, true);
}

/** Takes a column away; the table narrows by it, the others keep their width. */
export function removeColumnAt(node: GraphNode, at: number): void {
  const cells = tableCells(node);
  const cols = cells[0].length;
  if (cols <= 1) return;
  node.cells = removeColumn(cells, at);
  node.w = Math.max(80, Math.round(node.w - (node.w - 2) / cols));
  fitTable(node, true);
}

/** The words of a table, for the search. */
export function tableText(node: GraphNode): string {
  return tableCells(node)
    .map((r) => r.join(' '))
    .join('\n');
}

registerKind({
  id: TABLE_KIND,
  label: 'map.kind.table',
  color: '#5b6474',
  size: { w: 360, h: 120 },
  ports: (n) => sideAnchors(n),
  graphs: ['projectMap'],
  menu: { group: 'diagram', order: 10 },
  min: { w: 80, h: HEADER_H + 2 + CELL_LINE_H + CELL_PAD_Y * 2 + 1 },
  fit: (n) => fitTable(n, true),
  init: (n) => {
    n.cells = emptyTable();
    fitTable(n, true);
  },
});

// --- Charts ---

export const CHART_KIND = 'chart';
export type ChartType = 'bar' | 'line' | 'pie';
export const CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'pie'];
/** More series than colours would mean colours made up on the spot, or used twice: eight at most. */
export const MAX_SERIES = 8;
export const MAX_CHART_ROWS = 40;

export interface ChartRow {
  label: string;
  /** One per series; null for a value not given. */
  values: (number | null)[];
}

export interface ChartData {
  type: ChartType;
  series: string[];
  rows: ChartRow[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The data of a chart node, made whole (a series name for each column, a value or null for each). */
export function chartOf(node: GraphNode): ChartData {
  const raw = (node.chart ?? {}) as Partial<ChartData>;
  const type = CHART_TYPES.includes(raw.type as ChartType) ? (raw.type as ChartType) : 'bar';
  const series = (Array.isArray(raw.series) ? raw.series : [])
    .slice(0, MAX_SERIES)
    .map((s) => (typeof s === 'string' ? s : ''));
  if (!series.length) series.push('');
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, MAX_CHART_ROWS).map((r) => {
    const row = (r ?? {}) as Partial<ChartRow>;
    const values = Array.isArray(row.values) ? row.values : [];
    return {
      label: typeof row.label === 'string' ? row.label : '',
      values: series.map((_, i) => num(values[i])),
    };
  });
  return { type, series, rows };
}

/** A new chart: one series, a few rows to replace. */
export function sampleChart(series: string): ChartData {
  return {
    type: 'bar',
    series: [series],
    rows: [
      { label: 'A', values: [3] },
      { label: 'B', values: [5] },
      { label: 'C', values: [2] },
      { label: 'D', values: [4] },
    ],
  };
}

/** Steps of an axis of `count` ticks or so from about `min` to `max`: round numbers, zero included. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** A tick or a value as people write it: 1 200, 2,5, 10K. */
export function formatValue(v: number, locale: string): string {
  const abs = Math.abs(v);
  if (abs >= 10_000) {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
}

/** The words of a chart, for the search. */
export function chartText(node: GraphNode): string {
  const c = chartOf(node);
  return [...c.series, ...c.rows.map((r) => r.label)].join('\n');
}

registerKind({
  id: CHART_KIND,
  label: 'map.kind.chart',
  color: '#3b74c9',
  size: { w: 360, h: 260 },
  ports: (n) => sideAnchors(n),
  graphs: ['projectMap'],
  menu: { group: 'diagram', order: 11 },
  min: { w: 200, h: 160 },
  init: (n) => {
    n.chart = sampleChart(t('map.chart.seriesName', { n: 1 }));
  },
});

// --- A canvas to draw on ---

export const DRAWING_KIND = 'drawing';

/** The picture a drawing card shows (assets/…), or null before anything was drawn. */
export function drawingPath(node: GraphNode): string | null {
  return typeof node.drawing === 'string' && node.drawing.startsWith('assets/') ? node.drawing : null;
}

registerKind({
  id: DRAWING_KIND,
  label: 'map.kind.drawing',
  color: '#c96a2b',
  size: { w: 320, h: 228 },
  ports: (n) => sideAnchors(n),
  graphs: ['projectMap'],
  menu: { group: 'diagram', order: 12 },
  min: { w: 120, h: 100 },
});
