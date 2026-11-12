// Pictures, sounds and the font the game side put into the project (data/dialogue_preview/), for the lists
// and the preview (0.8.1). Paths in the palette are from the data/ folder. Loaded once per project and path;
// a file that is missing just does not show (or sound).

import { useEffect, useMemo, useState } from 'react';
import { platform } from '../../platform';
import type { PreviewFont } from '../../story/palette';

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** A picture of the palette, loaded (null when it is missing). */
export function loadImage(dir: string, path: string): Promise<HTMLImageElement | null> {
  const key = `${dir}\n${path}`;
  let p = images.get(key);
  if (!p) {
    p = platform()
      .assetUrl(dir, `data/${path}`)
      .then(
        (url) =>
          new Promise<HTMLImageElement | null>((resolve) => {
            if (!url) return resolve(null);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
          }),
      )
      .catch(() => null);
    images.set(key, p);
  }
  return p;
}

/** Forgets loaded pictures: the game side updated its files. */
export function forgetImages(): void {
  images.clear();
}

export function useImage(dir: string | null, path: string | undefined): HTMLImageElement | null {
  const key = dir && path ? `${dir}\n${path}` : null;
  const [loaded, setLoaded] = useState<{ key: string; img: HTMLImageElement | null } | null>(null);
  useEffect(() => {
    if (!key || !dir || !path) return;
    let live = true;
    void loadImage(dir, path).then((img) => live && setLoaded({ key, img }));
    return () => {
      live = false;
    };
  }, [key, dir, path]);
  return loaded && loaded.key === key ? loaded.img : null;
}

/** Plays a sound of the palette (a voice, a cue); silent when the file is missing or sound is blocked. */
export async function playSound(dir: string, path: string | undefined, rate = 1, volume = 1): Promise<void> {
  if (!path) return;
  try {
    const url = await platform().assetUrl(dir, `data/${path}`);
    if (!url) return;
    const audio = new Audio(url);
    audio.preservesPitch = false;
    audio.playbackRate = Math.max(0.25, Math.min(4, rate));
    audio.volume = Math.max(0, Math.min(1, volume));
    await audio.play();
  } catch {
    // No sound: nothing to tell.
  }
}

// The beeps of the preview come many a second, at a pitch of their own: they are decoded once and played
// through Web Audio (a gain above 1 is heard as louder). Where that is not possible, an <audio> element.
let audioContext: AudioContext | null | undefined;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const ready = new Map<string, AudioBuffer | null>();

function context(): AudioContext | null {
  if (audioContext === undefined) {
    try {
      audioContext = typeof AudioContext === 'function' ? new AudioContext() : null;
    } catch {
      audioContext = null;
    }
  }
  return audioContext;
}

function buffer(dir: string, path: string): Promise<AudioBuffer | null> {
  const key = `${dir}\n${path}`;
  let p = buffers.get(key);
  if (!p) {
    const ctx = context();
    p = !ctx
      ? Promise.resolve(null)
      : platform()
          .assetUrl(dir, `data/${path}`)
          .then((url) => (url ? fetch(url) : null))
          .then((r) => (r && r.ok ? r.arrayBuffer() : null))
          .then((data) => (data ? ctx.decodeAudioData(data) : null))
          .catch(() => null);
    void p.then((b) => ready.set(key, b));
    buffers.set(key, p);
  }
  return p;
}

/** Loads the sounds a preview is going to play, so the first beep is not late. */
export function preloadSounds(dir: string, paths: readonly (string | undefined)[]): void {
  for (const p of paths) if (p) void buffer(dir, p);
}

/** One beep or cue sound of the preview, now: at a rate (pitch) and a gain. */
export function playNow(dir: string, path: string | undefined, rate = 1, gain = 1): void {
  if (!path) return;
  const key = `${dir}\n${path}`;
  const ctx = context();
  const b = ready.get(key);
  if (ctx && b) {
    if (ctx.state === 'suspended') void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(3, gain));
    src.connect(g).connect(ctx.destination);
    src.start();
    return;
  }
  // Not decoded (yet, or it cannot be): the plain way, and decoding for the next time.
  if (!ready.has(key)) void buffer(dir, path);
  void playSound(dir, path, rate, gain);
}

/** Forgets decoded sounds: the game side updated its files. */
export function forgetSounds(): void {
  buffers.clear();
  ready.clear();
}

// ---------- the game's font ----------

export interface GameFont {
  img: HTMLImageElement;
  font: PreviewFont;
  index: Map<string, number>;
}

export function useGameFont(dir: string | null, font: PreviewFont | null | undefined): GameFont | null {
  const img = useImage(dir, font?.image);
  return useMemo(
    () => (img && font ? { img, font, index: new Map([...font.chars].map((c, i) => [c, i])) } : null),
    [img, font],
  );
}

const tints = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();

/** A white picture (the font, the bubble) in one colour: coloured by multiplying, its own alpha kept. */
export function tint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  let byColor = tints.get(img);
  if (!byColor) tints.set(img, (byColor = new Map()));
  let c = byColor.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, 0, 0);
    byColor.set(color, c);
  }
  return c;
}

/** The atlas in one colour: it is white, and is coloured by multiplying. */
function tinted(f: GameFont, color: string): HTMLCanvasElement {
  return tint(f.img, color);
}

export interface DrawnLetter {
  ch: string;
  col: string;
  size: 1 | 2;
  bold: boolean;
  dx: number;
  dy: number;
}

/** The glyph of a sign: its place in the atlas; a sign the font has not got is drawn as "?". */
function glyph(f: GameFont, ch: string): number {
  return f.index.get(ch) ?? f.index.get('?') ?? 0;
}

/** How far a sign moves the pen (7.2): its width × size, one more pixel × size when bold. */
export function advance(f: GameFont, ch: string, size: number, bold: boolean): number {
  return f.font.ws[glyph(f, ch)] * size + (bold ? size : 0);
}

/**
 * Draws one sign at (x, y) — the top-left of its cell — in pixels of the game, `scale` screen pixels each
 * (7.2): coloured, twice as big when size is 2, a second time size pixels to the right when bold.
 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  f: GameFont,
  ch: string,
  col: string,
  size: number,
  bold: boolean,
  x: number,
  y: number,
  scale: number,
): void {
  const g = glyph(f, ch);
  const w = f.font.ws[g];
  const sx = f.font.xs[g];
  const atlas = tinted(f, col);
  const draw = (shift: number) =>
    ctx.drawImage(
      atlas,
      sx,
      0,
      w,
      f.font.cell_h,
      (x + shift) * scale,
      y * scale,
      w * size * scale,
      f.font.cell_h * size * scale,
    );
  draw(0);
  if (bold) draw(size);
}

/**
 * Draws letters on one line from (x, y) in pixels of the game, `scale` screen pixels each, the letters
 * standing on one line by the bottom of the capitals (7.3). Returns the width in pixels of the game.
 */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  f: GameFont,
  letters: readonly DrawnLetter[],
  x: number,
  y: number,
  scale: number,
): number {
  ctx.imageSmoothingEnabled = false;
  const lineSize = letters.reduce((m, l) => Math.max(m, l.size), 1);
  const capBase = f.font.cap_top + f.font.cap_h;
  let pen = x;
  for (const l of letters) {
    const down = (lineSize - l.size) * capBase;
    drawGlyph(ctx, f, l.ch, l.col, l.size, l.bold, pen + l.dx, y + l.dy + down, scale);
    pen += advance(f, l.ch, l.size, l.bold);
  }
  return pen - x;
}

/**
 * A frame of a strip drawn as nine parts (7.8): the corners m × m as they are, the edges and the middle
 * stretched to (w, h) at (x, y), in pixels of the game.
 */
export function nineSlice(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  frame: { x: number; w: number; h: number; m: number },
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  const { m } = frame;
  const sxs = [frame.x, frame.x + m, frame.x + frame.w - m];
  const sws = [m, frame.w - 2 * m, m];
  const sys = [0, m, frame.h - m];
  const shs = [m, frame.h - 2 * m, m];
  const dxs = [x, x + m, x + w - m];
  const dws = [m, w - 2 * m, m];
  const dys = [y, y + m, y + h - m];
  const dhs = [m, h - 2 * m, m];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (sws[c] <= 0 || shs[r] <= 0 || dws[c] <= 0 || dhs[r] <= 0) continue;
      ctx.drawImage(
        src,
        sxs[c],
        sys[r],
        sws[c],
        shs[r],
        dxs[c] * scale,
        dys[r] * scale,
        dws[c] * scale,
        dhs[r] * scale,
      );
    }
  }
}
