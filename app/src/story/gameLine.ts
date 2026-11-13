// How the game shows a line (0.8.1, "Редактор реплик" 7.1 and 7.4), so the preview matches it: what each
// letter looks like (the line's style, then the marks over it, outer before inner), and when it appears —
// letter by letter, by syllables, by words or at once, with pauses after punctuation and at pause cues. The
// numbers come from preview of data/dialogue_palette.json; without it, the game's numbers as of 11.11.2026.
// Pure: the preview asks what is out at a moment t (seconds from the start of the line).

import { cueAt, resolveRange } from './marks';
import { toward, type CueProps, type TextMark } from './model';
import { DEFAULT_TEXT, type LetterLook, type PalettePreview } from './palette';
import { textPieces } from './textEffects';

export type Reveal = 'letter' | 'syllable' | 'word' | 'instant';
const REVEALS: readonly string[] = ['letter', 'syllable', 'word', 'instant'];

export interface LetterProps {
  col: string;
  size: 1 | 2;
  bold: boolean;
  fx: string[];
  cps: number;
  speed: number;
  reveal: Reveal;
  shake: number;
  voice_pitch: number;
  voice_gain: number;
  face: string | null;
}

export interface Letter {
  /** Its place in the text (UTF-16, like the marks). */
  at: number;
  ch: string;
  /** Its number among the letters of the line (for effects). */
  i: number;
  props: LetterProps;
  /** Seconds from the start of the line when it appears; Infinity for what the player never sees. */
  appear: number;
}

/** A piece that appears at once: a letter, a syllable or a word. */
export interface Chunk {
  /** Letters [from, to). */
  from: number;
  to: number;
  time: number;
  /** One letter's time of it. */
  step: number;
  /** The piece's own screen shake (a style's "shake"). */
  shake: number;
}

export interface CueTime {
  at: number;
  time: number;
  props: CueProps;
}

export interface GameLine {
  letters: Letter[];
  chunks: Chunk[];
  cues: CueTime[];
  /** The last letter's time plus its step. */
  end: number;
}

const base = (p: PalettePreview | null): LetterProps => ({
  col: p?.text.color ?? DEFAULT_TEXT.color,
  size: 1,
  bold: false,
  fx: [],
  cps: p?.text.cps ?? DEFAULT_TEXT.cps,
  speed: 1,
  reveal: 'letter',
  shake: 0,
  voice_pitch: 1,
  voice_gain: 1,
  face: null,
});

/**
 * Lays what a style or a mark says over the letter's props: only what it has; "fx" replaces the list (7.1).
 * (0.8.2 had effects add up; the owner took it back in 0.8.4: a letter has one style.)
 */
export function applyLook(p: LetterProps, look: LetterLook | undefined): LetterProps {
  if (!look) return p;
  const out = { ...p };
  if (look.col) out.col = look.col;
  if (typeof look.size === 'number') out.size = look.size >= 2 ? 2 : 1;
  if (typeof look.bold === 'boolean') out.bold = look.bold;
  if (look.fx) out.fx = [...look.fx];
  if (typeof look.cps === 'number') out.cps = look.cps;
  if (typeof look.speed === 'number' && look.speed > 0) out.speed = look.speed;
  if (look.reveal && REVEALS.includes(look.reveal)) out.reveal = look.reveal as Reveal;
  if (typeof look.shake === 'number') out.shake = look.shake;
  if (typeof look.voice_pitch === 'number') out.voice_pitch = look.voice_pitch;
  if (typeof look.voice_gain === 'number') out.voice_gain = look.voice_gain;
  if (look.face) out.face = look.face;
  return out;
}

const SIZES: Record<string, 1 | 2> = { small: 1, normal: 1, big: 2 };

/** A mark's own props in the game's terms. */
function markLook(m: Extract<TextMark, { device: 'style' }>): LetterLook {
  const p = m.props;
  const out: LetterLook = {};
  if (p.color) out.col = p.color;
  if (p.size && p.size in SIZES) out.size = SIZES[p.size];
  if (typeof p.bold === 'boolean') out.bold = p.bold;
  if (p.effect) out.fx = [p.effect];
  if (typeof p.speed === 'number') out.speed = p.speed;
  if (p.reveal) out.reveal = p.reveal;
  return out;
}

const VOWELS = /[аеёиоуыэюяaeiouy]/i;
const SIGNS = /[ьъ]/i;
const SPACE = /\s/;
const STOPS = '.!?…';
const COMMAS = ',;:—–';

/**
 * Syllables of one word (7.4): up to a vowel, the vowel included; between two vowels with two consonants or
 * more, the first (with "ь" or "ъ" after it) stays in this syllable; after the last vowel, the rest of the word.
 * Returns how many letters each syllable ends after.
 */
function syllableBreaks(chars: readonly string[]): number[] {
  const vowels = chars.flatMap((c, i) => (VOWELS.test(c) ? [i] : []));
  if (vowels.length < 2) return [chars.length];
  const ends: number[] = [];
  for (let k = 0; k < vowels.length - 1; k++) {
    const v = vowels[k];
    const between = chars.slice(v + 1, vowels[k + 1]).filter((c) => !SIGNS.test(c)).length;
    let end = v + 1;
    if (between >= 2) {
      end++;
      while (end < vowels[k + 1] && SIGNS.test(chars[end])) end++;
    }
    ends.push(end);
  }
  ends.push(chars.length);
  return ends;
}

/** The syllables of a word, as text. */
export function syllables(word: string): string[] {
  const chars = [...word];
  let from = 0;
  return syllableBreaks(chars).map((end) => {
    const part = chars.slice(from, end).join('');
    from = end;
    return part;
  });
}

export function gameLine(
  text: string,
  lineStyle: string | undefined,
  marks: readonly TextMark[],
  preview: PalettePreview | null,
): GameLine {
  const t0 = preview?.text ?? DEFAULT_TEXT;
  const hidden = textPieces(text)
    .effects.filter((e) => e.braced)
    .map((e) => ({ start: e.start, end: e.end }));
  const styles = marks
    .flatMap((m, order) => {
      if (m.device !== 'style') return [];
      const r = resolveRange(text, m.range);
      return r ? [{ ...r, m, order }] : [];
    })
    // Outer before inner: a mark inside another is laid over it.
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.order - b.order);
  const start = base(preview);

  const letters: Letter[] = [];
  let i = 0;
  for (const ch of text) {
    const at = letters.length ? letters[letters.length - 1].at + letters[letters.length - 1].ch.length : 0;
    // One style for a letter (0.8.4, the owner's rule): the innermost mark's style over it, else the line's;
    // the marks' own props (colour, bold, size, effect, speed, appearance) are laid over it, outer to inner.
    const over = styles.filter((s) => s.start <= at && at < s.end);
    const styled = [...over].reverse().find((s) => s.m.props.style)?.m.props.style ?? lineStyle;
    let props = applyLook(start, styled ? preview?.styles[styled] : undefined);
    for (const s of over) props = applyLook(props, markLook(s.m));
    const isHidden = hidden.some((h) => h.start <= at && at < h.end);
    letters.push({ at, ch, i: isHidden ? -1 : i, props, appear: Infinity });
    if (!isHidden) i++;
  }
  const visible = letters.filter((l) => l.i >= 0);

  const cueList = marks
    .flatMap((m) => (m.device === 'cue' ? [{ at: cueAt(text, m), props: m.props }] : []))
    .sort((a, b) => a.at - b.at);
  const cues: CueTime[] = [];
  const chunks: Chunk[] = [];
  let t = 0;
  let next = 0;
  const fire = (upto: number) => {
    for (; next < cueList.length && cueList[next].at <= upto; next++) {
      cues.push({ at: cueList[next].at, time: t, props: cueList[next].props });
      const pause = cueList[next].props.pause;
      if (typeof pause === 'number' && pause > 0) t += pause;
    }
  };
  /** Where a word that starts at visible letter `k` ends (its spaces included). */
  const wordEnd = (k: number) => {
    let j = k;
    while (j < visible.length && !SPACE.test(visible[j].ch)) j++;
    while (j < visible.length && SPACE.test(visible[j].ch)) j++;
    return Math.max(j, k + 1);
  };
  /** Where the syllable of each visible letter ends; the spaces after a word go with its last syllable. */
  const sylEnd: number[] = [];
  for (let k = 0; k < visible.length;) {
    let core = k;
    while (core < visible.length && !SPACE.test(visible[core].ch)) core++;
    const we = wordEnd(k);
    let from = k;
    const breaks = core > k ? syllableBreaks(visible.slice(k, core).map((l) => l.ch)) : [0];
    breaks.forEach((n, idx) => {
      const end = idx === breaks.length - 1 ? we : k + n;
      for (let x = from; x < end; x++) sylEnd[x] = end;
      from = end;
    });
    k = we;
  }

  let k = 0;
  let lastStep = 0;
  let lastAppear = 0;
  while (k < visible.length) {
    fire(visible[k].at);
    const p = visible[k].props;
    let j: number;
    if (p.reveal === 'instant') {
      j = k + 1;
      while (j < visible.length && visible[j].props.reveal === 'instant') j++;
    } else if (p.reveal === 'word') {
      j = wordEnd(k);
    } else if (p.reveal === 'syllable') {
      j = sylEnd[k];
    } else {
      j = k + 1;
    }
    // A chunk does not run past a cue (it happens where it stands) or into letters shown another way.
    let cut = k + 1;
    while (cut < j && !cueList.some((c) => c.at === visible[cut].at) && visible[cut].props.reveal === p.reveal) cut++;
    j = cut;

    const step = 1 / Math.max(1, p.cps * p.speed);
    for (let x = k; x < j; x++) letters[letters.indexOf(visible[x])].appear = t;
    chunks.push({ from: k, to: j, time: t, step, shake: p.shake });
    lastAppear = t;
    lastStep = step;
    const count = p.reveal === 'letter' ? 1 : visible.slice(k, j).filter((l) => !SPACE.test(l.ch)).length || 1;
    let dt = p.reveal === 'instant' ? 0 : count * step;
    if (j < visible.length) {
      // The last sign of the chunk (spaces aside), and what follows it in the text.
      let last = j - 1;
      while (last > k && SPACE.test(visible[last].ch)) last--;
      const c = visible[last].ch;
      const after = text[visible[last].at + c.length];
      if (STOPS.includes(c) && (after === undefined || SPACE.test(after))) dt += t0.pause_stop / p.speed;
      else if (COMMAS.includes(c)) dt += t0.pause_comma / p.speed;
    }
    t += dt;
    k = j;
  }
  // Pauses at the very end of the line hold it longer.
  const beforeTail = t;
  fire(Infinity);
  const tail = t - beforeTail;
  // The end (7.4): the last letter's time plus its step — not the whole time of a word shown at once.
  return { letters, chunks, cues, end: visible.length ? lastAppear + lastStep + tail : t };
}

/** What is out at a moment: the letters that appeared, the cues that happened. */
export function shownAt(line: GameLine, t: number): { letters: Letter[]; cues: CueTime[]; done: boolean } {
  return {
    letters: line.letters.filter((l) => l.appear <= t),
    cues: line.cues.filter((c) => c.time <= t),
    done: t >= line.end,
  };
}

/**
 * The speaker's face at a moment (7.9): the line's own (else "neutral"); a face cue changes it for the rest of
 * the line; while a piece with a style that has a face is being typed, that face.
 */
export function faceAt(line: GameLine, lineFace: string | undefined, t: number): string {
  let face = lineFace || 'neutral';
  for (const c of line.cues) {
    const f = toward(c.props.face);
    if (c.time <= t && f && !f.to) face = f.id;
  }
  const typing = line.chunks.find((c, n) => c.time <= t && t < (line.chunks[n + 1]?.time ?? line.end));
  const styleFace = typing && t < line.end ? line.letters.find((l) => l.i === typing.from)?.props.face : null;
  return styleFace || face;
}
