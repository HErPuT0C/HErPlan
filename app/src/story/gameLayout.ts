// Where the game puts the letters of a line, how big its bubble is and when it beeps (0.8.2, "Редактор
// реплик" 7.3, 7.6 and 7.8), so the scene of the preview matches it. Pure: the width of a sign comes from
// the font (a callback), everything is in pixels of the game.

import { noise } from './gameFx';
import type { GameLine, Letter } from './gameLine';
import { DEFAULT_SHAPE, DEFAULT_TEXT, type BubbleShape, type PalettePreview, type PreviewFont } from './palette';

/** How far a sign moves the pen, in pixels of the game. */
export type Advance = (ch: string, size: 1 | 2, bold: boolean) => number;

export interface Placed {
  letter: Letter;
  /** The left of the sign and the top of its cell, from the top-left of the text. */
  x: number;
  y: number;
  row: number;
  /** A space at the start of a row is not drawn and takes no room (7.3). */
  skip: boolean;
}

export interface TextLayout {
  placed: Placed[];
  rows: { top: number; height: number; width: number }[];
  width: number;
  height: number;
}

const SPACE = /\s/;

/**
 * Lays the letters the player sees out in rows of at most `width` (7.3): a word that does not fit goes to a
 * new row whole, a row does not start with a space, a row is line_h × its biggest size tall, and letters of
 * different sizes stand on one line by the bottom of the capitals. A line break in the text starts a row.
 */
export function layoutText(
  letters: readonly Letter[],
  advance: Advance,
  font: Pick<PreviewFont, 'line_h' | 'cap_top' | 'cap_h'>,
  width: number,
): TextLayout {
  const visible = letters.filter((l) => l.i >= 0);
  const adv = (l: Letter) => advance(l.ch, l.props.size, l.props.bold);
  // First the rows: which letter is in which, and where on its row.
  const rowOf: number[] = [];
  const xOf: number[] = [];
  const skip: boolean[] = [];
  let row = 0;
  let pen = 0;
  for (let k = 0; k < visible.length;) {
    const ch = visible[k].ch;
    if (ch === '\n') {
      rowOf[k] = row;
      xOf[k] = pen;
      skip[k] = true;
      row++;
      pen = 0;
      k++;
      continue;
    }
    if (SPACE.test(ch)) {
      rowOf[k] = row;
      xOf[k] = pen;
      skip[k] = pen === 0;
      if (!skip[k]) pen += adv(visible[k]);
      k++;
      continue;
    }
    // A word: all of it on this row, or all of it on the next.
    let end = k;
    let w = 0;
    while (end < visible.length && !SPACE.test(visible[end].ch)) w += adv(visible[end++]);
    if (pen > 0 && pen + w > width) {
      // The spaces before it stay at the end of the row they were on.
      row++;
      pen = 0;
    }
    for (; k < end; k++) {
      rowOf[k] = row;
      xOf[k] = pen;
      skip[k] = false;
      pen += adv(visible[k]);
    }
  }
  const count = visible.length ? row + 1 : 0;
  const rows = Array.from({ length: count }, () => ({ top: 0, height: font.line_h, width: 0, size: 1 }));
  visible.forEach((l, k) => {
    const r = rows[rowOf[k]];
    if (skip[k]) return;
    r.size = Math.max(r.size, l.props.size);
    if (!SPACE.test(l.ch)) r.width = Math.max(r.width, xOf[k] + adv(l));
  });
  let top = 0;
  for (const r of rows) {
    r.top = top;
    r.height = font.line_h * r.size;
    top += r.height;
  }
  const capBase = font.cap_top + font.cap_h;
  const placed = visible.map((l, k) => {
    const r = rows[rowOf[k]];
    return { letter: l, x: xOf[k], y: r.top + (r.size - l.props.size) * capBase, row: rowOf[k], skip: skip[k] };
  });
  return {
    placed,
    rows: rows.map(({ top, height, width }) => ({ top, height, width })),
    width: rows.reduce((m, r) => Math.max(m, r.width), 0),
    height: top,
  };
}

/** The size of a bubble around text of a size (7.8): max(2m, min_w, text + 2·pad_x) wide. */
export function bubbleSize(
  textW: number,
  textH: number,
  shape: BubbleShape = DEFAULT_SHAPE,
  minW = 28,
): { w: number; h: number } {
  return {
    w: Math.max(2 * shape.m, minW, textW + 2 * shape.pad_x),
    h: Math.max(2 * shape.m, textH + 2 * shape.pad_y),
  };
}

export interface Blip {
  time: number;
  /** The playback rate: the speaker's voice × the letter's voice_pitch × the "melody" of the letter. */
  rate: number;
  gain: number;
}

/** Punctuation, brackets and spaces do not beep (7.6). */
const SILENT = /[\s\p{P}]/u;

/**
 * The beeps of a line (7.6): one on each piece that appears (a letter, a syllable, a word) unless it is only
 * punctuation, brackets or spaces, and not more often than blip_gap seconds. The pitch of each varies by the
 * code of its first letter, so words get a tune.
 */
export function blips(line: GameLine, preview: PalettePreview | null, voicePitch = 1): Blip[] {
  const t = preview?.text ?? DEFAULT_TEXT;
  const visible = line.letters.filter((l) => l.i >= 0);
  const out: Blip[] = [];
  let last = -Infinity;
  for (const c of line.chunks) {
    const first = visible.slice(c.from, c.to).find((l) => !SILENT.test(l.ch));
    if (!first || c.time - last < t.blip_gap - 1e-9) continue;
    last = c.time;
    const code = first.ch.codePointAt(0) ?? 0;
    out.push({
      time: c.time,
      rate: voicePitch * first.props.voice_pitch * (1 + (noise(code) - 0.5) * t.blip_spread),
      gain: first.props.voice_gain,
    });
  }
  return out;
}
