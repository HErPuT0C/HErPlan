// Uniform grid over node rectangles: viewport culling and hit testing in O(cells) instead of O(nodes).

import type { Bounds, Rect } from './model';

export class SpatialGrid {
  private cells = new Map<number, number[]>();

  constructor(private readonly cellSize = 512) {}

  private key(cx: number, cy: number): number {
    return (cx + 1_048_576) * 2_097_152 + (cy + 1_048_576);
  }

  rebuild(rects: readonly Rect[]): void {
    this.cells.clear();
    rects.forEach((r, i) => this.insert(r, i));
  }

  insert(r: Rect, index: number): void {
    const s = this.cellSize;
    const x0 = Math.floor(r.x / s);
    const x1 = Math.floor((r.x + r.w) / s);
    const y0 = Math.floor(r.y / s);
    const y1 = Math.floor((r.y + r.h) / s);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const list = this.cells.get(k);
        if (list) list.push(index);
        else this.cells.set(k, [index]);
      }
    }
  }

  /** Indexes of rectangles whose cells touch `b`; callers check exact overlap if they need it. */
  query(b: Bounds, out: Set<number> = new Set()): Set<number> {
    out.clear();
    const s = this.cellSize;
    const x0 = Math.floor(b.minX / s);
    const x1 = Math.floor(b.maxX / s);
    const y0 = Math.floor(b.minY / s);
    const y1 = Math.floor(b.maxY / s);
    // A huge query (the whole graph from far away) is cheaper as a scan of the filled cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      for (const list of this.cells.values()) for (const i of list) out.add(i);
      return out;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const i of list) out.add(i);
      }
    }
    return out;
  }
}
