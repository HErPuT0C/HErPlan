// Outlines of the figures of diagrams (0.9) up close, in SVG; from afar the box shader draws the same shapes
// (shaders.ts, BOX_FS): keep the two in step.

import type { NodeShape } from './kinds';

/** How far the top edge of a parallelogram is shifted right of its bottom edge. */
export function paraOffset(w: number, h: number): number {
  return Math.min(0.4 * h, 0.3 * w);
}

/** Corner radius of a figure's box (world units): a box has slightly rounded corners, a rounded box round ones. */
export const SHAPE_RADIUS: Record<NodeShape, number> = { rect: 3, round: 18, ellipse: 0, diamond: 0, para: 0, none: 6 };

/** The outline of a figure in a w × h box, as SVG path data. */
export function shapePath(shape: NodeShape, w: number, h: number): string {
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (shape) {
    case 'ellipse':
      return `M0 ${r(h / 2)}A${r(w / 2)} ${r(h / 2)} 0 1 0 ${r(w)} ${r(h / 2)}A${r(w / 2)} ${r(h / 2)} 0 1 0 0 ${r(h / 2)}Z`;
    case 'diamond':
      return `M${r(w / 2)} 0L${r(w)} ${r(h / 2)}L${r(w / 2)} ${r(h)}L0 ${r(h / 2)}Z`;
    case 'para': {
      const o = r(paraOffset(w, h));
      return `M${o} 0L${r(w)} 0L${r(w - o)} ${r(h)}L0 ${r(h)}Z`;
    }
    default: {
      const k = Math.min(SHAPE_RADIUS[shape], w / 2, h / 2);
      return (
        `M${r(k)} 0H${r(w - k)}Q${r(w)} 0 ${r(w)} ${r(k)}V${r(h - k)}Q${r(w)} ${r(h)} ${r(w - k)} ${r(h)}` +
        `H${r(k)}Q0 ${r(h)} 0 ${r(h - k)}V${r(k)}Q0 0 ${r(k)} 0Z`
      );
    }
  }
}
