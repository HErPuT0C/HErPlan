// Synthetic story-like graph for renderer benchmarks: layered columns, 1–2 outgoing edges per node.

export const NODE_W = 220;
export const HEADER_H = 26;

export interface NodeKind {
  name: string;
  color: string;
}

export const KINDS: NodeKind[] = [
  { name: 'Сцена', color: '#2f6fd6' },
  { name: 'Диалог', color: '#13866f' },
  { name: 'Выбор', color: '#c2611a' },
  { name: 'Условие', color: '#7a4fd0' },
  { name: 'Эффект', color: '#a8327a' },
  { name: 'Заметка', color: '#5b6474' },
];

export interface GraphNode {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: number;
  title: string;
  line1: string;
  line2: string;
}

export interface Graph {
  nodes: GraphNode[];
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PHRASES = [
  'Герой входит в разрушенную деревню.',
  'Старейшина просит вернуть реликвию.',
  'Если доверие выше трёх — союз.',
  'Отряд замечает дым на горизонте.',
  'Выбор определит судьбу рыцаря.',
  'Ружьё на стене ещё выстрелит.',
  'Тропа уходит в шепчущий лес.',
  'Награда: клинок и +1 к вере.',
];

export function generateGraph(nodeCount: number, edgeTarget: number, seed = 42): Graph {
  const rnd = mulberry32(seed);
  const perColumn = Math.max(8, Math.round(Math.sqrt(nodeCount / 2)));
  const columns = Math.ceil(nodeCount / perColumn);
  const colGap = 340;
  const rowGap = 170;
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    const kind = Math.floor(rnd() * KINDS.length);
    nodes.push({
      x: col * colGap + (rnd() - 0.5) * 40,
      y: row * rowGap + (rnd() - 0.5) * 50,
      w: NODE_W,
      h: 96 + Math.floor(rnd() * 3) * 16,
      kind,
      title: `${KINDS[kind].name} ${i + 1}`,
      line1: PHRASES[Math.floor(rnd() * PHRASES.length)],
      line2: PHRASES[Math.floor(rnd() * PHRASES.length)],
    });
  }

  const from: number[] = [];
  const to: number[] = [];
  const seen = new Set<number>();
  const addEdge = (a: number, b: number) => {
    const key = a * nodeCount + b;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    from.push(a);
    to.push(b);
  };
  // Every node except the last column links forward once; extra edges are random forward links.
  for (let i = 0; i < nodeCount; i++) {
    const col = Math.floor(i / perColumn);
    if (col >= columns - 1) continue;
    const target = Math.min(nodeCount - 1, (col + 1) * perColumn + Math.floor(rnd() * perColumn));
    addEdge(i, target);
  }
  let guard = 0;
  while (from.length < edgeTarget && guard++ < edgeTarget * 10) {
    const a = Math.floor(rnd() * nodeCount);
    const col = Math.floor(a / perColumn);
    if (col >= columns - 1) continue;
    const span = 1 + Math.floor(rnd() * 2);
    const targetCol = Math.min(columns - 1, col + span);
    const b = Math.min(nodeCount - 1, targetCol * perColumn + Math.floor(rnd() * perColumn));
    addEdge(a, b);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return {
    nodes,
    edgeFrom: Uint32Array.from(from),
    edgeTo: Uint32Array.from(to),
    bounds: { minX, minY, maxX, maxY },
  };
}

// Uniform grid index used for viewport culling.
export class SpatialGrid {
  private cells = new Map<number, number[]>();
  constructor(private graph: Graph, private cellSize = 600) {
    this.rebuild();
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  rebuild(): void {
    this.cells.clear();
    this.graph.nodes.forEach((n, i) => {
      const x0 = Math.floor(n.x / this.cellSize), x1 = Math.floor((n.x + n.w) / this.cellSize);
      const y0 = Math.floor(n.y / this.cellSize), y1 = Math.floor((n.y + n.h) / this.cellSize);
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = this.key(cx, cy);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
    });
  }

  query(minX: number, minY: number, maxX: number, maxY: number, out: Set<number>): void {
    out.clear();
    const x0 = Math.floor(minX / this.cellSize), x1 = Math.floor(maxX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize), y1 = Math.floor(maxY / this.cellSize);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const i of list) out.add(i);
      }
  }
}
