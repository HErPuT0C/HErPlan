// Screen = world * scale + (tx, ty).
export interface Viewport {
  tx: number;
  ty: number;
  scale: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 3;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): void {
  const next = clampScale(v.scale * factor);
  const wx = (sx - v.tx) / v.scale;
  const wy = (sy - v.ty) / v.scale;
  v.scale = next;
  v.tx = sx - wx * next;
  v.ty = sy - wy * next;
}

export function fitBounds(
  v: Viewport,
  b: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  padding = 40,
): void {
  const s = clampScale(Math.min((width - padding * 2) / (b.maxX - b.minX), (height - padding * 2) / (b.maxY - b.minY)));
  v.scale = s;
  v.tx = (width - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  v.ty = (height - (b.maxY - b.minY) * s) / 2 - b.minY * s;
}

export function visibleWorldRect(v: Viewport, width: number, height: number) {
  return {
    minX: -v.tx / v.scale,
    minY: -v.ty / v.scale,
    maxX: (width - v.tx) / v.scale,
    maxY: (height - v.ty) / v.scale,
  };
}
