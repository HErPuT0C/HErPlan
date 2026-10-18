import { HEADER_H, KINDS, SpatialGrid, type Graph } from './graph';
import { lodFor, type Renderer, type RenderStats } from './renderer';
import { visibleWorldRect, type Viewport } from './viewport';

const BG = '#14161b';
const DOT = '#262a33';
const BODY = '#1f232b';
const BORDER = '#323844';
const EDGE = 'rgba(150, 165, 190, 0.55)';
const TITLE = '#e8ebf1';
const TEXT = '#a9b0bd';

// Immediate-mode Canvas 2D renderer: viewport culling through a spatial grid, batched paths per colour, three LOD levels.
export class Canvas2DRenderer implements Renderer {
  readonly name = 'Canvas 2D';
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private graph!: Graph;
  private grid!: SpatialGrid;
  private visible = new Set<number>();
  private width = 0;
  private height = 0;
  private dpr = 1;

  mount(host: HTMLElement): void {
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    host.appendChild(this.canvas);
  }

  setGraph(graph: Graph): void {
    this.graph = graph;
    this.grid = new SpatialGrid(graph);
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  nodeMoved(): void {
    this.grid.rebuild();
  }

  hitTest(sx: number, sy: number, v: Viewport): number {
    const wx = (sx - v.tx) / v.scale;
    const wy = (sy - v.ty) / v.scale;
    const hits = new Set<number>();
    this.grid.query(wx, wy, wx, wy, hits);
    let found = -1;
    for (const i of hits) {
      const n = this.graph.nodes[i];
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) found = Math.max(found, i);
    }
    return found;
  }

  render(v: Viewport): RenderStats {
    const { ctx, graph, dpr } = this;
    const lod = lodFor(v.scale);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawDots(v);

    const r = visibleWorldRect(v, this.width, this.height);
    const margin = 40 / v.scale;
    this.grid.query(r.minX - margin, r.minY - margin, r.maxX + margin, r.maxY + margin, this.visible);

    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.tx, dpr * v.ty);

    // Edges: one path, culled by the bounding box of their endpoints.
    let edgeCount = 0;
    ctx.beginPath();
    const { nodes, edgeFrom, edgeTo } = graph;
    for (let e = 0; e < edgeFrom.length; e++) {
      const a = nodes[edgeFrom[e]];
      const b = nodes[edgeTo[e]];
      const x1 = a.x + a.w, y1 = a.y + a.h / 2;
      const x2 = b.x, y2 = b.y + b.h / 2;
      if (Math.max(x1, x2) < r.minX || Math.min(x1, x2) > r.maxX || Math.max(y1, y2) < r.minY || Math.min(y1, y2) > r.maxY) continue;
      edgeCount++;
      ctx.moveTo(x1, y1);
      if (lod === 'far') {
        ctx.lineTo(x2, y2);
      } else {
        const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      }
    }
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = Math.max(1, 1.5 / v.scale) * (lod === 'far' ? 0.8 : 1);
    ctx.stroke();

    // Node bodies, batched by colour.
    const byKind: number[][] = KINDS.map(() => []);
    for (const i of this.visible) byKind[nodes[i].kind].push(i);

    if (lod === 'far') {
      for (let k = 0; k < KINDS.length; k++) {
        ctx.beginPath();
        for (const i of byKind[k]) {
          const n = nodes[i];
          ctx.rect(n.x, n.y, n.w, n.h);
        }
        ctx.fillStyle = KINDS[k].color;
        ctx.fill();
      }
      return { nodes: this.visible.size, edges: edgeCount, lod };
    }

    const radius = lod === 'near' ? 8 : 0;
    ctx.beginPath();
    for (const i of this.visible) {
      const n = nodes[i];
      if (radius) ctx.roundRect(n.x, n.y, n.w, n.h, radius);
      else ctx.rect(n.x, n.y, n.w, n.h);
    }
    ctx.fillStyle = BODY;
    ctx.fill();
    if (lod === 'near') {
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1 / v.scale;
      ctx.stroke();
    }
    for (let k = 0; k < KINDS.length; k++) {
      ctx.beginPath();
      for (const i of byKind[k]) {
        const n = nodes[i];
        if (radius) ctx.roundRect(n.x, n.y, n.w, HEADER_H, [radius, radius, 0, 0]);
        else ctx.rect(n.x, n.y, n.w, HEADER_H);
      }
      ctx.fillStyle = KINDS[k].color;
      ctx.fill();
    }

    // Text only where it is readable.
    if (v.scale >= 0.4) {
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = TITLE;
      for (const i of this.visible) {
        const n = nodes[i];
        ctx.fillText(n.title, n.x + 10, n.y + HEADER_H / 2, n.w - 20);
      }
      if (lod === 'near') {
        ctx.font = '12px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = TEXT;
        for (const i of this.visible) {
          const n = nodes[i];
          ctx.fillText(n.line1, n.x + 10, n.y + HEADER_H + 20, n.w - 20);
          ctx.fillText(n.line2, n.x + 10, n.y + HEADER_H + 40, n.w - 20);
        }
        // Ports.
        ctx.beginPath();
        for (const i of this.visible) {
          const n = nodes[i];
          ctx.moveTo(n.x + 5, n.y + n.h / 2);
          ctx.arc(n.x, n.y + n.h / 2, 5, 0, Math.PI * 2);
          ctx.moveTo(n.x + n.w + 5, n.y + n.h / 2);
          ctx.arc(n.x + n.w, n.y + n.h / 2, 5, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#8b95a7';
        ctx.fill();
      }
    }
    return { nodes: this.visible.size, edges: edgeCount, lod };
  }

  private drawDots(v: Viewport): void {
    const step = 40 * v.scale;
    if (step < 12) return;
    const { ctx } = this;
    ctx.fillStyle = DOT;
    const ox = ((v.tx % step) + step) % step;
    const oy = ((v.ty % step) + step) % step;
    ctx.beginPath();
    for (let x = ox; x < this.width; x += step) for (let y = oy; y < this.height; y += step) ctx.rect(x, y, 1.5, 1.5);
    ctx.fill();
  }

  destroy(): void {
    this.canvas.remove();
  }
}
