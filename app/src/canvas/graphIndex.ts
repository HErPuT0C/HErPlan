// Lookup structures for one version of a graph: id → index maps, edge curves, and spatial grids for
// culling and hit testing. Built once per graph change (graphs are immutable between changes).

import { curveBounds, curveDistance, edgeCurve, type Curve } from './geometry';
import { portPosition, portsOf, type PortFace, type PortSide } from './kinds';
import { boundsOf, HEADER_H, PORT_R, type Bounds, type GraphDoc, type Rect } from './model';
import { SpatialGrid } from './spatial';

export interface PortHit {
  node: string;
  port: string;
  side: PortSide;
  face: PortFace;
  x: number;
  y: number;
}

/** Key of a port in `GraphIndex.connected`. */
export const portKey = (node: string, port: string): string => `${node}\u0000${port}`;

export class GraphIndex {
  readonly nodeById = new Map<string, number>();
  readonly edgeById = new Map<string, number>();
  readonly groupById = new Map<string, number>();
  /** Edge indexes touching each node id. */
  readonly edgesOfNode = new Map<string, number[]>();
  /** Curve of each edge, or null when an end node or port is missing (a damaged or hand-edited file). */
  readonly curves: (Curve | null)[];
  /** Ports with at least one edge (portKey): side anchors are drawn only when connected or hovered. */
  readonly connected = new Set<string>();
  private nodeGrid = new SpatialGrid();
  private edgeGrid = new SpatialGrid();
  private scratch = new Set<number>();

  constructor(readonly graph: GraphDoc) {
    graph.nodes.forEach((n, i) => {
      this.nodeById.set(n.id, i);
      this.nodeGrid.insert(n, i);
    });
    graph.groups.forEach((g, i) => this.groupById.set(g.id, i));
    this.curves = graph.edges.map((e, i) => {
      this.edgeById.set(e.id, i);
      for (const id of new Set([e.from.node, e.to.node])) {
        const list = this.edgesOfNode.get(id);
        if (list) list.push(i);
        else this.edgesOfNode.set(id, [i]);
      }
      this.connected.add(portKey(e.from.node, e.from.port));
      this.connected.add(portKey(e.to.node, e.to.port));
      const a = this.node(e.from.node);
      const b = this.node(e.to.node);
      const p1 = a && portPosition(a, e.from.port);
      const p2 = b && portPosition(b, e.to.port);
      if (!p1 || !p2) return null;
      const curve = edgeCurve(p1, p2, p1.face, p2.face);
      const cb = curveBounds(curve);
      this.edgeGrid.insert({ x: cb.minX, y: cb.minY, w: cb.maxX - cb.minX, h: cb.maxY - cb.minY }, i);
      return curve;
    });
  }

  node(id: string) {
    const i = this.nodeById.get(id);
    return i === undefined ? undefined : this.graph.nodes[i];
  }

  bounds(): Bounds | null {
    return boundsOf([...this.graph.nodes, ...this.graph.groups]);
  }

  /** Nodes overlapping `b` (exact rectangle test), in drawing order. */
  nodesIn(b: Bounds): number[] {
    const out: number[] = [];
    for (const i of this.nodeGrid.query(b, this.scratch)) {
      const n = this.graph.nodes[i];
      if (n.x <= b.maxX && n.x + n.w >= b.minX && n.y <= b.maxY && n.y + n.h >= b.minY) out.push(i);
    }
    return out.sort((a, c) => a - c);
  }

  /** Nodes fully inside `b`: what a selection rectangle picks. */
  nodesInside(b: Bounds): number[] {
    return this.nodesIn(b).filter((i) => {
      const n = this.graph.nodes[i];
      return n.x >= b.minX && n.y >= b.minY && n.x + n.w <= b.maxX && n.y + n.h <= b.maxY;
    });
  }

  /** Topmost node under a world point (later nodes are drawn above earlier ones). */
  nodeAt(x: number, y: number): number {
    const hits = this.nodesIn({ minX: x, minY: y, maxX: x, maxY: y });
    return hits.length ? hits[hits.length - 1] : -1;
  }

  portAt(x: number, y: number, radius = PORT_R * 2): PortHit | null {
    let best: PortHit | null = null;
    let bestDist = radius;
    const near = { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius };
    for (const i of this.nodesIn(near)) {
      const node = this.graph.nodes[i];
      for (const port of portsOf(node)) {
        const px = node.x + port.x;
        const py = node.y + port.y;
        const d = Math.hypot(px - x, py - y);
        if (d <= bestDist) {
          bestDist = d;
          best = { node: node.id, port: port.id, side: port.side, face: port.face, x: px, y: py };
        }
      }
    }
    return best;
  }

  edgeAt(x: number, y: number, tolerance: number): number {
    const near = { minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance };
    let best = -1;
    let bestDist = tolerance;
    for (const i of this.edgeGrid.query(near, this.scratch)) {
      const curve = this.curves[i];
      if (!curve) continue;
      const d = curveDistance(curve, x, y);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** A group is grabbed by its title strip; its body lets clicks through to nodes and the background. */
  groupHeaderAt(x: number, y: number): number {
    for (let i = this.graph.groups.length - 1; i >= 0; i--) {
      const g = this.graph.groups[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + HEADER_H) return i;
    }
    return -1;
  }

  groupsIn(b: Bounds): number[] {
    const out: number[] = [];
    this.graph.groups.forEach((g: Rect, i) => {
      if (g.x <= b.maxX && g.x + g.w >= b.minX && g.y <= b.maxY && g.y + g.h >= b.minY) out.push(i);
    });
    return out;
  }
}
