// Graph data shared by every canvas (story, chapters, project map, trees), as stored in
// data/graphs/<id>.json (docs/format/project-v1.md). Unknown fields are kept as read.

import type { ObjectRef } from '../core/ids';

export type GraphKind = 'projectMap' | 'story' | 'chapter' | 'tree' | 'freeform';

export interface GraphNode {
  id: string;
  kind: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Free text of a generic node or a sticker. */
  text?: string;
  /** Palette colour id (see NODE_COLORS), or null for the kind's default. */
  color?: string | null;
  /** Icon id from NODE_ICONS, or null. */
  icon?: string | null;
  /** Shown on hover (FR-CNV-04). */
  comment?: string;
  [extra: string]: unknown;
}

export interface PortRef {
  node: string;
  port: string;
}

export interface GraphEdge {
  id: string;
  from: PortRef;
  to: PortRef;
  label?: string;
  color?: string | null;
  /** Condition source text (ADR-005); used by story graphs. */
  condition?: string;
  [extra: string]: unknown;
}

/** A titled frame with explicit members: moving the frame moves its members (FR-CNV-04). */
export interface GraphGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string | null;
  members: string[];
  [extra: string]: unknown;
}

export interface GraphDoc {
  id: string;
  kind: GraphKind;
  name: string;
  parent?: ObjectRef | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  [extra: string]: unknown;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const GRID = 20;
export const HEADER_H = 28;
export const PORT_R = 6;

/** Node colours: dark-theme friendly, distinct, readable with light text on the header. */
export const NODE_COLORS = {
  slate: '#5b6474',
  red: '#c9473f',
  orange: '#c96a2b',
  amber: '#b88a1e',
  green: '#3a9a5b',
  teal: '#23917f',
  blue: '#3b74c9',
  violet: '#7656c9',
  pink: '#b8458a',
} as const;
export type NodeColor = keyof typeof NODE_COLORS;

export function colorHex(color: string | null | undefined, fallback: string): string {
  return color && color in NODE_COLORS ? NODE_COLORS[color as NodeColor] : fallback;
}

export function nodeRect(n: Pick<GraphNode, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: n.x, y: n.y, w: n.w, h: n.h };
}

export function boundsOf(rects: Iterable<Rect>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

export function intersects(a: Rect, b: Bounds): boolean {
  return a.x <= b.maxX && a.x + a.w >= b.minX && a.y <= b.maxY && a.y + a.h >= b.minY;
}

export function snap(value: number, step = GRID): number {
  return Math.round(value / step) * step;
}

export function emptyGraph(id: string, kind: GraphKind, name: string): GraphDoc {
  return { id, kind, name, parent: null, nodes: [], edges: [], groups: [] };
}
