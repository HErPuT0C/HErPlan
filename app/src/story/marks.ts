// Plot marks: Chekhov's gun and the butterfly effect laid over a node, a choice option, a dialogue line, or
// a fragment of their text, instead of being nodes of their own. A marked fragment follows edits of its
// text (followText); one changed outside HErPlan is found again by its quote, or the mark falls back to
// the whole line. Older projects keep their gun and butterfly nodes: plotSources() reads both.

import type { GraphDoc } from '../canvas/model';
import { newId } from '../core/ids';
import {
  asStory,
  type MarkAnchor,
  type NodeRef,
  type PlotDevice,
  type PlotMark,
  type StoryNode,
  type TextRange,
} from './model';

export function sameAnchor(a: MarkAnchor, b: MarkAnchor): boolean {
  return a.kind === b.kind && (a.kind === 'node' || a.id === (b as { id: string }).id);
}

/** The text a mark's range refers to; undefined when the option or line is gone. */
export function anchorText(n: StoryNode, a: MarkAnchor): string | undefined {
  if (a.kind === 'node') return n.text ?? '';
  if (a.kind === 'option') return n.options?.find((o) => o.id === a.id)?.text;
  return n.lines?.find((l) => l.id === a.id)?.text;
}

export function marksOn(n: StoryNode, a: MarkAnchor): PlotMark[] {
  return (n.marks ?? []).filter((m) => sameAnchor(m.anchor, a));
}

export function markOf(n: StoryNode | undefined, id: string): PlotMark | undefined {
  return n?.marks?.find((m) => m.id === id);
}

/** A selection without the spaces around it; null when nothing is left (the mark covers the whole text). */
function tightRange(text: string, start: number, end: number): TextRange | null {
  let a = Math.max(0, Math.min(start, end, text.length));
  let b = Math.min(text.length, Math.max(start, end));
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return a < b ? { start: a, end: b, quote: text.slice(a, b) } : null;
}

/** Lays a device over an anchor (or a fragment of its text); returns the new mark. */
export function addMark(
  n: StoryNode,
  device: PlotDevice,
  anchor: MarkAnchor,
  selection: { start: number; end: number } | null = null,
): PlotMark | null {
  const text = anchorText(n, anchor);
  if (text === undefined) return null;
  const mark: PlotMark = {
    id: newId(),
    device,
    anchor: anchor.kind === 'node' ? { kind: 'node' } : { kind: anchor.kind, id: anchor.id },
    range: selection ? tightRange(text, selection.start, selection.end) : null,
    links: [],
    note: '',
    variables: [],
  };
  (n.marks ??= []).push(mark);
  return mark;
}

export function removeMark(n: StoryNode, id: string): void {
  if (n.marks) n.marks = n.marks.filter((m) => m.id !== id);
}

/** Marks on an option or line go away with it. */
export function dropMarksOn(n: StoryNode, a: MarkAnchor): void {
  if (n.marks) n.marks = n.marks.filter((m) => !sameAnchor(m.anchor, a));
}

export function linkMark(n: StoryNode, id: string, ref: NodeRef): void {
  const m = markOf(n, id);
  if (!m || m.links.some((l) => l.graph === ref.graph && l.node === ref.node)) return;
  m.links.push({ graph: ref.graph, node: ref.node });
}

export function unlinkMark(n: StoryNode, id: string, ref: NodeRef): void {
  const m = markOf(n, id);
  if (m) m.links = m.links.filter((l) => !(l.graph === ref.graph && l.node === ref.node));
}

export function updateMark(n: StoryNode, id: string, patch: Partial<Pick<PlotMark, 'note' | 'variables'>>): void {
  const m = markOf(n, id);
  if (m) Object.assign(m, patch);
}

/**
 * Where a marked fragment is in the text now: at its offsets if the quote is still there, else the
 * occurrence of the quote nearest to them, else null (the mark then covers the whole line).
 */
export function resolveRange(text: string, r: TextRange | null): { start: number; end: number } | null {
  if (!r || !r.quote) return null;
  if (text.slice(r.start, r.end) === r.quote) return { start: r.start, end: r.end };
  let best = -1;
  for (let i = text.indexOf(r.quote); i >= 0; i = text.indexOf(r.quote, i + 1)) {
    if (best < 0 || Math.abs(i - r.start) < Math.abs(best - r.start)) best = i;
  }
  return best >= 0 ? { start: best, end: best + r.quote.length } : null;
}

/**
 * Keeps marked fragments on the same words while their text is edited: the changed span is found by the
 * common beginning and end of the two texts. Typing inside a fragment grows it; deleting all of it turns
 * the mark into a mark of the whole line (its links stay).
 */
export function followText(n: StoryNode, anchor: MarkAnchor, before: string, after: string): void {
  if (before === after) return;
  const marks = marksOn(n, anchor).filter((m) => m.range);
  if (!marks.length) return;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s;
  const newEnd = after.length - s;
  const delta = newEnd - oldEnd;
  for (const m of marks) {
    const r = resolveRange(before, m.range);
    if (!r) {
      m.range = null;
      continue;
    }
    const start = r.start < p ? r.start : r.start >= oldEnd ? r.start + delta : newEnd;
    const end = r.end <= p ? r.end : r.end >= oldEnd ? r.end + delta : p;
    m.range = start < end ? { start, end, quote: after.slice(start, end) } : null;
  }
}

/** Short text that names a mark in lists: its fragment, else the option or line, else the node title. */
export function markLabel(n: StoryNode, m: PlotMark): string {
  const text = anchorText(n, m.anchor) ?? '';
  const r = resolveRange(text, m.range);
  const label = r ? text.slice(r.start, r.end) : m.anchor.kind === 'node' ? n.title : text;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

/** A gun or butterfly anywhere in a graph: a mark, or a node of the old kinds. */
export interface PlotSource {
  device: PlotDevice;
  at: NodeRef;
  /** The mark, or null for a gun or butterfly node. */
  mark: PlotMark | null;
  links: NodeRef[];
  title: string;
}

export function plotSources(g: GraphDoc): PlotSource[] {
  const out: PlotSource[] = [];
  for (const raw of g.nodes) {
    const n = asStory(raw);
    const at = { graph: g.id, node: n.id };
    if (n.kind === 'gun' || n.kind === 'butterfly') {
      out.push({ device: n.kind, at, mark: null, links: n.links ?? [], title: n.title });
    }
    for (const m of n.marks ?? []) {
      if (anchorText(n, m.anchor) === undefined) continue;
      out.push({ device: m.device, at, mark: m, links: m.links, title: markLabel(n, m) });
    }
  }
  return out;
}
