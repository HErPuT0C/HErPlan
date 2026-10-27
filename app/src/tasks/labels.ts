// Labels of the project (FR-NAR-04, F6-03): one registry in data/variables.json → labels, used by tasks. A
// label has a name, a colour (from the palette or any HEX), and, so that it is told apart without colour
// too, a pattern or a symbol.

import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { forgetLabel } from './model';

export type LabelPattern = 'none' | 'stripes' | 'dots' | 'grid' | 'waves';
export const LABEL_PATTERNS: readonly LabelPattern[] = ['none', 'stripes', 'dots', 'grid', 'waves'];

/** Colours offered first; any other is a HEX of the designer's own. */
export const LABEL_PALETTE: readonly string[] = [
  '#e5534b',
  '#f0a43c',
  '#e8b931',
  '#3fb97a',
  '#2bb5a8',
  '#4f8fe6',
  '#7b86ff',
  '#a46ae0',
  '#e0609f',
  '#8a8f98',
];

export interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  pattern: LabelPattern;
  /** One or two characters shown on the label ("★", "!", "Б"); empty — none. */
  symbol: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeColor(text: string): string | null {
  const t = text.trim();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const full = t.startsWith('#') ? t : `#${t}`;
  return HEX.test(full) ? full.toLowerCase() : null;
}

/**
 * The symbol of a label: at most two characters as a person sees them (0.7.4: an emoji made of several code
 * points — a skin tone, "👨‍💻", a flag — is one character and is kept whole).
 */
export function labelSymbol(text: string): string {
  const parts = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text.trim()));
  return parts
    .slice(0, 2)
    .map((p) => p.segment)
    .join('')
    .trim();
}

export function listLabels(data: Pick<ProjectData, 'variables'>): ProjectLabel[] {
  const raw = (data.variables as { labels?: unknown }).labels;
  return (Array.isArray(raw) ? raw : [])
    .filter((l): l is JsonObject => isObject(l) && typeof l.id === 'string')
    .map((l) => ({
      id: l.id as string,
      name: typeof l.name === 'string' ? l.name : '',
      color: (typeof l.color === 'string' && normalizeColor(l.color)) || '#8a8f98',
      pattern: LABEL_PATTERNS.includes(l.pattern as LabelPattern) ? (l.pattern as LabelPattern) : 'none',
      symbol: typeof l.symbol === 'string' ? labelSymbol(l.symbol) : '',
    }));
}

function registry(d: ProjectData): JsonObject[] {
  const file = d.variables as { labels?: unknown };
  if (!Array.isArray(file.labels)) file.labels = [];
  return file.labels as JsonObject[];
}

export function addLabel(d: ProjectData, name: string, color: string): string {
  const id = newId();
  registry(d).push({ id, name: name.trim(), color: normalizeColor(color) ?? '#8a8f98', pattern: 'none', symbol: '' });
  return id;
}

export function updateLabel(
  d: ProjectData,
  id: string,
  patch: Partial<Pick<ProjectLabel, 'name' | 'color' | 'pattern' | 'symbol'>>,
): void {
  const l = registry(d).find((x) => x.id === id);
  if (!l) return;
  if (patch.color !== undefined) {
    const color = normalizeColor(patch.color);
    if (!color) delete patch.color;
    else patch.color = color;
  }
  if (patch.symbol !== undefined) patch.symbol = labelSymbol(patch.symbol);
  Object.assign(l, patch);
}

/** Takes a label out of the registry and off every task. */
export function deleteLabel(d: ProjectData, id: string): void {
  const file = d.variables as { labels?: unknown };
  file.labels = registry(d).filter((x) => x.id !== id);
  forgetLabel(d, id);
}

/** Black or white text, whichever reads better on the colour (WCAG relative luminance). */
export function textOn(color: string): string {
  const hex = normalizeColor(color) ?? '#8a8f98';
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#14161a' : '#ffffff';
}
