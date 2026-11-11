// Carrying a conversation over into the game (0.8). The game side (Claude) reads data/graphs/<id>.json and
// writes data/dialogue_import.json: what it took, when, and what it could not make sense of. HErPlan shows
// that as badges ("in the game", "changed since", "error") and, to tell what changed since, keeps the time
// of the last edit on conversations that have a name in the game, on their nodes, lines and options.

import type { GraphDoc, GraphNode } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { graphKey } from './gameKey';
import { asStory, isTextMark, type StoryNode } from './model';

export const IMPORT_FILE = 'data/dialogue_import.json';

export interface ImportProblem {
  node: string | null;
  line: string | null;
  text: string;
}

export interface ImportInfo {
  key: string;
  /** When the conversation was carried over (ISO 8601). */
  at: string;
  /** How many lines the game took, when it says. */
  lines: number | null;
  problems: ImportProblem[];
}

/** By graph id. */
export type ImportStatus = Record<string, ImportInfo>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** What the game side wrote; a missing or broken file is "nothing carried over yet" (`ok` false when broken). */
export function parseImport(text: string | null): { status: ImportStatus; ok: boolean } {
  if (text === null) return { status: {}, ok: true };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: {}, ok: false };
  }
  const graphs = (raw as { graphs?: unknown } | null)?.graphs;
  if (!graphs || typeof graphs !== 'object' || Array.isArray(graphs)) return { status: {}, ok: false };
  const status: ImportStatus = {};
  for (const [id, value] of Object.entries(graphs as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const o = value as Record<string, unknown>;
    const at = str(o.at);
    if (!at || Number.isNaN(Date.parse(at))) continue;
    status[id] = {
      key: str(o.key) ?? '',
      at,
      lines: typeof o.lines === 'number' ? o.lines : null,
      problems: (Array.isArray(o.problems) ? o.problems : [])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ node: str(p.node), line: str(p.line), text: str(p.text) ?? '' })),
    };
  }
  return { status, ok: true };
}

export type TransferState = 'inGame' | 'changed' | 'error';

const after = (stamp: unknown, at: string): boolean => typeof stamp === 'string' && Date.parse(stamp) > Date.parse(at);

/** Where a conversation stands; null when it was never carried over. */
export function graphTransfer(g: GraphDoc | undefined, info: ImportInfo | undefined): TransferState | null {
  if (!g || !info) return null;
  if (info.problems.length) return 'error';
  return after((g as { edited?: unknown }).edited, info.at) ? 'changed' : 'inGame';
}

/** Where a node stands, with what the game said about it. */
export function nodeTransfer(
  node: GraphNode,
  info: ImportInfo | undefined,
): { state: TransferState; problems: ImportProblem[] } | null {
  if (!info) return null;
  const problems = info.problems.filter((p) => p.node === node.id);
  if (problems.length) return { state: 'error', problems };
  return { state: after((node as { edited?: unknown }).edited, info.at) ? 'changed' : 'inGame', problems };
}

// ---------- what changed since ----------

export type TransferChange =
  | { kind: 'nodeAdded'; node: string; title: string }
  | { kind: 'linesChanged'; node: string; title: string; lines: string[] }
  | { kind: 'optionsChanged'; node: string; title: string; options: string[] }
  | { kind: 'nodeChanged'; node: string; title: string }
  /** Edges, or nodes that are gone: nothing left to point at. */
  | { kind: 'other' };

/** What was edited after the conversation was carried over; empty when nothing was, or it never was. */
export function transferChanges(g: GraphDoc | undefined, info: ImportInfo | undefined): TransferChange[] {
  if (!g || !info) return [];
  const out: TransferChange[] = [];
  for (const raw of g.nodes) {
    const n = asStory(raw);
    const stamps = n as { edited?: unknown; created?: unknown };
    if (!after(stamps.edited, info.at)) continue;
    if (after(stamps.created, info.at)) {
      out.push({ kind: 'nodeAdded', node: n.id, title: n.title });
      continue;
    }
    const lines = (n.lines ?? []).filter((l) => after((l as { edited?: unknown }).edited, info.at)).map((l) => l.id);
    const options = (n.options ?? [])
      .filter((o) => after((o as { edited?: unknown }).edited, info.at))
      .map((o) => o.id);
    if (lines.length) out.push({ kind: 'linesChanged', node: n.id, title: n.title, lines });
    if (options.length) out.push({ kind: 'optionsChanged', node: n.id, title: n.title, options });
    if (!lines.length && !options.length) out.push({ kind: 'nodeChanged', node: n.id, title: n.title });
  }
  if (!out.length && after((g as { edited?: unknown }).edited, info.at)) out.push({ kind: 'other' });
  return out;
}

/** The file of a conversation inside the project folder. */
export const graphFile = (graphId: string): string => `data/graphs/${graphId}.json`;

// ---------- the time of the last edit ----------

export interface EditStamp {
  graph: string;
  /** Absent: the conversation itself (its edges, its name, a node removed). */
  node?: string;
  line?: string;
  option?: string;
  /** The node is new. */
  created?: boolean;
}

/** Where things are on the canvas and what only the author reads: not edits of the conversation. */
const NODE_ASIDE = new Set(['x', 'y', 'w', 'h', 'expanded', 'color', 'comment', 'edited', 'created']);
const PART_ASIDE = new Set(['edited', 'note']);

const without = (o: object, aside: ReadonlySet<string>, more: readonly string[] = []): string =>
  JSON.stringify(Object.entries(o).filter(([k]) => !aside.has(k) && !more.includes(k)));

/** Lines and options that differ between two versions of a node, by id; new ones count. */
function changedParts<T extends { id: string }>(
  before: readonly T[] | undefined,
  now: readonly T[] | undefined,
): string[] {
  const old = new Map((before ?? []).map((p) => [p.id, p]));
  return (now ?? [])
    .filter((p) => {
      const was = old.get(p.id);
      return was !== p && (!was || without(was, PART_ASIDE) !== without(p, PART_ASIDE));
    })
    .map((p) => p.id);
}

/** The game's marks on each line, as text, to tell which lines had their formatting changed. */
function marksByLine(n: StoryNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of n.marks ?? []) {
    if (!isTextMark(m) || m.anchor.kind !== 'line') continue;
    out.set(m.anchor.id, (out.get(m.anchor.id) ?? '') + JSON.stringify([m.device, m.range, m.props]));
  }
  return out;
}

const ids = (list: readonly { id: string }[] | undefined): string => (list ?? []).map((p) => p.id).join(',');

/**
 * What to stamp after a change: conversations with a name in the game whose content (not layout) differs
 * between two states of the project. Pure; the caller writes the stamps (applyStamps).
 */
export function editStamps(prev: ProjectData, next: ProjectData): EditStamp[] {
  const out: EditStamp[] = [];
  if (prev.graphs === next.graphs) return out;
  for (const [id, rawNext] of Object.entries(next.graphs)) {
    const before = prev.graphs[id] as unknown as GraphDoc | undefined;
    const now = rawNext as unknown as GraphDoc;
    if (before === now || !graphKey(now) || !Array.isArray(now.nodes)) continue;
    // A conversation that just got its name starts clean: nothing was edited "since".
    if (!before) continue;
    let touched = graphKey(before) !== graphKey(now) && !!graphKey(before);
    if (before.edges !== now.edges && JSON.stringify(before.edges) !== JSON.stringify(now.edges)) touched = true;
    if (before.nodes !== now.nodes) {
      const old = new Map(before.nodes.map((n) => [n.id, n]));
      if (before.nodes.length !== now.nodes.length || now.nodes.some((n) => !old.has(n.id))) touched = true;
      for (const raw of now.nodes) {
        const was = old.get(raw.id);
        if (was === raw) continue;
        if (!was) {
          out.push({ graph: id, node: raw.id, created: true });
          continue;
        }
        const a = asStory(was);
        const b = asStory(raw);
        const lines = new Set(changedParts(a.lines, b.lines));
        const marksA = marksByLine(a);
        const marksB = marksByLine(b);
        for (const l of b.lines ?? []) if (marksA.get(l.id) !== marksB.get(l.id)) lines.add(l.id);
        const options = changedParts(a.options, b.options);
        const own =
          without(a, NODE_ASIDE, ['lines', 'options', 'marks']) !==
            without(b, NODE_ASIDE, ['lines', 'options', 'marks']) ||
          ids(a.lines) !== ids(b.lines) ||
          ids(a.options) !== ids(b.options);
        if (!own && !lines.size && !options.length) continue;
        out.push({ graph: id, node: raw.id });
        for (const line of lines) out.push({ graph: id, node: raw.id, line });
        for (const option of options) out.push({ graph: id, node: raw.id, option });
      }
    }
    if (touched || out.some((s) => s.graph === id)) out.push({ graph: id });
  }
  return out;
}

/** Writes the stamps (inside a Store recipe that is not an undo step). */
export function applyStamps(d: ProjectData, stamps: readonly EditStamp[], now: string): void {
  for (const s of stamps) {
    const g = d.graphs[s.graph] as unknown as GraphDoc | undefined;
    if (!g) continue;
    if (!s.node) {
      (g as { edited?: string }).edited = now;
      continue;
    }
    const n = g.nodes.find((x) => x.id === s.node) as (StoryNode & { edited?: string; created?: string }) | undefined;
    if (!n) continue;
    const part =
      (s.line && n.lines?.find((l) => l.id === s.line)) || (s.option && n.options?.find((o) => o.id === s.option));
    if (part) (part as { edited?: string }).edited = now;
    else {
      n.edited = now;
      if (s.created) n.created = now;
    }
  }
}
