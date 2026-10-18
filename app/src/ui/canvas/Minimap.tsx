import { useEffect, useRef, type PointerEvent } from 'react';
import { toWorld } from '../../canvas/camera';
import type { CanvasEngine } from '../../canvas/engine';
import { kindOf } from '../../canvas/kinds';
import { boundsOf, colorHex, type GraphDoc } from '../../canvas/model';
import type { ProjectData } from '../../core/project/types';
import type { Store } from '../../core/store';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { settings } from '../../state/settings';

const W = 200;
const H = 140;
const PAD = 8;

/**
 * Mini-map (FR-CNV-09): every node as a dot of its colour, the visible area as a frame.
 * Nodes are drawn once per graph change into a cached bitmap; moving the camera redraws only the frame.
 * Click or drag to move the view there.
 */
export function Minimap({
  engine,
  store,
  graphId,
}: {
  engine: CanvasEngine;
  store: Store<ProjectData>;
  graphId: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef<{
    graph: GraphDoc;
    accent: string;
    /** Frame colour: the accent at the time the bitmap was built. */
    frame: string;
    bitmap: HTMLCanvasElement;
    map: (x: number, y: number) => [number, number];
    unmap: (x: number, y: number) => [number, number];
    scale: number;
  } | null>(null);
  const graph = useStore(store, (s) => s.graphs[graphId] as unknown as GraphDoc | undefined);
  const view = useAtom(engine.view);
  const { accent } = useAtom(settings);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !graph) return;
    const dpr = window.devicePixelRatio || 1;
    if (!cache.current || cache.current.graph !== graph || cache.current.accent !== accent) {
      const visible = boundsOf([...graph.nodes, ...graph.groups]) ?? { minX: 0, minY: 0, maxX: 1000, maxY: 700 };
      const scale = Math.min(
        (W - PAD * 2) / Math.max(1, visible.maxX - visible.minX),
        (H - PAD * 2) / Math.max(1, visible.maxY - visible.minY),
      );
      const ox = PAD + (W - PAD * 2 - (visible.maxX - visible.minX) * scale) / 2 - visible.minX * scale;
      const oy = PAD + (H - PAD * 2 - (visible.maxY - visible.minY) * scale) / 2 - visible.minY * scale;
      const bitmap = document.createElement('canvas');
      bitmap.width = W * dpr;
      bitmap.height = H * dpr;
      const ctx = bitmap.getContext('2d')!;
      ctx.scale(dpr, dpr);
      for (const n of graph.nodes) {
        ctx.fillStyle = colorHex(n.color, kindOf(n.kind).color);
        ctx.fillRect(ox + n.x * scale, oy + n.y * scale, Math.max(1.5, n.w * scale), Math.max(1.5, n.h * scale));
      }
      cache.current = {
        graph,
        accent,
        frame: getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#34c9a5',
        bitmap,
        scale,
        map: (x, y) => [ox + x * scale, oy + y * scale],
        unmap: (x, y) => [(x - ox) / scale, (y - oy) / scale],
      };
    }
    el.width = W * dpr;
    el.height = H * dpr;
    const ctx = el.getContext('2d')!;
    ctx.drawImage(cache.current.bitmap, 0, 0);
    const a = toWorld(view.camera, 0, 0);
    const b = toWorld(view.camera, view.width, view.height);
    const [x0, y0] = cache.current.map(a.x, a.y);
    const [x1, y1] = cache.current.map(b.x, b.y);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = cache.current.frame;
    ctx.lineWidth = 1.5;
    // The view can be larger than the whole graph: keep its frame inside the mini-map.
    const left = Math.max(1, Math.round(x0)) + 0.5;
    const top = Math.max(1, Math.round(y0)) + 0.5;
    const right = Math.min(W - 1, Math.round(x1)) - 0.5;
    const bottom = Math.min(H - 1, Math.round(y1)) - 0.5;
    ctx.strokeRect(left, top, Math.max(4, right - left), Math.max(4, bottom - top));
  }, [graph, view, accent]);

  const moveTo = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = cache.current;
    if (!c) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const [wx, wy] = c.unmap(e.clientX - rect.left, e.clientY - rect.top);
    const cam = view.camera;
    engine.setCamera({ ...cam, x: view.width / 2 - wx * cam.scale, y: view.height / 2 - wy * cam.scale });
  };

  return (
    <canvas
      ref={canvas}
      className="minimap"
      style={{ width: W, height: H }}
      data-canvas-ignore
      aria-label={t('canvas.minimap')}
      role="img"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && moveTo(e)}
    />
  );
}
