// Ink (0.9): strokes of a pen drawn right on a canvas (the project map). A stroke is a node of its own, so it
// is selected, moved, copied, deleted and undone like any other; its points are kept relative to the node and
// stretch with it when it is resized. Only its line takes clicks: what is under the empty parts stays reachable.

import { newId } from '../core/ids';
import { registerKind } from './kinds';
import type { GraphNode } from './model';

export const INK_KIND = 'ink';

export interface InkData {
  /** "#rrggbb". */
  color: string;
  /** World units; the line keeps it when the node is resized. */
  width: number;
  /** The size of the node the points were drawn in: they stretch from it to the node's size now. */
  w: number;
  h: number;
  /** x, y, x, y… relative to the node's top-left corner. */
  points: number[];
}

/** The smallest stroke box: a dot is still easy to pick. */
const MIN_SIDE = 8;

const round1 = (v: number) => Math.round(v * 10) / 10;

export function inkOf(node: GraphNode): InkData | null {
  const raw = node.ink as Partial<InkData> | undefined;
  if (!raw || !Array.isArray(raw.points) || raw.points.length < 2) return null;
  const points = raw.points.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (points.length < 2) return null;
  return {
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#e03131',
    width: typeof raw.width === 'number' && raw.width > 0 ? Math.min(raw.width, 64) : 4,
    w: typeof raw.w === 'number' && raw.w > 0 ? raw.w : node.w,
    h: typeof raw.h === 'number' && raw.h > 0 ? raw.h : node.h,
    points: points.length % 2 ? points.slice(0, -1) : points,
  };
}

/** A stroke node from world points (x, y, x, y…), its box around the line with room for its width. */
export function makeInk(points: readonly number[], color: string, width: number): GraphNode {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const pad = width / 2 + 2;
  const x = Math.floor(minX - pad);
  const y = Math.floor(minY - pad);
  const w = Math.max(MIN_SIDE, Math.ceil(maxX + pad) - x);
  const h = Math.max(MIN_SIDE, Math.ceil(maxY + pad) - y);
  const local = points.map((v, i) => round1(v - (i % 2 ? y : x)));
  return { id: newId(), kind: INK_KIND, title: '', x, y, w, h, ink: { color, width, w, h, points: local } };
}

/** The stroke's points relative to the node, stretched to its size now. */
export function inkLocalPoints(node: Pick<GraphNode, 'w' | 'h'>, ink: InkData): number[] {
  const sx = ink.w ? node.w / ink.w : 1;
  const sy = ink.h ? node.h / ink.h : 1;
  if (sx === 1 && sy === 1) return ink.points;
  return ink.points.map((v, i) => v * (i % 2 ? sy : sx));
}

/** World points of a stroke node where it is now. */
export function inkWorldPoints(node: GraphNode, ink: InkData): number[] {
  return inkLocalPoints(node, ink).map((v, i) => v + (i % 2 ? node.y : node.x));
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is the world point (x, y) on the line of a stroke node, `tolerance` around it counting? */
export function inkHit(node: GraphNode, x: number, y: number, tolerance: number): boolean {
  const ink = inkOf(node);
  if (!ink) return x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h;
  const reach = ink.width / 2 + tolerance;
  const p = inkLocalPoints(node, ink);
  const lx = x - node.x;
  const ly = y - node.y;
  if (p.length === 2) return Math.hypot(lx - p[0], ly - p[1]) <= reach;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segmentDistance(lx, ly, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

/** SVG path data of a stroke in the node's own coordinates: smoothed through the middles of its segments. */
export function inkPath(node: Pick<GraphNode, 'w' | 'h'>, ink: InkData): string {
  const p = inkLocalPoints(node, ink).map(round1);
  if (p.length === 2) return `M${p[0]} ${p[1]}h0.01`;
  if (p.length === 4) return `M${p[0]} ${p[1]}L${p[2]} ${p[3]}`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = round1((p[i] + p[i + 2]) / 2);
    const my = round1((p[i + 1] + p[i + 3]) / 2);
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  return `${d}L${p[p.length - 2]} ${p[p.length - 1]}`;
}

registerKind({
  id: INK_KIND,
  label: 'canvas.kind.ink',
  color: '#e03131',
  size: { w: 40, h: 40 },
  ports: () => [],
  shape: 'none',
  min: { w: MIN_SIDE, h: MIN_SIDE },
  hit: inkHit,
  // Drawn with the pen, not made from a menu.
  hidden: true,
});
