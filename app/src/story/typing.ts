// How a line is typed out in the game, for the preview (0.8, item 19 of "Dialogues"): letter by letter at a
// base speed; marked words faster or slower ("speed"), or appearing by syllables, by words or all at once
// ("reveal"); a pause cue holds the text, the other cues happen at their place. Effects written in braces
// are never shown. Pure: the preview only asks how much of the text is out at a moment.

import { cueAt, resolveRange } from './marks';
import type { CueProps, StyleProps, TextMark } from './model';
import { textPieces } from './textEffects';

/** Letters a second at speed 1. The game may type at its own pace; this is the editor's assumption. */
export const BASE_CPS = 30;

export type Reveal = 'letter' | 'syllable' | 'word' | 'instant';
const REVEALS: readonly string[] = ['letter', 'syllable', 'word', 'instant'];

export interface TypingStep {
  /** Milliseconds from the start of the line. */
  at: number;
  /** The text up to this offset is out (UTF-16, like the marks). */
  upto: number;
  /** A cue that happens at this moment (a pause has already held the text). */
  cue?: CueProps;
}

export interface Typing {
  steps: TypingStep[];
  /** When the last letter is out. */
  total: number;
  /** Parts of the text the player never sees: effects in braces. */
  hidden: { start: number; end: number }[];
}

const VOWELS = /[аеёиоуыэюяaeiouy]/i;
const LETTER = /\p{L}/u;
const SPACE = /\s/;
/** Signs that stay with the letter before them. */
const TAIL = /[йьъ]/i;
/** Consonants that close a syllable before another consonant ("кол-ьцо" no, "коль-цо"; "по-тре", not "пот-ре"). */
const SONORANT = /[йлмнрlmnr]/i;

/**
 * Where the syllable that starts at `i` ends: consonants, a vowel, and — before two or more consonants — one
 * more when it is a sonorant (Russian syllables stay open otherwise). Rough, but enough for the preview.
 */
export function syllableEnd(text: string, i: number): number {
  let j = i;
  if (!LETTER.test(text[j] ?? '')) {
    while (j < text.length && !LETTER.test(text[j])) j++;
    return j;
  }
  while (j < text.length && LETTER.test(text[j]) && !VOWELS.test(text[j])) j++;
  if (j >= text.length || !LETTER.test(text[j])) return j;
  j++; // the vowel
  while (j < text.length && TAIL.test(text[j])) j++;
  let k = j;
  while (k < text.length && LETTER.test(text[k]) && !VOWELS.test(text[k])) k++;
  // The end of the word: the consonants are this syllable's.
  if (k >= text.length || !LETTER.test(text[k])) return k;
  if (k - j < 2 || !SONORANT.test(text[j])) return j;
  let end = j + 1;
  while (end < k && TAIL.test(text[end])) end++;
  return end;
}

function wordEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length && !SPACE.test(text[j])) j++;
  while (j < text.length && SPACE.test(text[j])) j++;
  return Math.max(j, i + 1);
}

const charEnd = (text: string, i: number): number => {
  const code = text.charCodeAt(i);
  return code >= 0xd800 && code <= 0xdbff && i + 1 < text.length ? i + 2 : i + 1;
};

/** The line typed out: when each part of it appears and when its cues happen. */
export function typing(text: string, marks: readonly TextMark[], cps = BASE_CPS): Typing {
  const hidden = textPieces(text)
    .effects.filter((e) => e.braced)
    .map((e) => ({ start: e.start, end: e.end }));
  const styles: { start: number; end: number; props: StyleProps }[] = [];
  const cues: { at: number; props: CueProps }[] = [];
  for (const m of marks) {
    if (m.device === 'cue') cues.push({ at: cueAt(text, m), props: m.props });
    else {
      const r = resolveRange(text, m.range);
      if (r) styles.push({ ...r, props: m.props });
    }
  }
  cues.sort((a, b) => a.at - b.at);
  const over = (i: number) => styles.filter((s) => s.start <= i && i < s.end);
  const speedAt = (i: number) =>
    over(i).reduce((v, s) => (typeof s.props.speed === 'number' && s.props.speed > 0 ? v * s.props.speed : v), 1);
  const revealAt = (i: number): Reveal => {
    const r = over(i)
      .map((s) => s.props.reveal)
      .filter((x): x is string => !!x && REVEALS.includes(x))
      .pop();
    return (r as Reveal | undefined) ?? 'letter';
  };
  /** The next place a chunk must stop at: a cue, a hidden part, the edge of a look. */
  const stops = [
    ...cues.map((c) => c.at),
    ...hidden.flatMap((h) => [h.start, h.end]),
    ...styles.flatMap((s) => [s.start, s.end]),
  ];
  const nextStop = (i: number) => stops.filter((p) => p > i).reduce((m, p) => Math.min(m, p), text.length);

  const steps: TypingStep[] = [];
  let t = 0;
  let next = 0;
  const fireCues = (i: number) => {
    for (; next < cues.length && cues[next].at <= i; next++) {
      const c = cues[next].props;
      if (typeof c.pause === 'number') t += Math.max(0, c.pause) * 1000;
      else steps.push({ at: t, upto: i, cue: c });
    }
  };
  let i = 0;
  while (i < text.length) {
    fireCues(i);
    const cut = hidden.find((h) => h.start <= i && i < h.end);
    if (cut) {
      i = cut.end;
      continue;
    }
    const reveal = revealAt(i);
    const limit = nextStop(i);
    let j =
      reveal === 'instant'
        ? limit
        : reveal === 'word'
          ? wordEnd(text, i)
          : reveal === 'syllable'
            ? syllableEnd(text, i)
            : charEnd(text, i);
    j = Math.max(charEnd(text, i), Math.min(j, limit));
    const letters = [...text.slice(i, j)].length;
    const speed = speedAt(i);
    t += ((reveal === 'instant' ? 1 : letters) / (cps * speed)) * 1000;
    steps.push({ at: t, upto: j });
    i = j;
  }
  fireCues(text.length);
  return { steps, total: t, hidden };
}

/** How much of the text is out at a moment of the preview, and the cues that happened by then. */
export function typedAt(ty: Typing, ms: number): { upto: number; cues: { at: number; cue: CueProps }[] } {
  let upto = 0;
  const cues: { at: number; cue: CueProps }[] = [];
  for (const s of ty.steps) {
    if (s.at > ms) break;
    upto = Math.max(upto, s.upto);
    if (s.cue) cues.push({ at: s.at, cue: s.cue });
  }
  return { upto, cues };
}
