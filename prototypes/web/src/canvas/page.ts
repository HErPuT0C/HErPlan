import { runBenchmark, type BenchResult } from './bench';
import { Canvas2DRenderer } from './canvas2d';
import { DomRenderer } from './dom';
import { HybridRenderer } from './hybrid';
import { generateGraph, type Graph } from './graph';
import type { Renderer, RenderStats } from './renderer';
import { fitBounds, zoomAt, type Viewport } from './viewport';
import { WebGLRenderer } from './webgl';

export type RendererId = 'canvas2d' | 'dom' | 'dom-cull' | 'webgl' | 'hybrid';

const RENDERERS: Record<RendererId, () => Renderer> = {
  canvas2d: () => new Canvas2DRenderer(),
  dom: () => new DomRenderer(false),
  'dom-cull': () => new DomRenderer(true),
  webgl: () => new WebGLRenderer(),
  hybrid: () => new HybridRenderer(),
};

// The full comparison for the owner's machine; plain DOM is left out (it is known to be unusable and slow to measure).
export const BENCH_ALL: RendererId[] = ['canvas2d', 'dom-cull', 'webgl', 'hybrid'];

const SIZES = [1000, 5000, 10000, 20000];

export interface CanvasPage {
  element: HTMLElement;
  // Runs the scripted benchmark for each renderer id in turn and returns all results.
  benchAll(ids: RendererId[], nodeCount: number): Promise<BenchResult[]>;
  activate(): void;
}

export function createCanvasPage(onResult: (r: BenchResult) => void): CanvasPage {
  const element = document.createElement('section');
  element.className = 'page canvas-page';
  element.innerHTML = `
    <div class="toolbar">
      <label>Отрисовка <select data-id="renderer">
        <option value="canvas2d">Canvas 2D</option>
        <option value="dom">DOM</option>
        <option value="dom-cull">DOM + отсечение</option>
        <option value="webgl">WebGL</option>
        <option value="hybrid">Гибрид (WebGL + DOM)</option>
      </select></label>
      <label>Узлов <select data-id="size">${SIZES.map((s) => `<option value="${s}" ${s === 5000 ? 'selected' : ''}>${s.toLocaleString('ru')}</option>`).join('')}</select></label>
      <button data-id="fit">Вписать (0)</button>
      <button data-id="bench-all" class="primary">Запустить все замеры (≈1 мин)</button>
      <button data-id="bench">Замер выбранного</button>
      <span class="hint">Колесо — масштаб · перетаскивание по пустому месту, средняя или правая кнопка — панорама · узел можно двигать</span>
    </div>
    <div class="stage"><div class="overlay" data-id="overlay"></div></div>`;
  const stage = element.querySelector<HTMLDivElement>('.stage')!;
  const overlay = element.querySelector<HTMLDivElement>('[data-id="overlay"]')!;
  const rendererSelect = element.querySelector<HTMLSelectElement>('[data-id="renderer"]')!;
  const sizeSelect = element.querySelector<HTMLSelectElement>('[data-id="size"]')!;
  const benchButton = element.querySelector<HTMLButtonElement>('[data-id="bench"]')!;
  const benchAllButton = element.querySelector<HTMLButtonElement>('[data-id="bench-all"]')!;

  const viewport: Viewport = { tx: 0, ty: 0, scale: 1 };
  let renderer: Renderer | null = null;
  let graph: Graph | null = null;
  let graphSize = 0;
  let dirty = true;
  let benchRunning = false;
  let lastStats: RenderStats | null = null;
  const frameTimes: number[] = [];
  let lastFrame = 0;
  let status = '';

  const size = () => ({ width: stage.clientWidth, height: stage.clientHeight });

  function ensureGraph(nodeCount: number): Graph {
    if (!graph || graphSize !== nodeCount) {
      graph = generateGraph(nodeCount, Math.round(nodeCount * 1.6));
      graphSize = nodeCount;
    }
    return graph;
  }

  function setup(id: RendererId, nodeCount: number): void {
    renderer?.destroy();
    const g = ensureGraph(nodeCount);
    renderer = RENDERERS[id]();
    renderer.mount(stage);
    stage.appendChild(overlay);
    const { width, height } = size();
    renderer.resize(width, height);
    renderer.setGraph(g);
    fitBounds(viewport, g.bounds, width, height);
    zoomAt(viewport, width / 2, height / 2, 0.6 / viewport.scale);
    dirty = true;
  }

  function updateOverlay(): void {
    const fps = frameTimes.length > 5 ? 1000 / (frameTimes.reduce((s, x) => s + x, 0) / frameTimes.length) : 0;
    overlay.textContent =
      `${renderer?.name ?? ''} · ${graphSize.toLocaleString('ru')} узлов\n` +
      `кадров/с: ${fps ? fps.toFixed(0) : '—'}\n` +
      `видно узлов: ${lastStats?.nodes ?? 0}, связей: ${lastStats?.edges ?? 0}\n` +
      `детализация: ${lastStats?.lod ?? ''}, масштаб ${(viewport.scale * 100).toFixed(0)} %` +
      (status ? `\n${status}` : '');
  }

  function loop(now: number): void {
    if (!benchRunning && dirty && renderer) {
      if (lastFrame && now - lastFrame < 250) {
        frameTimes.push(now - lastFrame);
        if (frameTimes.length > 30) frameTimes.shift();
      }
      lastFrame = now;
      lastStats = renderer.render(viewport);
      dirty = false;
      updateOverlay();
    }
    requestAnimationFrame(loop);
  }

  // Interaction.
  let drag: { mode: 'pan' | 'node'; x: number; y: number; node: number } | null = null;
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(viewport, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    dirty = true;
  }, { passive: false });
  stage.addEventListener('pointerdown', (e) => {
    if (!renderer || benchRunning) return;
    const rect = stage.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const node = e.button === 0 ? renderer.hitTest(sx, sy, viewport) : -1;
    drag = { mode: node >= 0 ? 'node' : 'pan', x: e.clientX, y: e.clientY, node };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !renderer || !graph) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.mode === 'pan') {
      viewport.tx += dx;
      viewport.ty += dy;
    } else {
      const n = graph.nodes[drag.node];
      n.x += dx / viewport.scale;
      n.y += dy / viewport.scale;
      renderer.nodeMoved(drag.node);
    }
    dirty = true;
  });
  stage.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('keydown', (e) => {
    if (e.key === '0' && element.isConnected && !benchRunning && graph) {
      const { width, height } = size();
      fitBounds(viewport, graph.bounds, width, height);
      dirty = true;
    }
  });
  new ResizeObserver(() => {
    if (!renderer) return;
    const { width, height } = size();
    renderer.resize(width, height);
    dirty = true;
  }).observe(stage);

  rendererSelect.addEventListener('change', () => setup(rendererSelect.value as RendererId, Number(sizeSelect.value)));
  sizeSelect.addEventListener('change', () => setup(rendererSelect.value as RendererId, Number(sizeSelect.value)));
  element.querySelector('[data-id="fit"]')!.addEventListener('click', () => {
    if (!graph) return;
    const { width, height } = size();
    fitBounds(viewport, graph.bounds, width, height);
    dirty = true;
  });

  async function bench(id: RendererId, nodeCount: number): Promise<BenchResult> {
    rendererSelect.value = id;
    sizeSelect.value = String(nodeCount);
    setup(id, nodeCount);
    benchRunning = true;
    benchButton.disabled = true;
    benchAllButton.disabled = true;
    // Let layout settle (DOM renderer mounts thousands of elements) before timing.
    await new Promise((r) => setTimeout(r, 500));
    const result = await runBenchmark(renderer!, graph!, viewport, size(), (stats, phase) => {
      lastStats = stats;
      status = `замер: ${phase}`;
      updateOverlay();
    });
    status = `замер готов: ${result.overall.avgFps} кадров/с в среднем`;
    benchRunning = false;
    benchButton.disabled = false;
    benchAllButton.disabled = false;
    dirty = true;
    onResult(result);
    return result;
  }

  benchButton.addEventListener('click', () => {
    void bench(rendererSelect.value as RendererId, Number(sizeSelect.value));
  });
  benchAllButton.addEventListener('click', async () => {
    for (const id of BENCH_ALL) await bench(id, Number(sizeSelect.value));
    status = 'все замеры готовы — откройте вкладку «Отчёт»';
    updateOverlay();
  });

  let started = false;
  return {
    element,
    activate() {
      if (started) return;
      started = true;
      setup('canvas2d', 5000);
      requestAnimationFrame(loop);
    },
    async benchAll(ids, nodeCount) {
      const out: BenchResult[] = [];
      for (const id of ids) out.push(await bench(id, nodeCount));
      return out;
    },
  };
}
