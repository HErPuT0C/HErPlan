import type { Graph } from './graph';
import type { Viewport } from './viewport';

export interface RenderStats {
  nodes: number;
  edges: number;
  lod: 'far' | 'mid' | 'near';
}

export interface Renderer {
  readonly name: string;
  mount(host: HTMLElement): void;
  setGraph(graph: Graph): void;
  resize(width: number, height: number): void;
  render(v: Viewport): RenderStats;
  hitTest(sx: number, sy: number, v: Viewport): number;
  nodeMoved(index: number): void;
  destroy(): void;
}

// Level of detail thresholds shared by both renderers so the comparison is fair.
export function lodFor(scale: number): RenderStats['lod'] {
  if (scale < 0.22) return 'far';
  if (scale < 0.55) return 'mid';
  return 'near';
}
