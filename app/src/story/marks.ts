// Plot marks: Chekhov's gun and the butterfly effect laid over a node, a choice option, a dialogue line, or
// a fragment of their text, instead of being nodes of their own. A marked fragment follows edits of its
// text (followText); one changed outside HErPlan is found again by its quote, or the mark falls back to
// the whole line. Older projects keep their gun and butterfly nodes: plotSources() reads both.

import type { GraphDoc } from '../canvas/model';
import { newId } from '../core/ids';
import type { ProjectData } from '../core/project/types';
import {
  allGraphs,
  asStory,
  isPlotMark,
  plotMarks,
  textMarks,
  toward,
  type CueProps,
  type NodeMark,
  type MarkAnchor,
  type NodeRef,
  type PlotDevice,
  type PlotMark,
  type PlotRole,
  type StoryNode,
  type StyleProps,
  type TextMark,
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

/** Plot devices on an anchor (the game's marks are apart: textMarksOn). */
export function marksOn(n: StoryNode, a: MarkAnchor): PlotMark[] {
  return plotMarks(n).filter((m) => sameAnchor(m.anchor, a));
}

export function markOf(n: StoryNode | undefined, id: string): PlotMark | undefined {
  return plotMarks(n).find((m) => m.id === id);
}

// ---------- the game's marks on dialogue lines (0.8) ----------

export function textMarksOn(n: StoryNode, a: MarkAnchor): TextMark[] {
  return textMarks(n).filter((m) => sameAnchor(m.anchor, a));
}

export function textMarkOf(n: StoryNode | undefined, id: string): TextMark | undefined {
  return textMarks(n).find((m) => m.id === id);
}

/** Where a cue is in its line now: its offset, kept inside the text. */
export function cueAt(text: string, m: TextMark): number {
  return Math.max(0, Math.min(text.length, m.range?.start ?? text.length));
}

/** Marks words of a line with a look; null when nothing but spaces was selected. */
export function addStyleMark(
  n: StoryNode,
  lineId: string,
  selection: { start: number; end: number },
  props: StyleProps,
): TextMark | null {
  const anchor: MarkAnchor = { kind: 'line', id: lineId };
  const text = anchorText(n, anchor);
  const range = text === undefined ? null : tightRange(text, selection.start, selection.end);
  if (!range) return null;
  const props1 = cleanProps(props);
  if (!Object.keys(props1).length) return null;
  // The same words already have a look: it takes these props too.
  const twin = textMarksOn(n, anchor).find((m) => {
    if (m.device !== 'style') return false;
    const r = resolveRange(text!, m.range);
    return r?.start === range.start && r.end === range.end;
  });
  if (twin) {
    twin.props = { ...twin.props, ...props1 };
    return twin;
  }
  const mark: TextMark = { id: newId(), device: 'style', anchor, range, props: props1 };
  (n.marks ??= []).push(mark);
  return mark;
}

/** Puts a cue at a point of a line. */
export function addCueMark(n: StoryNode, lineId: string, at: number, props: CueProps): TextMark | null {
  const anchor: MarkAnchor = { kind: 'line', id: lineId };
  const text = anchorText(n, anchor);
  const clean = cleanProps(props);
  // Cues stand inside the text (0.8.1): what holds from the start is set in the line's fields.
  if (text === undefined || at <= 0 || !Object.keys(clean).length) return null;
  props = clean;
  const pos = Math.max(0, Math.min(text.length, at));
  const mark: TextMark = { id: newId(), device: 'cue', anchor, range: { start: pos, end: pos, quote: '' }, props };
  (n.marks ??= []).push(mark);
  return mark;
}

/**
 * Replaces what a style or cue mark says (inside a Store recipe). A mark left with nothing to say goes away,
 * and one that came to cover the same words as another is joined with it (tidyNode).
 */
export function setMarkProps(n: StoryNode, id: string, props: StyleProps | CueProps): void {
  const m = textMarkOf(n, id);
  if (!m) return;
  m.props = props;
  tidyNode(n);
}

// ---------- one place for one thing (0.8.1, "Редактор реплик" 3) ----------

const blank = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === '' ||
  v === false ||
  (typeof v === 'number' && !Number.isFinite(v)) ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v as { id?: unknown }).id);

/** The props without the values that say nothing (blank text, false, an emote without an id…). */
export function cleanProps<T extends object>(props: T): T {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => !blank(v))) as T;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a cue at the very start of a line becomes: the line's own field. */
const START_FIELDS = ['emote', 'gesture', 'face'] as const;

/**
 * Keeps the game's marks of a node tidy (inside a Store recipe); true when anything changed:
 * - a look with no props and a cue with no value are dropped (the game does not need them);
 * - two looks over the same words become one (the later's props over the earlier's), equal cues one;
 * - an emote, a gesture or a face at the very start of a line goes into the line's field when that is empty:
 *   the fields under the text are what holds from the start; when the field is taken the mark stays, shown
 *   as a mistake (startCue).
 */
export function tidyNode(n: StoryNode): boolean {
  if (!n.marks?.length) return false;
  const before = JSON.stringify(n.marks) + JSON.stringify(n.lines ?? []);
  const kept: NodeMark[] = [];
  for (const m of n.marks) {
    if (!isPlotMark(m)) {
      const props = cleanProps(m.props);
      if (!Object.keys(props).length) continue;
      if (!sameJson(props, m.props)) m.props = props;
      const text = anchorText(n, m.anchor);
      if (text === undefined) {
        kept.push(m);
        continue;
      }
      if (m.device === 'style') {
        const r = resolveRange(text, m.range);
        const twin = kept.find(
          (x): x is TextMark =>
            !isPlotMark(x) &&
            x.device === 'style' &&
            sameAnchor(x.anchor, m.anchor) &&
            sameJson(resolveRange(text, x.range), r),
        );
        if (twin) {
          twin.props = { ...twin.props, ...m.props };
          continue;
        }
      } else {
        const at = cueAt(text, m);
        if (
          kept.some(
            (x) =>
              !isPlotMark(x) &&
              x.device === 'cue' &&
              sameAnchor(x.anchor, m.anchor) &&
              cueAt(text, x) === at &&
              sameJson(x.props, m.props),
          )
        ) {
          continue;
        }
        if (at === 0 && m.anchor.kind === 'line' && liftStartCue(n, m.anchor.id, m.props)) continue;
      }
    }
    kept.push(m);
  }
  // Untouched marks stay the same object (no change for the store to save).
  if (kept.length !== n.marks.length) n.marks = kept;
  return JSON.stringify(n.marks) + JSON.stringify(n.lines ?? []) !== before;
}

/** Moves an emote, a gesture or a face from the start of a line into its empty field; false when it cannot. */
function liftStartCue(n: StoryNode, lineId: string, props: CueProps): boolean {
  const line = n.lines?.find((l) => l.id === lineId);
  const kind = START_FIELDS.find((k) => props[k] !== undefined);
  if (!line || !kind || Object.keys(props).length !== 1 || line[kind]) return false;
  const value = toward(props[kind]);
  if (!value) return false;
  // The line's face has no "to whom": a face for somebody else stays a mark.
  if (kind === 'face') {
    if (value.to) return false;
    line.face = value.id;
  } else {
    line[kind] = props[kind];
  }
  return true;
}

/** A cue that stands at the very start of its line, where the fields under the text belong (a mistake). */
export function startCue(n: StoryNode, m: TextMark): boolean {
  if (m.device !== 'cue') return false;
  const text = anchorText(n, m.anchor);
  return text !== undefined && cueAt(text, m) === 0;
}

/** Tidies every story graph of a project (inside a Store recipe); how many nodes changed. */
export function tidyProject(d: ProjectData): number {
  let changed = 0;
  for (const g of allGraphs(d)) {
    for (const raw of g.nodes ?? []) if (tidyNode(asStory(raw))) changed++;
  }
  return changed;
}

/**
 * Bold on or off for the selected words: a bold mark exactly over them is removed, otherwise one is made.
 */
export function toggleBold(n: StoryNode, lineId: string, selection: { start: number; end: number }): void {
  const anchor: MarkAnchor = { kind: 'line', id: lineId };
  const text = anchorText(n, anchor);
  const range = text === undefined ? null : tightRange(text, selection.start, selection.end);
  if (!range || text === undefined) return;
  const same = textMarksOn(n, anchor).find((m) => {
    if (m.device !== 'style' || !m.props.bold) return false;
    const r = resolveRange(text, m.range);
    return r?.start === range.start && r.end === range.end;
  });
  if (!same) {
    addStyleMark(n, lineId, range, { bold: true });
  } else if (same.device === 'style' && Object.keys(same.props).some((k) => k !== 'bold')) {
    delete same.props.bold;
  } else {
    removeMark(n, same.id);
  }
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
  const marks = (n.marks ?? []).filter((m) => sameAnchor(m.anchor, anchor) && m.range);
  if (!marks.length) return;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s;
  const newEnd = after.length - s;
  const delta = newEnd - oldEnd;
  const gone: string[] = [];
  for (const m of marks) {
    if (m.device === 'cue') {
      // A point: it stays before what is typed at it, and goes to the start of a cut that took it.
      const at = Math.max(0, Math.min(before.length, m.range!.start));
      const pos = at <= p ? at : at >= oldEnd ? at + delta : p;
      m.range = { start: pos, end: pos, quote: '' };
      continue;
    }
    const r = resolveRange(before, m.range);
    if (!r) {
      if (m.device === 'style') gone.push(m.id);
      else m.range = null;
      continue;
    }
    const start = r.start < p ? r.start : r.start >= oldEnd ? r.start + delta : newEnd;
    const end = r.end <= p ? r.end : r.end >= oldEnd ? r.end + delta : p;
    if (start < end) m.range = { start, end, quote: after.slice(start, end) };
    // A plot device stays on the whole line; a look without its words is nothing.
    else if (m.device === 'style') gone.push(m.id);
    else m.range = null;
  }
  if (gone.length) n.marks = n.marks!.filter((m) => !gone.includes(m.id));
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
    for (const m of plotMarks(n)) {
      if (anchorText(n, m.anchor) === undefined) continue;
      out.push({ device: m.device, at, mark: m, links: m.links, title: markLabel(n, m) });
    }
  }
  return out;
}

// ---------- the other end: payoffs and consequences ----------

/** Roles a node is expected to play (set by hand), read from 0.2 files (`plotRole`) as well. */
export function rolesOf(n: StoryNode): PlotRole[] {
  return n.plotRoles ?? (n.plotRole ? [n.plotRole] : []);
}

export function setRole(n: StoryNode, role: PlotRole, on: boolean): void {
  const roles = rolesOf(n).filter((r) => r !== role);
  if (on) roles.push(role);
  delete n.plotRole;
  if (roles.length) n.plotRoles = roles;
  else delete n.plotRoles;
}

/** The device whose target has this role: guns land in payoffs, butterflies in consequences. */
export const deviceOf = (role: PlotRole): PlotDevice => (role === 'payoff' ? 'gun' : 'butterfly');

/** Every gun or butterfly of the project, wherever it is. */
export function allSources(data: ProjectData, device?: PlotDevice): PlotSource[] {
  return allGraphs(data)
    .flatMap(plotSources)
    .filter((s) => !device || s.device === device);
}

/** Links a source (a mark, or a gun or butterfly node of old) to a node (inside a Store recipe). */
export function linkSource(d: ProjectData, src: Pick<PlotSource, 'at' | 'mark'>, to: NodeRef): void {
  const g = allGraphs(d).find((x) => x.id === src.at.graph);
  const n = g?.nodes.find((x) => x.id === src.at.node) as StoryNode | undefined;
  if (!n) return;
  const links = src.mark ? markOf(n, src.mark.id)?.links : (n.links ??= []);
  if (links && !links.some((l) => l.graph === to.graph && l.node === to.node)) {
    links.push({ graph: to.graph, node: to.node });
  }
}

/** Removes every link of a device that lands in `to` (inside a Store recipe). */
export function unlinkAllTo(d: ProjectData, to: NodeRef, device: PlotDevice): void {
  const other = (l: NodeRef) => !(l.graph === to.graph && l.node === to.node);
  for (const g of allGraphs(d)) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.kind === device && n.links?.some((l) => !other(l))) n.links = n.links.filter(other);
      for (const m of plotMarks(n)) {
        if (m.device === device && m.links.some((l) => !other(l))) m.links = m.links.filter(other);
      }
    }
  }
}
