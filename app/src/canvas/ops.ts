// Graph operations. Each works on a GraphDoc in place, so it can run inside a Store recipe (an Immer
// draft): the store records undo for free (FR-CNV-06). Nothing here touches React or the screen.

import { newId } from '../core/ids';
import { canEnd, canStart, findPort, kindOf, OPPOSITE_FACE, portsOf, type Port, type PortFace } from './kinds';
import {
  boundsOf,
  GRID,
  HEADER_H,
  snap,
  type GraphDoc,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type PortRef,
  type Rect,
} from './model';

export interface Selection {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  groups: ReadonlySet<string>;
}

export const EMPTY_SELECTION: Selection = { nodes: new Set(), edges: new Set(), groups: new Set() };

export function isEmptySelection(s: Selection): boolean {
  return s.nodes.size === 0 && s.edges.size === 0 && s.groups.size === 0;
}

export function createNode(kind: string, x: number, y: number, title: string): GraphNode {
  const def = kindOf(kind);
  return { id: newId(), kind: def.id, title, x: snap(x), y: snap(y), w: def.size.w, h: def.size.h, text: '' };
}

/** Node ids moved by moving these nodes and groups: a group carries its members along. */
export function movedNodeIds(g: GraphDoc, nodes: Iterable<string>, groups: Iterable<string>): Set<string> {
  const ids = new Set(nodes);
  const groupSet = new Set(groups);
  for (const group of g.groups) if (groupSet.has(group.id)) group.members.forEach((m) => ids.add(m));
  return ids;
}

export function moveItems(
  g: GraphDoc,
  nodes: Iterable<string>,
  groups: Iterable<string>,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  const groupSet = new Set(groups);
  const ids = movedNodeIds(g, nodes, groupSet);
  for (const n of g.nodes) {
    if (ids.has(n.id)) {
      n.x += dx;
      n.y += dy;
    }
  }
  for (const group of g.groups) {
    if (groupSet.has(group.id)) {
      group.x += dx;
      group.y += dy;
    }
  }
}

/** Removes the selection; edges of removed nodes go too, and removed nodes leave their groups. */
export function deleteItems(g: GraphDoc, s: Selection): void {
  const nodes = new Set(s.nodes);
  g.nodes = g.nodes.filter((n) => !nodes.has(n.id));
  g.edges = g.edges.filter((e) => !s.edges.has(e.id) && !nodes.has(e.from.node) && !nodes.has(e.to.node));
  g.groups = g.groups.filter((group) => !s.groups.has(group.id));
  for (const group of g.groups) {
    if (group.members.some((m) => nodes.has(m))) group.members = group.members.filter((m) => !nodes.has(m));
  }
}

export type ConnectRefusal = 'same-node' | 'duplicate' | 'bad-port';

/** Which end of an edge a port is asked to be. */
export type PortRole = 'start' | 'end';

const fits = (role: PortRole) => (role === 'start' ? canStart : canEnd);

/**
 * Connects two ports. Refuses loops onto the same node, ports that cannot start or end an edge, and
 * duplicates: a second edge between the same two nodes from the same output (any side anchor of a node
 * counts as one output, so pulling from the top and from the right does not make two edges).
 */
export function connect(g: GraphDoc, from: PortRef, to: PortRef): GraphEdge | ConnectRefusal {
  if (from.node === to.node) return 'same-node';
  const a = g.nodes.find((n) => n.id === from.node);
  const b = g.nodes.find((n) => n.id === to.node);
  const out = a && findPort(a, from.port);
  const inp = b && findPort(b, to.port);
  if (!a || !out || !inp || !canStart(out) || !canEnd(inp)) return 'bad-port';
  const sameOutput = (port: string) => port === from.port || (!!out.anchor && !!findPort(a, port)?.anchor);
  const exists = g.edges.some((e) => e.from.node === from.node && e.to.node === to.node && sameOutput(e.from.port));
  if (exists) return 'duplicate';
  const edge: GraphEdge = { id: newId(), from: { ...from }, to: { ...to } };
  g.edges.push(edge);
  return edge;
}

/**
 * The port of `node` to use as one end of an edge when the user did not aim at a port: the one closest to
 * `towards` (the other end), so edges attach to the facing side. Typed outputs not yet connected come first.
 */
export function defaultPort(
  node: GraphNode,
  role: PortRole,
  towards?: { x: number; y: number },
  used?: ReadonlySet<string>,
): string | null {
  let ports = portsOf(node).filter(fits(role));
  const free = ports.filter((p) => p.anchor || !used?.has(p.id));
  if (free.length) ports = free;
  if (ports.length === 0) return null;
  if (!towards) return ports[0].id;
  let best = ports[0];
  let bestDist = Infinity;
  for (const p of ports) {
    const d = Math.hypot(node.x + p.x - towards.x, node.y + p.y - towards.y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best.id;
}

/** Ports of `nodeId` that already start an edge (to prefer free choice options). */
export function usedStarts(g: GraphDoc, nodeId: string): Set<string> {
  return new Set(g.edges.filter((e) => e.from.node === nodeId).map((e) => e.from.port));
}

/**
 * A new node pulled out of a port and dropped at `at`: placed so that its port facing the source lands
 * on the drop point (pulled out of the left side, it appears on the left). Returns the node and its port.
 */
export function nodeAtPort(
  kind: string,
  at: { x: number; y: number },
  sourceFace: PortFace,
  role: PortRole,
  title: string,
): { node: GraphNode; port: string | null } {
  const node = createNode(kind, 0, 0, title);
  const ports = portsOf(node).filter(fits(role));
  const want = OPPOSITE_FACE[sourceFace];
  const port: Port | undefined = ports.find((p) => p.face === want) ?? ports[0];
  node.x = snap(at.x - (port?.x ?? 0));
  node.y = snap(at.y - (port?.y ?? node.h / 2));
  return { node, port: port?.id ?? null };
}

/** Splits edge A→B into A→N→B. The original edge keeps its id, label and condition on A→N. */
export function insertNodeIntoEdge(g: GraphDoc, edgeId: string, node: GraphNode): boolean {
  const edge = g.edges.find((e) => e.id === edgeId);
  const source = edge && g.nodes.find((n) => n.id === edge.from.node);
  const target = edge && g.nodes.find((n) => n.id === edge.to.node);
  if (!edge || !source || !target) return false;
  const center = (n: GraphNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  const inPort = defaultPort(node, 'end', center(source));
  const outPort = defaultPort(node, 'start', center(target));
  if (!inPort || !outPort) return false;
  g.nodes.push(node);
  const to = { ...edge.to };
  edge.to = { node: node.id, port: inPort };
  g.edges.push({ id: newId(), from: { node: node.id, port: outPort }, to });
  return true;
}

export function setNodeProps(g: GraphDoc, ids: Iterable<string>, props: Partial<Omit<GraphNode, 'id'>>): void {
  const set = new Set(ids);
  for (const n of g.nodes) if (set.has(n.id)) Object.assign(n, props);
}

/** Handle being dragged to resize: a corner or the middle of a side, as on a picture in a word processor. */
export type HandleDir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export const HANDLE_DIRS: readonly HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const CORNER_DIRS: readonly HandleDir[] = ['nw', 'ne', 'se', 'sw'];

/** Smallest size of a node or a frame. */
export function minSize(item: GraphNode | GraphGroup, isGroup: boolean): { w: number; h: number } {
  if (isGroup) return { w: GRID * 8, h: HEADER_H + GRID * 2 };
  return { w: GRID * 6, h: kindOf((item as GraphNode).kind).sticker ? GRID * 3 : HEADER_H + GRID * 2 };
}

/**
 * The rectangle after dragging handle `dir` by (dx, dy): the opposite side stays put. Moved sides snap to
 * the grid unless `free`; the size never drops below `min`.
 */
export function resizeRect(
  start: Rect,
  dir: HandleDir,
  dx: number,
  dy: number,
  min: { w: number; h: number },
  free = false,
): Rect {
  const s = (v: number) => (free ? v : snap(v));
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.w;
  let y2 = start.y + start.h;
  if (dir.includes('w')) x1 = Math.min(s(x1 + dx), x2 - min.w);
  if (dir.includes('e')) x2 = Math.max(s(x2 + dx), x1 + min.w);
  if (dir.includes('n')) y1 = Math.min(s(y1 + dy), y2 - min.h);
  if (dir.includes('s')) y2 = Math.max(s(y2 + dy), y1 + min.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Sets the position and size of a node or a frame (the end of a resize). */
export function setRect(g: GraphDoc, kind: 'node' | 'group', id: string, r: Rect): void {
  const item = kind === 'node' ? g.nodes.find((n) => n.id === id) : g.groups.find((x) => x.id === id);
  if (!item) return;
  item.x = r.x;
  item.y = r.y;
  item.w = r.w;
  item.h = r.h;
}

/** Wraps nodes in a new frame with a margin; returns the group. */
export function groupNodes(g: GraphDoc, ids: Iterable<string>, title: string): GraphGroup | null {
  const set = new Set(ids);
  const members = g.nodes.filter((n) => set.has(n.id));
  const b = boundsOf(members);
  if (!b) return null;
  const pad = GRID * 2;
  const group: GraphGroup = {
    id: newId(),
    title,
    x: b.minX - pad,
    y: b.minY - pad - HEADER_H,
    w: b.maxX - b.minX + pad * 2,
    h: b.maxY - b.minY + pad * 2 + HEADER_H,
    color: null,
    members: members.map((n) => n.id),
  };
  // Frames go under everything else that is already a frame-free node: draw order is the array order.
  g.groups.push(group);
  return group;
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter' | 'hspread' | 'vspread';

export function alignNodes(g: GraphDoc, ids: Iterable<string>, mode: AlignMode): void {
  const set = new Set(ids);
  const nodes = g.nodes.filter((n) => set.has(n.id));
  const b = boundsOf(nodes);
  if (!b || nodes.length < 2) return;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const spread = (axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'w' : 'h';
    const sorted = [...nodes].sort((p, q) => p[axis] - q[axis]);
    const total = sorted.reduce((sum, n) => sum + n[size], 0);
    const span = axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY;
    const gap = (span - total) / (sorted.length - 1);
    let pos = axis === 'x' ? b.minX : b.minY;
    for (const n of sorted) {
      n[axis] = Math.round(pos);
      pos += n[size] + gap;
    }
  };
  for (const n of nodes) {
    if (mode === 'left') n.x = b.minX;
    else if (mode === 'right') n.x = b.maxX - n.w;
    else if (mode === 'top') n.y = b.minY;
    else if (mode === 'bottom') n.y = b.maxY - n.h;
    else if (mode === 'hcenter') n.x = Math.round(cx - n.w / 2);
    else if (mode === 'vcenter') n.y = Math.round(cy - n.h / 2);
  }
  if (mode === 'hspread') spread('x');
  if (mode === 'vspread') spread('y');
}

// --- Clipboard (FR-CNV-05) ---

export const CLIPBOARD_FORMAT = 'herplan-graph-clipboard';

export interface GraphClipboard {
  format: typeof CLIPBOARD_FORMAT;
  version: 1;
  nodes: GraphNode[];
  /** Only edges with both ends inside the copied nodes. */
  edges: GraphEdge[];
  groups: GraphGroup[];
  /** Graphs that copied nodes own (chapters carry their content along). */
  graphs?: GraphDoc[];
}

export function copySelection(g: GraphDoc, s: Selection): GraphClipboard | null {
  const nodeIds = movedNodeIds(g, s.nodes, s.groups);
  const nodes = g.nodes.filter((n) => nodeIds.has(n.id));
  if (nodes.length === 0) return null;
  const edges = g.edges.filter((e) => nodeIds.has(e.from.node) && nodeIds.has(e.to.node));
  const groups = g.groups
    .filter((group) => s.groups.has(group.id))
    .map((group) => ({ ...group, members: group.members.filter((m) => nodeIds.has(m)) }));
  return structuredClone({ format: CLIPBOARD_FORMAT, version: 1, nodes, edges, groups });
}

export function isGraphClipboard(value: unknown): value is GraphClipboard {
  const v = value as Partial<GraphClipboard> | null;
  return (
    !!v && v.format === CLIPBOARD_FORMAT && Array.isArray(v.nodes) && Array.isArray(v.edges) && Array.isArray(v.groups)
  );
}

export interface Pasted {
  nodes: string[];
  edges: string[];
  groups: string[];
}

/** Pastes with new ids, placing the top-left corner of the copied items at `at` (snapped to the grid). */
export function pasteClipboard(g: GraphDoc, clip: GraphClipboard, at: { x: number; y: number }): Pasted {
  const b = boundsOf([...clip.nodes, ...clip.groups]);
  if (!b) return { nodes: [], edges: [], groups: [] };
  const dx = snap(at.x) - b.minX;
  const dy = snap(at.y) - b.minY;
  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    let id = ids.get(old);
    if (!id) ids.set(old, (id = newId()));
    return id;
  };
  const pasted: Pasted = { nodes: [], edges: [], groups: [] };
  for (const n of clip.nodes) {
    const copy = { ...structuredClone(n), id: fresh(n.id), x: n.x + dx, y: n.y + dy };
    g.nodes.push(copy);
    pasted.nodes.push(copy.id);
  }
  for (const e of clip.edges) {
    if (!ids.has(e.from.node) || !ids.has(e.to.node)) continue;
    const copy = {
      ...structuredClone(e),
      id: newId(),
      from: { ...e.from, node: fresh(e.from.node) },
      to: { ...e.to, node: fresh(e.to.node) },
    };
    g.edges.push(copy);
    pasted.edges.push(copy.id);
  }
  for (const group of clip.groups) {
    const copy = {
      ...structuredClone(group),
      id: newId(),
      x: group.x + dx,
      y: group.y + dy,
      members: group.members.filter((m) => ids.has(m)).map(fresh),
    };
    g.groups.push(copy);
    pasted.groups.push(copy.id);
  }
  return pasted;
}

// --- Search (FR-CNV-08) ---

/** Case- and ё-insensitive form for search. */
export function searchKey(text: string): string {
  return text.toLocaleLowerCase().replace(/ё/g, 'е');
}

export function findNodes(g: GraphDoc, query: string): string[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  return g.nodes
    .filter((n) => searchKey([n.title, n.text ?? '', n.comment ?? ''].join('\n')).includes(q))
    .map((n) => n.id);
}
