// Drawing a drawing (0.9): the colour under it, the picture it lies on, then its shapes on a layer of their
// own — so the eraser takes away what was drawn, never the picture under it. The same code draws the window
// while drawing, the cards of the map and the PNG that is saved.

import { withDrawing } from './png';
import {
  FILL_ALPHA,
  MARKER_ALPHA,
  normBox,
  strokeWidth,
  type DrawItem,
  type Drawing,
  type StrokeItem,
  type TextItem,
  type TextLook,
} from './model';
import { canvasMeasure, fontCss, layoutText, outlineWidth } from './text';

function strokePath(ctx: CanvasRenderingContext2D, p: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) {
    // A dot: a tiny segment, drawn with round caps.
    ctx.lineTo(p[0] + 0.01, p[1]);
    return;
  }
  // Through the middles of the segments: a smooth line through few points.
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
}

function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeItem): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth(s);
  if (s.mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
  } else {
    ctx.strokeStyle = s.color;
    if (s.mode === 'marker') ctx.globalAlpha = MARKER_ALPHA;
  }
  strokePath(ctx, s.points);
  ctx.stroke();
  ctx.restore();
}

export function drawItem(ctx: CanvasRenderingContext2D, it: DrawItem): void {
  switch (it.kind) {
    case 'stroke':
      drawStroke(ctx, it);
      return;
    case 'line': {
      ctx.save();
      ctx.strokeStyle = it.color;
      ctx.fillStyle = it.color;
      ctx.lineWidth = it.width;
      ctx.lineCap = 'round';
      const angle = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
      const head = Math.max(10, it.width * 4);
      // The line stops at the base of the arrowhead, so a thick line does not poke through its point.
      const len = Math.hypot(it.x2 - it.x1, it.y2 - it.y1);
      const cut = it.arrow ? Math.min(len, head * 0.8) : 0;
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2 - Math.cos(angle) * cut, it.y2 - Math.sin(angle) * cut);
      ctx.stroke();
      if (it.arrow) {
        ctx.beginPath();
        ctx.moveTo(it.x2, it.y2);
        ctx.lineTo(it.x2 - head * Math.cos(angle - 0.45), it.y2 - head * Math.sin(angle - 0.45));
        ctx.lineTo(it.x2 - head * Math.cos(angle + 0.45), it.y2 - head * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    case 'rect':
    case 'ellipse': {
      const b = normBox(it);
      ctx.save();
      ctx.strokeStyle = it.color;
      ctx.fillStyle = it.color;
      ctx.lineWidth = it.width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (it.kind === 'rect') ctx.rect(b.x, b.y, b.w, b.h);
      else ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (it.fill) {
        ctx.globalAlpha = FILL_ALPHA;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'text':
      drawText(ctx, it);
      return;
  }
}

/**
 * A text (0.9.1), in passes over all of its parts so that no look covers the letters of a neighbour: plates
 * under everything, then glows, shadows, contours, and the letters on top.
 */
function drawText(ctx: CanvasRenderingContext2D, it: TextItem): void {
  ctx.save();
  const layout = layoutText(it, canvasMeasure(ctx));
  ctx.font = fontCss(it);
  ctx.textBaseline = 'alphabetic';
  // Shadow blurs are in pixels of the canvas, not of the drawing.
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  const parts = layout.lines.flatMap((line) => line.segments.map((s) => ({ ...s, base: line.base })));
  const looks = (kind: TextLook['kind']) => parts.filter((s) => s.run.look?.kind === kind);

  // Plates: one rounded box under the neighbouring parts of a line that share its colour.
  for (const line of layout.lines) {
    let from = -1;
    let to = 0;
    let color = '';
    const plate = () => {
      if (from < 0) return;
      const pad = it.size * 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(from - pad, line.top, to - from + 2 * pad, layout.lineH, it.size * 0.15);
      } else {
        ctx.rect(from - pad, line.top, to - from + 2 * pad, layout.lineH);
      }
      ctx.fill();
      from = -1;
    };
    for (const s of line.segments) {
      const c = s.run.look?.kind === 'plate' ? s.run.look.color : '';
      if (c && from >= 0 && c === color && Math.abs(s.x - to) < 0.5) {
        to = s.x + s.w;
        continue;
      }
      plate();
      if (c) {
        from = s.x;
        to = s.x + s.w;
        color = c;
      }
    }
    plate();
  }
  for (const s of looks('glow')) {
    ctx.shadowColor = s.run.look!.color;
    ctx.shadowBlur = it.size * 0.35 * k;
    ctx.fillStyle = s.run.look!.color;
    ctx.fillText(s.text, s.x, s.base);
    ctx.fillText(s.text, s.x, s.base);
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  const drop = Math.max(1, it.size * 0.06);
  for (const s of looks('shadow')) {
    ctx.fillStyle = s.run.look!.color;
    ctx.fillText(s.text, s.x + drop, s.base + drop);
  }
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  for (const s of looks('outline')) {
    ctx.strokeStyle = s.run.look!.color;
    ctx.lineWidth = 2 * outlineWidth(it.size, s.run.look!.thick);
    ctx.strokeText(s.text, s.x, s.base);
  }
  for (const s of parts) {
    ctx.fillStyle = s.run.color;
    ctx.fillText(s.text, s.x, s.base);
  }
  ctx.restore();
}

/** A canvas of a size: an offscreen one where the browser has it, else an element. */
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * Draws a drawing onto `ctx` at `scale` (screen pixels per pixel of the drawing), its top-left at (0, 0):
 * the colour under it, the picture, then the shapes (`extra`: one more, being drawn). `layer` is a canvas to
 * reuse for the shapes (made when not given).
 */
export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  background: CanvasImageSource | null,
  scale = 1,
  extra?: DrawItem | null,
  layer?: HTMLCanvasElement,
): void {
  const w = d.w * scale;
  const h = d.h * scale;
  ctx.save();
  if (d.bg) {
    ctx.fillStyle = d.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (background) ctx.drawImage(background, 0, 0, w, h);
  const shapes = layer ?? makeCanvas(w, h);
  if (shapes.width !== Math.round(w) || shapes.height !== Math.round(h)) {
    shapes.width = Math.max(1, Math.round(w));
    shapes.height = Math.max(1, Math.round(h));
  }
  const s = shapes.getContext('2d')!;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, shapes.width, shapes.height);
  s.setTransform(scale, 0, 0, scale, 0, 0);
  for (const it of d.items) drawItem(s, it);
  if (extra) drawItem(s, extra);
  ctx.drawImage(shapes, 0, 0);
  ctx.restore();
}

/** The drawing as PNG bytes that carry its source. */
export async function drawingPng(d: Drawing, background: CanvasImageSource | null): Promise<Uint8Array> {
  const canvas = makeCanvas(d.w, d.h);
  renderDrawing(canvas.getContext('2d')!, d, background);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the picture could not be made');
  return withDrawing(new Uint8Array(await blob.arrayBuffer()), d);
}

/** A picture from its bytes (a PNG, a JPEG…), ready to draw on a canvas; null when it cannot be read. */
export async function imageOf(bytes: Uint8Array, type = 'image/png'): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  } catch {
    return null;
  }
}
