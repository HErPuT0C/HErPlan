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

// ---------- the game's font ----------

export interface GameFont {
  img: HTMLImageElement;
  font: PreviewFont;
  index: Map<string, number>;
  tinted: Map<string, HTMLCanvasElement>;
}

export function useGameFont(dir: string | null, font: PreviewFont | null | undefined): GameFont | null {
  const img = useImage(dir, font?.image);
  return useMemo(
    () =>
      img && font ? { img, font, index: new Map([...font.chars].map((c, i) => [c, i])), tinted: new Map() } : null,
    [img, font],
  );
}

/** The atlas in one colour: it is white, and is coloured by multiplying. */
function tinted(f: GameFont, color: string): HTMLCanvasElement {
  let c = f.tinted.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = f.img.naturalWidth;
    c.height = f.img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(f.img, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(f.img, 0, 0);
    f.tinted.set(color, c);
  }
  return c;
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
    const g = glyph(f, l.ch);
    const w = f.font.ws[g];
    const sx = f.font.xs[g];
    const down = (lineSize - l.size) * capBase;
    const atlas = tinted(f, l.col);
    const draw = (shift: number) =>
      ctx.drawImage(
        atlas,
        sx,
        0,
        w,
        f.font.cell_h,
        (pen + l.dx + shift) * scale,
        (y + l.dy + down) * scale,
        w * l.size * scale,
        f.font.cell_h * l.size * scale,
      );
    draw(0);
    if (l.bold) draw(l.size);
    pen += advance(f, l.ch, l.size, l.bold);
  }
  return pen - x;
}
