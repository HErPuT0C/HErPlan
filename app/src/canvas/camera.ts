// The view onto a graph: screen = world × scale + (x, y). Pure functions; the engine owns the current value.

import type { Bounds, Rect } from './model';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 2.5;
export const ZOOM_STEP = 1.2;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - c.x) / c.scale, y: (sy - c.y) / c.scale };
}

export function toScreen(c: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * c.scale + c.x, y: wy * c.scale + c.y };
}

/** Zoom keeping the world point under (sx, sy) in place: zoom to the cursor (FR-CNV-01). */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera {
  const scale = clampScale(c.scale * factor);
  const w = toWorld(c, sx, sy);
  return { scale, x: sx - w.x * scale, y: sy - w.y * scale };
}

export function setScaleAt(c: Camera, sx: number, sy: number, scale: number): Camera {
  return zoomAt(c, sx, sy, scale / c.scale);
}

export function visibleBounds(c: Camera, width: number, height: number, margin = 0): Bounds {
  const a = toWorld(c, -margin, -margin);
  const b = toWorld(c, width + margin, height + margin);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Camera showing `b` whole and centred; never zooms in past `maxScale` (a single node is not blown up). */
export function fitBounds(b: Bounds, width: number, height: number, padding = 48, maxScale = 1): Camera {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const scale = clampScale(Math.min((width - padding * 2) / bw, (height - padding * 2) / bh, maxScale));
  return {
    scale,
    x: width / 2 - ((b.minX + b.maxX) / 2) * scale,
    y: height / 2 - ((b.minY + b.maxY) / 2) * scale,
  };
}

/** Smallest pan that brings `r` into view with a margin; the scale stays. */
export function panToShow(c: Camera, r: Rect, width: number, height: number, margin = 40): Camera {
  const s = toScreen(c, r.x, r.y);
  const w = r.w * c.scale;
  const h = r.h * c.scale;
  let dx = 0;
  let dy = 0;
  if (s.x < margin) dx = margin - s.x;
  else if (s.x + w > width - margin) dx = Math.max(margin - s.x, width - margin - (s.x + w));
  if (s.y < margin) dy = margin - s.y;
  else if (s.y + h > height - margin) dy = Math.max(margin - s.y, height - margin - (s.y + h));
  return { ...c, x: c.x + dx, y: c.y + dy };
}

/** Level of detail. Near: DOM nodes with real text and inputs (ADR-002); mid and far: drawn by WebGL. */
export type Lod = 'near' | 'mid' | 'far';

export const NEAR_ENTER = 0.62;
export const NEAR_LEAVE = 0.55;
export const FAR_BELOW = 0.22;

/** With hysteresis around the near threshold, so nodes do not flicker while zooming at the border. */
export function lodFor(scale: number, previous: Lod, farBelow = FAR_BELOW): Lod {
  if (scale < farBelow) return 'far';
  if (previous === 'near') return scale < NEAR_LEAVE ? 'mid' : 'near';
  return scale >= NEAR_ENTER ? 'near' : 'mid';
}
