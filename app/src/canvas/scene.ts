// Turns a graph, the selection and the interaction state into renderer batches. Each layer is cached
// and rebuilt only when its inputs change: moving the camera rebuilds nothing.

import type { Lod } from './camera';
import { curveBounds, endDirection, tessellate, SEGMENTS, edgeCurve, type Curve } from './geometry';
import { portKey, type GraphIndex } from './graphIndex';
import { kindOf, portsOf, portPosition } from './kinds';
import { colorHex, HEADER_H, type GraphNode } from './model';
import type { Selection } from './ops';
import {
  ARROW_STRIDE,
  BOX_STRIDE,
  DISC_STRIDE,
  EMPTY_BATCH,
  SEG_STRIDE,
  type Batch,
  type BatchRange,
  type Rgba,
} from './gl/renderer';

export interface Theme {
  bg: Rgba;
  dot: Rgba;
  surface: Rgba;
  surface2: Rgba;
  line: Rgba;
  text: Rgba;
  muted: Rgba;
  accent: Rgba;
  warning: Rgba;
}

export function hexToRgba(hex: string, alpha = 1): Rgba {
  const h = hex.trim().replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

const withAlpha = (c: Rgba, a: number): Rgba => [c[0], c[1], c[2], a];
const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  1,
];

/** Colours from the design tokens (they change with the accent setting). */
export function readTheme(root: Element = document.documentElement): Theme {
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) => hexToRgba(css.getPropertyValue(name) || fallback);
  const bg = v('--bg', '#121418');
  return {
    bg,
    dot: mix(bg, v('--text-muted', '#9aa1ae'), 0.18),
    surface: v('--surface', '#1a1d23'),
    surface2: v('--surface-2', '#22262e'),
    line: v('--line', '#2e333d'),
    text: v('--text', '#e7e9ee'),
    muted: v('--text-muted', '#9aa1ae'),
    accent: v('--accent', '#34c9a5'),
    warning: v('--warning', '#e0a63a'),
  };
}

export interface DragOffset {
  /** Node ids that move (group members included). */
  nodes: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  dx: number;
  dy: number;
}

/** A node or a frame being resized: drawn at this rectangle until the drag ends. */
export interface Resizing {
  kind: 'node' | 'group';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneInput {
  index: GraphIndex;
  selection: Selection;
  hoverEdge: string | null;
  highlight: ReadonlySet<string>;
  current: string | null;
  drag: DragOffset | null;
  lod: Lod;
  /** Edges as straight lines (far away, big graphs): one segment instead of SEGMENTS. */
  straight: boolean;
  resizing: Resizing | null;
  theme: Theme;
}

export interface Scene {
  groups: Batch;
  edges: Batch;
  arrows: Batch;
  nodes: Batch;
  ports: Batch;
}

/** Node position including a drag in progress. */
function placed(n: GraphNode, drag: DragOffset | null): GraphNode {
  return drag && drag.nodes.has(n.id) ? { ...n, x: n.x + drag.dx, y: n.y + drag.dy } : n;
}

const segmentCache = new WeakMap<GraphIndex, { curved: Float32Array; straight: Float32Array }>();

/** Tessellated edges of one graph version, shared by every rebuild until the graph changes. */
function segmentsOf(index: GraphIndex) {
  let cached = segmentCache.get(index);
  if (!cached) {
    const edges = index.curves.length;
    const curved = new Float32Array(edges * SEGMENTS * 4);
    const straight = new Float32Array(edges * 4);
    index.curves.forEach((c, i) => {
      if (!c) return;
      tessellate(c, curved, i * SEGMENTS * 4);
      straight.set([c.x1, c.y1, c.x2, c.y2], i * 4);
    });
    cached = { curved, straight };
    segmentCache.set(index, cached);
  }
  return cached;
}

function dragCurve(index: GraphIndex, e: number, drag: DragOffset): Curve | null {
  const edge = index.graph.edges[e];
  const a = index.node(edge.from.node);
  const b = index.node(edge.to.node);
  const p1 = a && portPosition(placed(a, drag), edge.from.port);
  const p2 = b && portPosition(placed(b, drag), edge.to.port);
  return p1 && p2 ? edgeCurve(p1, p2, p1.face, p2.face) : null;
}

/** Edges are grouped into square areas of this size (world units) so the renderer can skip off-screen ones. */
const TILE = 1024;

export function buildEdges(s: SceneInput): { edges: Batch; arrows: Batch } {
  const { index, drag, lod, theme } = s;
  const graph = index.graph;
  const far = lod === 'far';
  const straight = s.straight;
  const perEdge = straight ? 1 : SEGMENTS;
  const cached = segmentsOf(index);
  const source = straight ? cached.straight : cached.curved;
  const normal = mix(theme.bg, theme.muted, 0.55);

  // Resolve every edge's curve (dragged nodes move their edges) and sort edges by area.
  const items: { e: number; curve: Curve; moved: boolean; tile: number }[] = [];
  graph.edges.forEach((edge, e) => {
    const moved = !!drag && (drag.nodes.has(edge.from.node) || drag.nodes.has(edge.to.node));
    const curve = moved ? dragCurve(index, e, drag!) : index.curves[e];
    if (!curve) return;
    const cx = Math.floor((curve.x1 + curve.x2) / 2 / TILE);
    const cy = Math.floor((curve.y1 + curve.y2) / 2 / TILE);
    items.push({ e, curve, moved, tile: (cx + 32768) * 65536 + (cy + 32768) });
  });
  items.sort((a, b) => a.tile - b.tile);

  const edges = new Float32Array(items.length * perEdge * SEG_STRIDE);
  const arrows = new Float32Array(far ? 0 : items.length * ARROW_STRIDE);
  const edgeRanges: BatchRange[] = [];
  const arrowRanges: BatchRange[] = [];
  const scratch = new Float32Array(SEGMENTS * 4);
  let count = 0;
  let current: BatchRange | null = null;
  let currentTile = NaN;
  items.forEach(({ e, curve, moved, tile }, k) => {
    const edge = graph.edges[e];
    let segs: Float32Array = source;
    let base = e * perEdge * 4;
    if (moved) {
      if (straight) scratch.set([curve.x1, curve.y1, curve.x2, curve.y2]);
      else tessellate(curve, scratch, 0);
      segs = scratch;
      base = 0;
    }
    if (tile !== currentTile) {
      currentTile = tile;
      current = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, start: count, count: 0 };
      edgeRanges.push(current);
      arrowRanges.push({ ...current, start: k, count: 0 });
    }
    const b = curveBounds(curve);
    const range = current!;
    range.minX = Math.min(range.minX, b.minX);
    range.minY = Math.min(range.minY, b.minY);
    range.maxX = Math.max(range.maxX, b.maxX);
    range.maxY = Math.max(range.maxY, b.maxY);
    const selected = s.selection.edges.has(edge.id) || s.hoverEdge === edge.id;
    const color = selected ? theme.accent : edge.color ? hexToRgba(colorHex(edge.color, '#5b6474')) : normal;
    const width = far ? (straight ? 1 : 1.5) : selected ? 3 : 2;
    for (let j = 0; j < perEdge; j++) {
      const o = count * SEG_STRIDE;
      edges.set(segs.subarray(base + j * 4, base + j * 4 + 4), o);
      edges.set(color, o + 4);
      edges[o + 8] = width;
      count++;
    }
    range.count += perEdge;
    const arrowRange = arrowRanges[arrowRanges.length - 1];
    Object.assign(arrowRange, { minX: range.minX, minY: range.minY, maxX: range.maxX, maxY: range.maxY });
    arrowRange.count++;
    if (!far) {
      const d = endDirection(curve);
      arrows.set([curve.x2, curve.y2, d.x, d.y, ...color], k * ARROW_STRIDE);
    }
  });
  return {
    edges: { data: edges, count, ranges: edgeRanges },
    arrows: { data: arrows, count: far ? 0 : items.length, ranges: arrowRanges },
  };
}

export function buildNodes(s: SceneInput): { nodes: Batch; ports: Batch } {
  if (s.lod === 'near') return { nodes: EMPTY_BATCH, ports: EMPTY_BATCH };
  const { index, drag, theme, lod } = s;
  const graph = index.graph;
  const far = lod === 'far';
  const nodes = new Float32Array(graph.nodes.length * BOX_STRIDE);
  const portList: number[] = [];
  graph.nodes.forEach((raw, i) => {
    const n = placed(raw, drag);
    const kind = kindOf(n.kind);
    const head = hexToRgba(colorHex(n.color, kind.color));
    const sticker = kind.sticker === true;
    const body = far || sticker ? mix(theme.surface, head, sticker ? 0.35 : 0.85) : theme.surface;
    const selected = s.selection.nodes.has(n.id);
    const found = s.highlight.has(n.id);
    const border = selected ? theme.accent : found ? theme.warning : withAlpha(theme.line, far ? 0 : 1);
    const borderWidth = selected || found ? (s.current === n.id ? 3 : 2) : 1;
    nodes.set(
      [
        n.x,
        n.y,
        n.w,
        n.h,
        ...body,
        ...(sticker || far ? body : head),
        ...border,
        sticker ? 0 : HEADER_H,
        8,
        borderWidth,
        0,
      ],
      i * BOX_STRIDE,
    );
    if (!far) {
      // Side anchors appear only once connected (or on hover, see anchorBatch); typed outputs always.
      for (const port of portsOf(n)) {
        if (port.anchor && !index.connected.has(portKey(n.id, port.id))) continue;
        pushPort(portList, n.x + port.x, n.y + port.y, theme);
      }
    }
  });
  return {
    nodes: { data: nodes, count: graph.nodes.length },
    ports: { data: Float32Array.from(portList), count: portList.length / DISC_STRIDE },
  };
}

function pushPort(list: number[], x: number, y: number, theme: Theme, hot = false): void {
  list.push(x, y, 4.5, 0, ...theme.surface2);
  list.push(x, y, 4.5, 1.5, ...(hot ? theme.accent : mix(theme.bg, theme.muted, 0.8)));
}

/** All ports of the node under the cursor, so free side anchors can be grabbed at mid zoom too. */
export function anchorBatch(node: GraphNode, theme: Theme): Batch {
  const list: number[] = [];
  for (const port of portsOf(node)) pushPort(list, node.x + port.x, node.y + port.y, theme, port.side !== 'in');
  return { data: Float32Array.from(list), count: list.length / DISC_STRIDE };
}

export function buildGroups(s: SceneInput): Batch {
  const { index, drag, theme } = s;
  const groups = index.graph.groups;
  const data = new Float32Array(groups.length * BOX_STRIDE);
  groups.forEach((group, i) => {
    const r = s.resizing;
    const g = r?.kind === 'group' && r.id === group.id ? { ...group, x: r.x, y: r.y, w: r.w, h: r.h } : group;
    const moved = drag?.groups.has(g.id);
    const x = g.x + (moved ? drag!.dx : 0);
    const y = g.y + (moved ? drag!.dy : 0);
    const c = hexToRgba(colorHex(g.color, '#5b6474'));
    const selected = s.selection.groups.has(g.id);
    data.set(
      [
        x,
        y,
        g.w,
        g.h,
        ...withAlpha(c, 0.08),
        ...withAlpha(c, 0.22),
        ...(selected ? theme.accent : withAlpha(c, 0.6)),
        HEADER_H,
        10,
        selected ? 2 : 1.5,
        0,
      ],
      i * BOX_STRIDE,
    );
  });
  return { data, count: groups.length };
}

/** Rectangle being dragged out to select (world coordinates). */
export function marqueeBatch(x0: number, y0: number, x1: number, y1: number, theme: Theme): Batch {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const data = Float32Array.from([
    x,
    y,
    Math.abs(x1 - x0),
    Math.abs(y1 - y0),
    ...withAlpha(theme.accent, 0.1),
    ...withAlpha(theme.accent, 0.1),
    ...withAlpha(theme.accent, 0.9),
    0,
    2,
    1,
    0,
  ]);
  return { data, count: 1 };
}

/** The edge that follows the cursor while connecting. */
export function previewBatch(curve: Curve, theme: Theme): Batch {
  const segs = new Float32Array(SEGMENTS * 4);
  tessellate(curve, segs, 0);
  const data = new Float32Array(SEGMENTS * SEG_STRIDE);
  for (let k = 0; k < SEGMENTS; k++) {
    data.set(segs.subarray(k * 4, k * 4 + 4), k * SEG_STRIDE);
    data.set(theme.accent, k * SEG_STRIDE + 4);
    data[k * SEG_STRIDE + 8] = 2;
  }
  return { data, count: SEGMENTS };
}
