// Edge shapes and distances. Edges are cubic Bézier curves leaving outputs to the right and entering
// inputs from the left; a backward edge (target to the left) bends wider so it stays readable.

import type { Bounds } from './model';

export interface Point {
  x: number;
  y: number;
}

export interface Curve {
  x1: number;
  y1: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x2: number;
  y2: number;
}

export const SEGMENTS = 16;

export function edgeCurve(a: Point, b: Point): Curve {
  const span = b.x - a.x;
  const bend = span >= 0 ? Math.max(40, span * 0.5) : Math.max(80, Math.min(240, -span * 0.5 + 60));
  return { x1: a.x, y1: a.y, c1x: a.x + bend, c1y: a.y, c2x: b.x - bend, c2y: b.y, x2: b.x, y2: b.y };
}

export function curvePoint(c: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c.x1 + b * c.c1x + d * c.c2x + e * c.x2, y: a * c.y1 + b * c.c1y + d * c.c2y + e * c.y2 };
}

/** Writes SEGMENTS line segments (x0, y0, x1, y1 each) into `out` from `offset`; returns the next offset. */
export function tessellate(c: Curve, out: Float32Array, offset: number, segments = SEGMENTS): number {
  let px = c.x1;
  let py = c.y1;
  for (let s = 1; s <= segments; s++) {
    const p = curvePoint(c, s / segments);
    out[offset++] = px;
    out[offset++] = py;
    out[offset++] = p.x;
    out[offset++] = p.y;
    px = p.x;
    py = p.y;
  }
  return offset;
}

/** Bounding box of the control polygon: contains the whole curve. */
export function curveBounds(c: Curve): Bounds {
  return {
    minX: Math.min(c.x1, c.c1x, c.c2x, c.x2),
    minY: Math.min(c.y1, c.c1y, c.c2y, c.y2),
    maxX: Math.max(c.x1, c.c1x, c.c2x, c.x2),
    maxY: Math.max(c.y1, c.c1y, c.c2y, c.y2),
  };
}

export function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

export function curveDistance(c: Curve, px: number, py: number, segments = SEGMENTS): number {
  let best = Infinity;
  let prev = { x: c.x1, y: c.y1 };
  for (let s = 1; s <= segments; s++) {
    const p = curvePoint(c, s / segments);
    best = Math.min(best, segmentDistance(px, py, prev.x, prev.y, p.x, p.y));
    prev = p;
  }
  return best;
}
