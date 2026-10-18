import { HEADER_H, KINDS, SpatialGrid, type Graph } from './graph';
import { lodFor, type Renderer, type RenderStats } from './renderer';
import { visibleWorldRect, type Viewport } from './viewport';

// Retained DOM renderer in the style of DOM-based node editors: one element per node, one SVG path per edge,
// a CSS transform on the world container. With `cull` on, only nodes near the viewport stay mounted.
export class DomRenderer implements Renderer {
  readonly name: string;
  private root = document.createElement('div');
  private world = document.createElement('div');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private graph!: Graph;
  private grid!: SpatialGrid;
  private els: (HTMLDivElement | null)[] = [];
  private paths: SVGPathElement[] = [];
  private mounted = new Set<number>();
  private visible = new Set<number>();
  private width = 0;
  private height = 0;
  private lastLod = '';

  constructor(private cull: boolean) {
    this.name = cull ? 'DOM + отсечение' : 'DOM';
  }

  mount(host: HTMLElement): void {
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#14161b' });
    Object.assign(this.world.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', willChange: 'transform' });
    this.svg.style.position = 'absolute';
    this.svg.style.overflow = 'visible';
    this.svg.style.pointerEvents = 'none';
    this.world.appendChild(this.svg);
    this.root.appendChild(this.world);
    host.appendChild(this.root);
  }

  setGraph(graph: Graph): void {
    this.graph = graph;
    this.grid = new SpatialGrid(graph);
    this.els = graph.nodes.map(() => null);
    this.svg.replaceChildren();
    this.paths = [];
    const b = graph.bounds;
    this.svg.setAttribute('width', String(b.maxX + 100));
    this.svg.setAttribute('height', String(b.maxY + 100));
    for (let e = 0; e < graph.edgeFrom.length; e++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'rgba(150,165,190,0.55)');
      p.setAttribute('stroke-width', '1.5');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      this.paths.push(p);
      this.updateEdge(e);
      this.svg.appendChild(p);
    }
    if (!this.cull) graph.nodes.forEach((_, i) => this.mountNode(i));
  }

  private updateEdge(e: number): void {
    const { nodes, edgeFrom, edgeTo } = this.graph;
    const a = nodes[edgeFrom[e]], b = nodes[edgeTo[e]];
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    this.paths[e].setAttribute('d', `M${x1},${y1}C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
  }

  private mountNode(i: number): void {
    if (this.els[i]) return;
    const n = this.graph.nodes[i];
    const el = document.createElement('div');
    el.className = 'dn';
    el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px`;
    el.innerHTML = `<div class="dn-h" style="background:${KINDS[n.kind].color};height:${HEADER_H}px">${n.title}</div><div class="dn-b">${n.line1}<br>${n.line2}</div>`;
    this.els[i] = el;
    this.world.appendChild(el);
    this.mounted.add(i);
  }

  private unmountNode(i: number): void {
    this.els[i]?.remove();
    this.els[i] = null;
    this.mounted.delete(i);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  nodeMoved(i: number): void {
    const n = this.graph.nodes[i];
    const el = this.els[i];
    if (el) {
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
    }
    const { edgeFrom, edgeTo } = this.graph;
    for (let e = 0; e < edgeFrom.length; e++) if (edgeFrom[e] === i || edgeTo[e] === i) this.updateEdge(e);
    this.grid.rebuild();
  }

  hitTest(sx: number, sy: number, v: Viewport): number {
    const wx = (sx - v.tx) / v.scale, wy = (sy - v.ty) / v.scale;
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
    const lod = lodFor(v.scale);
    this.world.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.scale})`;
    if (lod !== this.lastLod) {
      this.root.dataset.lod = lod;
      this.lastLod = lod;
    }
    const r = visibleWorldRect(v, this.width, this.height);
    this.grid.query(r.minX, r.minY, r.maxX, r.maxY, this.visible);
    if (this.cull) {
      for (const i of [...this.mounted]) if (!this.visible.has(i)) this.unmountNode(i);
      for (const i of this.visible) this.mountNode(i);
    }
    return { nodes: this.cull ? this.mounted.size : this.graph.nodes.length, edges: this.graph.edgeFrom.length, lod };
  }

  destroy(): void {
    this.root.remove();
  }
}
