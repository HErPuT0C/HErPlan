// Synthetic story-like graph and a scripted camera path for the canvas benchmark (F2-14, NFR-03).

import type { Camera } from './camera';
import { fitBounds } from './camera';
import { boundsOf, emptyGraph, type GraphDoc } from './model';

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

const COLORS = ['slate', 'blue', 'teal', 'orange', 'violet', 'pink', null];
const PHRASES = [
  'Герой входит в разрушенную деревню.',
  'Старейшина просит вернуть реликвию.',
  'Если доверие выше трёх — союз.',
  'Отряд замечает дым на горизонте.',
  'Выбор определит судьбу рыцаря.',
  'Ружьё на стене ещё выстрелит.',
];

/** Columns of nodes with forward links: `nodes` nodes and about `edges` connections. */
export function benchGraph(nodes: number, edges: number, seed = 42): GraphDoc {
  const rnd = mulberry32(seed);
  const g = emptyGraph('bench', 'freeform', 'Benchmark');
  const perColumn = Math.max(8, Math.round(Math.sqrt(nodes / 2)));
  const columns = Math.ceil(nodes / perColumn);
  for (let i = 0; i < nodes; i++) {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    g.nodes.push({
      id: `n${i}`,
      kind: 'node',
      title: `Сцена ${i + 1}`,
      x: col * 360 + Math.round((rnd() - 0.5) * 40),
      y: row * 180 + Math.round((rnd() - 0.5) * 40),
      w: 240,
      h: 120,
      text: PHRASES[Math.floor(rnd() * PHRASES.length)],
      color: COLORS[Math.floor(rnd() * COLORS.length)],
    });
  }
  const seen = new Set<string>();
  const link = (a: number, b: number) => {
    const key = `${a}>${b}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    g.edges.push({ id: `e${g.edges.length}`, from: { node: `n${a}`, port: 'out' }, to: { node: `n${b}`, port: 'in' } });
  };
  for (let i = 0; i < nodes; i++) {
    const col = Math.floor(i / perColumn);
    if (col < columns - 1) link(i, Math.min(nodes - 1, (col + 1) * perColumn + Math.floor(rnd() * perColumn)));
  }
  let guard = 0;
  while (g.edges.length < edges && guard++ < edges * 10) {
    const a = Math.floor(rnd() * nodes);
    const col = Math.floor(a / perColumn);
    if (col >= columns - 1) continue;
    const target = Math.min(columns - 1, col + 1 + Math.floor(rnd() * 2));
    link(a, Math.min(nodes - 1, target * perColumn + Math.floor(rnd() * perColumn)));
  }
  return g;
}

export interface BenchPhase {
  id: 'near' | 'zoom' | 'mid' | 'whole';
  seconds: number;
  /** Camera at time t (0..1) of the phase. */
  camera: (t: number) => Camera;
}

/** Four phases like the prototype benchmark (ADR-002), so numbers stay comparable. */
export function benchPhases(g: GraphDoc, width: number, height: number): BenchPhase[] {
  const b = boundsOf(g.nodes)!;
  const whole = fitBounds(b, width, height, 24, 1);
  const start = { x: 40 - b.minX, y: 40 - b.minY };
  return [
    { id: 'near', seconds: 3, camera: (t) => ({ scale: 1, x: start.x - t * 1800, y: start.y - t * 400 }) },
    {
      id: 'zoom',
      seconds: 4,
      camera: (t) => {
        // 1 → whole graph → 1, geometric so every scale gets equal time.
        const k = t < 0.5 ? t * 2 : (1 - t) * 2;
        const scale = whole.scale ** k;
        const cx = width / 2;
        const cy = height / 2;
        const wx = (cx - start.x) * (1 - k) + ((cx - whole.x) / whole.scale) * k;
        const wy = (cy - start.y) * (1 - k) + ((cy - whole.y) / whole.scale) * k;
        return { scale, x: cx - wx * scale, y: cy - wy * scale };
      },
    },
    {
      id: 'mid',
      seconds: 3,
      camera: (t) => ({ scale: 0.35, x: start.x * 0.35 - t * 2400, y: start.y * 0.35 - t * 600 }),
    },
    {
      id: 'whole',
      seconds: 3,
      camera: (t) => ({
        ...whole,
        x: whole.x + Math.sin(t * Math.PI * 4) * 30,
        y: whole.y + Math.cos(t * Math.PI * 4) * 20,
      }),
    },
  ];
}

export interface PhaseResult {
  id: BenchPhase['id'];
  fps: number;
  p95: number;
  max: number;
}

/** Frame statistics from frame timestamps (ms). */
export function frameStats(times: number[]): { fps: number; p95: number; max: number } {
  if (times.length < 2) return { fps: 0, p95: 0, max: 0 };
  const deltas = times.slice(1).map((t, i) => t - times[i]);
  const sorted = [...deltas].sort((a, b) => a - b);
  const total = times[times.length - 1] - times[0];
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    fps: round((deltas.length / total) * 1000),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    max: round(sorted[sorted.length - 1]),
  };
}
