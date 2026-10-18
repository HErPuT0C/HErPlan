import type { Graph } from './graph';
import type { Renderer, RenderStats } from './renderer';
import type { Viewport } from './viewport';

export interface PhaseResult {
  name: string;
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  maxFrameMs: number;
  avgDrawMs: number;
  p95DrawMs: number;
  maxVisibleNodes: number;
}

export interface BenchResult {
  renderer: string;
  nodes: number;
  edges: number;
  viewport: string;
  dpr: number;
  phases: PhaseResult[];
  overall: PhaseResult;
}

interface Phase {
  name: string;
  seconds: number;
  // Returns world-centre and scale for progress p in [0, 1].
  at(p: number): { cx: number; cy: number; scale: number };
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function summarise(name: string, frameMs: number[], drawMs: number[], maxVisible: number): PhaseResult {
  const avgFrame = frameMs.reduce((s, x) => s + x, 0) / Math.max(1, frameMs.length);
  return {
    name,
    frames: frameMs.length,
    avgFps: Math.round((1000 / Math.max(0.001, avgFrame)) * 10) / 10,
    p95FrameMs: Math.round(percentile(frameMs, 0.95) * 10) / 10,
    maxFrameMs: Math.round(Math.max(0, ...frameMs) * 10) / 10,
    avgDrawMs: Math.round((drawMs.reduce((s, x) => s + x, 0) / Math.max(1, drawMs.length)) * 100) / 100,
    p95DrawMs: Math.round(percentile(drawMs, 0.95) * 100) / 100,
    maxVisibleNodes: maxVisible,
  };
}

function phasesFor(graph: Graph, width: number, height: number): Phase[] {
  const b = graph.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const fit = Math.min((width - 80) / (b.maxX - b.minX), (height - 80) / (b.maxY - b.minY));
  const lerp = (a: number, z: number, p: number) => a + (z - a) * p;
  const logLerp = (a: number, z: number, p: number) => Math.exp(lerp(Math.log(a), Math.log(z), p));
  const spanX = Math.min(6000, (b.maxX - b.minX) * 0.6);
  const spanY = Math.min(3000, (b.maxY - b.minY) * 0.6);
  return [
    { name: 'Близко: панорама (100 %)', seconds: 4, at: (p) => ({ cx: cx - spanX / 2 + spanX * p * 0.5, cy, scale: 1 }) },
    {
      name: 'Отдаление до всего графа и обратно',
      seconds: 4,
      at: (p) => ({ cx, cy, scale: p < 0.5 ? logLerp(1, fit, p * 2) : logLerp(fit, 0.3, (p - 0.5) * 2) }),
    },
    {
      name: 'Средний масштаб: панорама (35 %)',
      seconds: 4,
      at: (p) => ({ cx: cx - spanX / 2 + spanX * p, cy: cy - spanY / 2 + spanY * p, scale: 0.35 }),
    },
    { name: 'Весь граф на экране', seconds: 3, at: (p) => ({ cx: cx + (p - 0.5) * 200 / fit, cy, scale: fit }) },
  ];
}

export function runBenchmark(
  renderer: Renderer,
  graph: Graph,
  viewport: Viewport,
  size: { width: number; height: number },
  onFrame?: (stats: RenderStats, phase: string) => void,
): Promise<BenchResult> {
  const phases = phasesFor(graph, size.width, size.height);
  const results: PhaseResult[] = [];
  const allFrame: number[] = [];
  const allDraw: number[] = [];
  let maxVisibleAll = 0;

  return new Promise((resolve) => {
    let phaseIndex = 0;
    let phaseStart = 0;
    let last = 0;
    let frameMs: number[] = [];
    let drawMs: number[] = [];
    let maxVisible = 0;

    const step = (now: number) => {
      if (!phaseStart) {
        phaseStart = now;
        last = now;
      }
      const phase = phases[phaseIndex];
      const p = Math.min(1, (now - phaseStart) / (phase.seconds * 1000));
      const { cx, cy, scale } = phase.at(p);
      viewport.scale = scale;
      viewport.tx = size.width / 2 - cx * scale;
      viewport.ty = size.height / 2 - cy * scale;
      const t0 = performance.now();
      const stats = renderer.render(viewport);
      drawMs.push(performance.now() - t0);
      if (now !== last) frameMs.push(now - last);
      last = now;
      maxVisible = Math.max(maxVisible, stats.nodes);
      onFrame?.(stats, phase.name);

      if (p >= 1) {
        results.push(summarise(phase.name, frameMs, drawMs, maxVisible));
        allFrame.push(...frameMs);
        allDraw.push(...drawMs);
        maxVisibleAll = Math.max(maxVisibleAll, maxVisible);
        frameMs = [];
        drawMs = [];
        maxVisible = 0;
        phaseIndex++;
        phaseStart = 0;
        if (phaseIndex >= phases.length) {
          resolve({
            renderer: renderer.name,
            nodes: graph.nodes.length,
            edges: graph.edgeFrom.length,
            viewport: `${size.width}×${size.height}`,
            dpr: window.devicePixelRatio || 1,
            phases: results,
            overall: summarise('Итого', allFrame, allDraw, maxVisibleAll),
          });
          return;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
