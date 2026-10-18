// Canvas quality modes (a setting). "Normal" spends more on readability: titles stay visible from
// farther away and are re-fitted every frame. "Economy" keeps the cheapest path for weak computers.

export type QualityName = 'normal' | 'economy';
export const QUALITY_NAMES: readonly QualityName[] = ['normal', 'economy'];

export interface QualityProfile {
  /** Below this scale nodes become plain boxes without headers or ports. */
  farBelow: number;
  /** Mid-zoom titles are shown from this scale up… */
  labelScale: number;
  /** …while at most this many nodes are in view. */
  labelLimit: number;
  /** A title needs at least this much width on screen (px) to be worth drawing. */
  labelMinWidth: number;
  /** Titles are re-fitted to the zoom on every frame (else at most every `nearRefreshMs`). */
  labelEveryFrame: boolean;
  /** Pixel ratio cap of the WebGL layer: 1 halves the work on high-DPI screens. */
  maxDpr: number;
  /** How often the DOM layer's node list follows a moving camera, and how far ahead it mounts nodes. */
  nearRefreshMs: number;
  nearMarginPx: number;
  /** Far away, edges stay curved while the graph has at most this many (straight lines are cheaper). */
  farCurveEdges: number;
}

export const QUALITY: Record<QualityName, QualityProfile> = {
  normal: {
    farBelow: 0.12,
    labelScale: 0.12,
    labelLimit: 1500,
    labelMinWidth: 36,
    labelEveryFrame: true,
    maxDpr: 3,
    nearRefreshMs: 60,
    nearMarginPx: 600,
    farCurveEdges: 10_000,
  },
  economy: {
    farBelow: 0.22,
    labelScale: 0.3,
    labelLimit: 300,
    labelMinWidth: 48,
    labelEveryFrame: false,
    maxDpr: 1,
    nearRefreshMs: 120,
    nearMarginPx: 400,
    farCurveEdges: 0,
  },
};
