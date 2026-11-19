// Drawings (0.9): what HErPlan's drawing window makes — strokes of a pen, a marker and an eraser, lines and
// arrows, boxes and ovals, texts — kept as shapes, so a drawing opened again can still be changed: a stroke
// moved, a box deleted. A drawing may lie over a picture of the project (its background): drawing on a picture
// in a document. It is saved as a PNG that carries this source in it (png.ts), so the picture shows anywhere
// (documents, the map, exports, other programs) and HErPlan can open it for drawing again.

import { newId } from '../core/ids';
import { textBounds } from './text';

export type Tool = 'select' | 'pen' | 'marker' | 'eraser' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

/** A free-hand stroke. A marker is wide and see-through; an eraser takes away what is drawn under it. */
export interface StrokeItem {
  kind: 'stroke';
  id: string;
  mode: 'pen' | 'marker' | 'erase';
  /** x, y, x, y… in pixels of the drawing. */
  points: number[];
  color: string;
  width: number;
}

export interface LineItem {
  kind: 'line';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  /** An arrowhead at the end. */
  arrow?: boolean;
}

export interface BoxItem {
  kind: 'rect' | 'ellipse';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  /** Filled with the colour, see-through; absent: an outline only. */
  fill?: boolean;
}

/** Families of letters a text can have (0.9.1): their fonts are the system's, see FONT_STACKS. */
export type TextFont = 'sans' | 'serif' | 'mono' | 'hand';
export const TEXT_FONTS: readonly TextFont[] = ['sans', 'serif', 'mono', 'hand'];

/**
 * What goes around the letters of a text (0.9.1): a contour (thin or thick), a shadow, a glow, or a plate
 * under them — in its own colour.
 */
export interface TextLook {
  kind: 'outline' | 'shadow' | 'glow' | 'plate';
  color: string;
  /** A thick contour (outline only). */
  thick?: boolean;
}
export const LOOK_KINDS: readonly TextLook['kind'][] = ['outline', 'shadow', 'glow', 'plate'];

/** A part of a text with a colour and a look of its own (a word coloured apart from the rest). */
export interface TextRun {
  text: string;
  color: string;
  look?: TextLook;
}

export interface TextItem {
  kind: 'text';
  id: string;
  /** The top-left corner of the text. */
  x: number;
  y: number;
  /** All of the text; lines are split by "\n". */
  text: string;
  /** The colour of the text (of all of it when it has no parts). */
  color: string;
  /** Font size in pixels of the drawing. */
  size: number;
  /** Absent: "sans". */
  font?: TextFont;
  bold?: boolean;
  italic?: boolean;
  /** What goes around the letters (of all of them when the text has no parts); absent: nothing. */
  look?: TextLook;
  /** Parts with colours and looks of their own; their texts make up `text`. Absent: one colour and look. */
  runs?: TextRun[];
}

export type DrawItem = StrokeItem | LineItem | BoxItem | TextItem;

export interface Drawing {
  v: 1;
  /** Size in pixels. */
  w: number;
  h: number;
  /** The colour under everything ("#ffffff"), or "" — none (see-through). */
  bg: string;
  /** The picture drawn on ("assets/…"), the size of the drawing: a copy keeps where it came from. */
  background?: string;
  items: DrawItem[];
}

/** The size of a new drawing: a sheet that fits a card of the map and a page of a document. */
export const NEW_SIZE = { w: 960, h: 600 };
/** Colours offered in the window; any other can be picked as well. */
export const PALETTE = [
  '#1f1f1f',
  '#ffffff',
  '#e03131',
  '#f08c00',
  '#f5d000',
  '#2f9e44',
  '#1c7ed6',
  '#7048e8',
  '#c2255c',
  '#868e96',
];
export const WIDTHS = [2, 4, 8, 16];
/** How much wider than a pen a marker and an eraser are, and how see-through a marker is. */
export const MARKER_WIDTH = 3;
export const ERASER_WIDTH = 3;
export const MARKER_ALPHA = 0.35;
/** How see-through a filled box is. */
export const FILL_ALPHA = 0.3;
/** The largest side a drawing may have (a picture bigger than this is drawn on at this size). */
export const MAX_SIDE = 4096;

export function emptyDrawing(w = NEW_SIZE.w, h = NEW_SIZE.h, bg = '#ffffff'): Drawing {
  return { v: 1, w: Math.round(w), h: Math.round(h), bg, items: [] };
}

/** A drawing over a picture of `w` × `h`: the picture as it is, nothing drawn yet. */
export function drawingOnPicture(path: string, w: number, h: number): Drawing {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
  return {
    v: 1,
    w: Math.max(1, Math.round(w * k)),
    h: Math.max(1, Math.round(h * k)),
    bg: '',
    background: path,
    items: [],
  };
}

// ---------- reading what was written ----------

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const COLOR = /^#[0-9a-f]{6}$/i;
const color = (v: unknown): string => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : '#1f1f1f');
const width = (v: unknown): number => (num(v) && v > 0 ? Math.min(v, 200) : 2);

function textLook(raw: unknown): TextLook | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (!LOOK_KINDS.includes(o.kind as TextLook['kind'])) return undefined;
  const look: TextLook = { kind: o.kind as TextLook['kind'], color: color(o.color) };
  if (look.kind === 'outline' && o.thick === true) look.thick = true;
  return look;
}

function item(raw: unknown): DrawItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id ? o.id : newId();
  switch (o.kind) {
    case 'stroke': {
      const points = Array.isArray(o.points) ? o.points.filter(num) : [];
      if (points.length < 2) return null;
      const mode = o.mode === 'marker' || o.mode === 'erase' ? o.mode : 'pen';
      return {
        kind: 'stroke',
        id,
        mode,
        points: points.slice(0, points.length - (points.length % 2)),
        color: color(o.color),
        width: width(o.width),
      };
    }
    case 'line': {
      if (![o.x1, o.y1, o.x2, o.y2].every(num)) return null;
      const line: LineItem = {
        kind: 'line',
        id,
        x1: o.x1 as number,
        y1: o.y1 as number,
        x2: o.x2 as number,
        y2: o.y2 as number,
        color: color(o.color),
        width: width(o.width),
      };
      if (o.arrow === true) line.arrow = true;
      return line;
    }
    case 'rect':
    case 'ellipse': {
      if (![o.x, o.y, o.w, o.h].every(num)) return null;
      const box: BoxItem = {
        kind: o.kind,
        id,
        x: o.x as number,
        y: o.y as number,
        w: o.w as number,
        h: o.h as number,
        color: color(o.color),
        width: width(o.width),
      };
      if (o.fill === true) box.fill = true;
      return box;
    }
    case 'text': {
      if (![o.x, o.y].every(num) || typeof o.text !== 'string' || !o.text) return null;
      const text: TextItem = {
        kind: 'text',
        id,
        x: o.x as number,
        y: o.y as number,
        text: o.text,
        color: color(o.color),
        size: num(o.size) && o.size > 0 ? Math.min(o.size, 400) : 24,
      };
      if (TEXT_FONTS.includes(o.font as TextFont) && o.font !== 'sans') text.font = o.font as TextFont;
      if (o.bold === true) text.bold = true;
      if (o.italic === true) text.italic = true;
      const look = textLook(o.look);
      if (look) text.look = look;
      // Parts are kept only when they make up the text exactly.
      if (Array.isArray(o.runs)) {
        const runs = o.runs
          .slice(0, 2000)
          .map((r): TextRun | null => {
            const x = (r ?? {}) as Record<string, unknown>;
            if (typeof x.text !== 'string' || !x.text) return null;
            const run: TextRun = { text: x.text, color: color(x.color) };
            const l = textLook(x.look);
            if (l) run.look = l;
            return run;
          })
          .filter((r): r is TextRun => !!r);
        if (runs.length && runs.map((r) => r.text).join('') === text.text) text.runs = runs;
      }
      return text;
    }
    default:
      return null;
  }
}

/** A drawing read from its JSON; null when it is not one. Unknown items are dropped. */
export function parseDrawing(raw: unknown): Drawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !num(o.w) || !num(o.h) || o.w < 1 || o.h < 1) return null;
  const d: Drawing = {
    v: 1,
    w: Math.min(MAX_SIDE, Math.round(o.w)),
    h: Math.min(MAX_SIDE, Math.round(o.h)),
    bg: typeof o.bg === 'string' && (o.bg === '' || COLOR.test(o.bg)) ? o.bg : '#ffffff',
    items: (Array.isArray(o.items) ? o.items : []).map(item).filter((x): x is DrawItem => !!x),
  };
  const background = str(o.background, '');
  if (background.startsWith('assets/')) d.background = background;
  return d;
}

// ---------- strokes ----------

/** Fewer points along a stroke where it is straight enough (Ramer–Douglas–Peucker), rounded to tenths. */
export function simplify(points: readonly number[], tolerance = 0.8): number[] {
  const n = points.length / 2;
  if (n <= 2) return points.map((v) => Math.round(v * 10) / 10);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2];
    const ay = points[a * 2 + 1];
    const bx = points[b * 2];
    const by = points[b * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let far = -1;
    let farD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      // Distance to the segment, not to the whole line through its ends: a closed stroke (a circle, ending
      // where it began) has ends that coincide, and every point would be "on the line" of a point.
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(Math.round(points[i * 2] * 10) / 10, Math.round(points[i * 2 + 1] * 10) / 10);
  }
  return out;
}

// ---------- where things are ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rectangle a text covers (for picking it and for its frame): measured in its font where the window can
 * measure (drawing/text.ts), else about 0.58 em a sign; with room for what goes around its letters.
 */
export function textBox(t: TextItem): Box {
  return textBounds(t);
}

/** The rectangle an item covers (its line width included). */
export function itemBounds(it: DrawItem): Box {
  switch (it.kind) {
    case 'stroke': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < it.points.length; i += 2) {
        minX = Math.min(minX, it.points[i]);
        maxX = Math.max(maxX, it.points[i]);
        minY = Math.min(minY, it.points[i + 1]);
        maxY = Math.max(maxY, it.points[i + 1]);
      }
      const r = strokeWidth(it) / 2;
      return { x: minX - r, y: minY - r, w: maxX - minX + 2 * r, h: maxY - minY + 2 * r };
    }
    case 'line': {
      const r = it.width / 2 + (it.arrow ? it.width * 2 : 0);
      return {
        x: Math.min(it.x1, it.x2) - r,
        y: Math.min(it.y1, it.y2) - r,
        w: Math.abs(it.x2 - it.x1) + 2 * r,
        h: Math.abs(it.y2 - it.y1) + 2 * r,
      };
    }
    case 'rect':
    case 'ellipse': {
      const b = normBox(it);
      const r = it.width / 2;
      return { x: b.x - r, y: b.y - r, w: b.w + 2 * r, h: b.h + 2 * r };
    }
    case 'text':
      return textBox(it);
  }
}

/** A box with its width and height made positive (a box drawn from right to left). */
export function normBox(b: Box): Box {
  return {
    x: Math.min(b.x, b.x + b.w),
    y: Math.min(b.y, b.y + b.h),
    w: Math.abs(b.w),
    h: Math.abs(b.h),
  };
}

/** How wide a stroke is drawn: a marker and an eraser are wider than their pen width. */
export function strokeWidth(s: StrokeItem): number {
  return s.mode === 'pen' ? s.width : s.width * (s.mode === 'marker' ? MARKER_WIDTH : ERASER_WIDTH);
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is a point on an item (within `tolerance` pixels of what is drawn)? An eraser stroke is never picked. */
export function hitsItem(it: DrawItem, x: number, y: number, tolerance = 4): boolean {
  switch (it.kind) {
    case 'stroke': {
      if (it.mode === 'erase') return false;
      const r = strokeWidth(it) / 2 + tolerance;
      const p = it.points;
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= r;
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (segmentDistance(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r) return true;
      }
      return false;
    }
    case 'line':
      return segmentDistance(x, y, it.x1, it.y1, it.x2, it.y2) <= it.width / 2 + tolerance;
    case 'rect': {
      const b = normBox(it);
      const inside = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      if (it.fill && inside) return true;
      const r = it.width / 2 + tolerance;
      const nearX = x >= b.x - r && x <= b.x + b.w + r;
      const nearY = y >= b.y - r && y <= b.y + b.h + r;
      return (
        (nearX && (Math.abs(y - b.y) <= r || Math.abs(y - b.y - b.h) <= r)) ||
        (nearY && (Math.abs(x - b.x) <= r || Math.abs(x - b.x - b.w) <= r))
      );
    }
    case 'ellipse': {
      const b = normBox(it);
      const rx = b.w / 2;
      const ry = b.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const k = Math.hypot((x - b.x - rx) / rx, (y - b.y - ry) / ry);
      if (it.fill && k <= 1) return true;
      return Math.abs(k - 1) * Math.min(rx, ry) <= it.width / 2 + tolerance;
    }
    case 'text': {
      const b = textBox(it);
      return x >= b.x - tolerance && x <= b.x + b.w + tolerance && y >= b.y - tolerance && y <= b.y + b.h + tolerance;
    }
  }
}

/** The topmost item at a point, or null. */
export function itemAt(d: Drawing, x: number, y: number, tolerance = 4): DrawItem | null {
  for (let i = d.items.length - 1; i >= 0; i--) if (hitsItem(d.items[i], x, y, tolerance)) return d.items[i];
  return null;
}

/** An item moved by (dx, dy): a new object, the old one is not changed. */
export function movedItem(it: DrawItem, dx: number, dy: number): DrawItem {
  switch (it.kind) {
    case 'stroke':
      return { ...it, points: it.points.map((v, i) => Math.round((v + (i % 2 ? dy : dx)) * 10) / 10) };
    case 'line':
      return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
    default:
      return { ...it, x: it.x + dx, y: it.y + dy };
  }
}

/** The end of a line moved to the nearest 15° when Shift is held. */
export function snapAngle(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const step = Math.PI / 12;
  const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / step) * step;
  return { x: x1 + Math.cos(a) * len, y: y1 + Math.sin(a) * len };
}
