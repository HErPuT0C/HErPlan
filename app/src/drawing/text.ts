// Texts of drawings (0.9.1): letters in a font of the system, in colours and looks of their own by parts — a
// word red with a black contour in a white text — laid out in lines the way the window's text field lays them
// out, so what is typed sits exactly where it is drawn. Parts are kept as runs: pieces of the text, each with
// its colour and look; typing goes on in the style of the sign before the caret.

import type { Box, TextFont, TextItem, TextLook, TextRun } from './model';

/** Line height, in sizes of the font (as the text field has it). */
export const LINE_HEIGHT = 1.25;

/** System fonts of each family, Windows ones first; the same in the window and in the picture. */
export const FONT_STACKS: Record<TextFont, string> = {
  sans: '"Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
  hand: '"Segoe Print", "Comic Sans MS", cursive',
};

/** The CSS font of a text, `scale` times its size. */
export function fontCss(t: Pick<TextItem, 'size' | 'font' | 'bold' | 'italic'>, scale = 1): string {
  const style = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}`;
  return `${style}${Math.round(t.size * scale * 100) / 100}px ${FONT_STACKS[t.font ?? 'sans']}`;
}

export interface TextMeasure {
  /** The width of a text in a CSS font. */
  width(text: string, font: string): number;
  /** How far the lines of a font reach above and below their baseline (as a text field lays them out). */
  metrics(font: string, size: number): { ascent: number; descent: number };
}

const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);

/** Without a canvas (tests, before the window opens): about 0.58 em a sign. */
const ROUGH: TextMeasure = {
  width: (text, font) => text.length * sizeOf(font) * 0.58,
  metrics: (_font, size) => ({ ascent: size * 1.08, descent: size * 0.25 }),
};

let shared: TextMeasure = ROUGH;

/** The window measures with a canvas of its own once it opens: frames and picking follow the real letters. */
export function setTextMeasure(m: TextMeasure): void {
  shared = m;
}

/** A measure on a canvas context (it sets the context's font). */
export function canvasMeasure(ctx: CanvasRenderingContext2D): TextMeasure {
  const metrics = new Map<string, { ascent: number; descent: number }>();
  return {
    width(text, font) {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
    metrics(font, size) {
      let m = metrics.get(font);
      if (!m) {
        ctx.font = font;
        const tm = ctx.measureText('Hg');
        const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = tm;
        m = ascent > 0 && descent >= 0 ? { ascent, descent } : ROUGH.metrics(font, size);
        metrics.set(font, m);
      }
      return m;
    },
  };
}

// ---------- parts ----------

export const sameLook = (a?: TextLook, b?: TextLook): boolean =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && a.color === b.color && !!a.thick === !!b.thick);

const sameStyle = (a: Omit<TextRun, 'text'>, b: Omit<TextRun, 'text'>) =>
  a.color === b.color && sameLook(a.look, b.look);

const run = (text: string, color: string, look?: TextLook): TextRun => (look ? { text, color, look } : { text, color });

/** The parts of a text: its own, or all of it in its colour and look. */
export function runsOf(t: Pick<TextItem, 'text' | 'color' | 'look' | 'runs'>): TextRun[] {
  if (t.runs?.length) return t.runs;
  return t.text ? [run(t.text, t.color, t.look)] : [];
}

export const runsText = (runs: readonly TextRun[]): string => runs.map((r) => r.text).join('');

/** Parts with neighbours of the same style joined and empty ones dropped. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) out[out.length - 1] = run(last.text + r.text, last.color, last.look);
    else out.push(run(r.text, r.color, r.look));
  }
  return out;
}

/** The parts within signs [start, end) of the text. */
export function sliceRuns(runs: readonly TextRun[], start: number, end: number): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(start, at);
    const b = Math.min(end, at + r.text.length);
    if (a < b) out.push(run(r.text.slice(a - at, b - at), r.color, r.look));
    at += r.text.length;
  }
  return out;
}

/** The style of the sign at `i`; null past the end. */
function styleAt(runs: readonly TextRun[], i: number): Omit<TextRun, 'text'> | null {
  let at = 0;
  for (const r of runs) {
    if (i < at + r.text.length) return r.look ? { color: r.color, look: r.look } : { color: r.color };
    at += r.text.length;
  }
  return null;
}

/**
 * The parts after the text became `next` (typed into, pasted over, cut). What came in takes the style of what
 * it replaced (a selected word typed over), else of the sign before it — of the first sign at the very start,
 * of `fallback` in an empty text.
 */
export function retype(runs: readonly TextRun[], next: string, fallback: Omit<TextRun, 'text'>): TextRun[] {
  const prev = runsText(runs);
  if (prev === next) return [...runs];
  const max = Math.min(prev.length, next.length);
  let p = 0;
  while (p < max && prev[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const inserted = next.slice(p, next.length - s);
  const replaced = prev.length - s > p;
  const style = (replaced ? styleAt(runs, p) : p > 0 ? styleAt(runs, p - 1) : styleAt(runs, 0)) ?? fallback;
  return normalizeRuns([
    ...sliceRuns(runs, 0, p),
    ...(inserted ? [run(inserted, style.color, style.look)] : []),
    ...sliceRuns(runs, prev.length - s, prev.length),
  ]);
}

/** Gives the signs in [start, end) a colour and/or a look (`look: null` takes the look away). */
export function restyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: { color?: string; look?: TextLook | null },
): TextRun[] {
  const total = runsText(runs).length;
  const changed = sliceRuns(runs, start, end).map((r) =>
    run(r.text, patch.color ?? r.color, patch.look === undefined ? r.look : (patch.look ?? undefined)),
  );
  return normalizeRuns([...sliceRuns(runs, 0, start), ...changed, ...sliceRuns(runs, end, total)]);
}

/** Changes the parts within signs [start, end) by `change` (the colour of their looks…). */
export function mapRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  change: (r: TextRun) => TextRun,
): TextRun[] {
  const total = runsText(runs).length;
  return normalizeRuns([
    ...sliceRuns(runs, 0, start),
    ...sliceRuns(runs, start, end).map(change),
    ...sliceRuns(runs, end, total),
  ]);
}

/** The style of the sign at `i` (the last sign's past the end); null in an empty text. */
export function styleOf(runs: readonly TextRun[], i: number): Omit<TextRun, 'text'> | null {
  const total = runsText(runs).length;
  return total ? styleAt(runs, Math.max(0, Math.min(i, total - 1))) : null;
}

/** The text with these parts: one colour and look are kept plainly; parts only when they differ. */
export function withRuns(t: TextItem, runs: readonly TextRun[]): TextItem {
  const parts = normalizeRuns(runs);
  const out: TextItem = { ...t, text: runsText(parts) };
  delete out.runs;
  delete out.look;
  if (parts.length) out.color = parts[0].color;
  if (parts.length > 1) out.runs = parts;
  else if (parts[0]?.look) out.look = parts[0].look;
  return out;
}

// ---------- looks ----------

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

/** A look of this kind that stands out against letters of this colour. */
export function defaultLook(kind: TextLook['kind'], textColor: string): TextLook {
  const bright = luminance(textColor) > 0.5;
  switch (kind) {
    case 'outline':
      return { kind, color: bright ? '#1f1f1f' : '#ffffff' };
    case 'shadow':
      return { kind, color: bright ? '#1f1f1f' : '#868e96' };
    case 'glow':
      return { kind, color: bright ? '#1c7ed6' : '#f5d000' };
    case 'plate':
      return { kind, color: bright ? '#1f1f1f' : '#ffffff' };
  }
}

/** Half the width of a contour around letters of this size. */
export const outlineWidth = (size: number, thick?: boolean): number =>
  thick ? Math.max(2.5, size * 0.11) : Math.max(1.2, size * 0.05);

/** How far a look reaches out of the letters. */
function lookReach(look: TextLook | undefined, size: number): number {
  if (!look) return 0;
  if (look.kind === 'outline') return outlineWidth(size, look.thick);
  if (look.kind === 'glow') return size * 0.4;
  return size * 0.15;
}

// ---------- lines ----------

export interface TextSegment {
  text: string;
  /** Where it starts, in pixels of the drawing. */
  x: number;
  w: number;
  run: TextRun;
}

export interface TextLine {
  top: number;
  /** The baseline the letters stand on. */
  base: number;
  /** Width of the line. */
  w: number;
  segments: TextSegment[];
}

export interface TextLayout {
  lines: TextLine[];
  w: number;
  h: number;
  lineH: number;
}

/** The lines of a text and where each part of them is, as the text field of the window lays them out. */
export function layoutText(t: TextItem, m: TextMeasure = shared): TextLayout {
  const font = fontCss(t);
  const lineH = t.size * LINE_HEIGHT;
  const { ascent, descent } = m.metrics(font, t.size);
  const lead = (lineH - ascent - descent) / 2;
  const lines: TextLine[] = [];
  let segments: TextSegment[] = [];
  let x = 0;
  const flush = () => {
    const top = t.y + lines.length * lineH;
    lines.push({ top, base: top + lead + ascent, w: x, segments });
    segments = [];
    x = 0;
  };
  for (const r of runsOf(t)) {
    r.text.split('\n').forEach((part, k) => {
      if (k > 0) flush();
      if (!part) return;
      const w = m.width(part, font);
      segments.push({ text: part, x: t.x + x, w, run: r });
      x += w;
    });
  }
  flush();
  return { lines, w: Math.max(0, ...lines.map((l) => l.w)), h: lines.length * lineH, lineH };
}

/** The rectangle a text covers, with room for what goes around its letters. */
export function textBounds(t: TextItem): Box {
  const l = layoutText(t);
  const reach = Math.max(...runsOf(t).map((r) => lookReach(r.look, t.size)), 0);
  return { x: t.x - reach, y: t.y - reach, w: Math.max(l.w, t.size * 0.3) + 2 * reach, h: l.h + 2 * reach };
}
