import { DomRenderer } from './dom';
import type { Graph } from './graph';
import { lodFor, type Renderer, type RenderStats } from './renderer';
import type { Viewport } from './viewport';
import { WebGLRenderer } from './webgl';

// Candidate architecture for the product: edges and the far-zoom overview on the GPU (WebGL),
// nodes as real DOM elements (text, inputs, selection, accessibility) mounted only near the viewport.
export class HybridRenderer implements Renderer {
  readonly name = 'Гибрид (WebGL + DOM)';
  private gpu = new WebGLRenderer({ drawNodesUpClose: false });
  private dom = new DomRenderer(true, { drawEdges: false });

  mount(host: HTMLElement): void {
    this.gpu.mount(host);
    this.dom.mount(host);
    this.dom.setTransparent(true);
  }

  setGraph(graph: Graph): void {
    this.gpu.setGraph(graph);
    this.dom.setGraph(graph);
  }

  resize(width: number, height: number): void {
    this.gpu.resize(width, height);
    this.dom.resize(width, height);
  }

  render(v: Viewport): RenderStats {
    const g = this.gpu.render(v);
    // Far away the GPU draws the nodes; DOM nodes appear from the middle zoom level on.
    if (lodFor(v.scale) === 'far') {
      this.dom.unmountAll();
      return g;
    }
    const d = this.dom.render(v);
    return { nodes: d.nodes, edges: g.edges, lod: d.lod };
  }

  hitTest(sx: number, sy: number, v: Viewport): number {
    return this.gpu.hitTest(sx, sy, v);
  }

  nodeMoved(index: number): void {
    this.gpu.nodeMoved();
    this.dom.nodeMoved(index);
  }

  destroy(): void {
    this.gpu.destroy();
    this.dom.destroy();
  }
}
