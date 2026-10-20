// Variables changed right from the text (owner's request for 0.3): "{деньги += 10}" anywhere in a node's
// description, a comment of a choice option or a dialogue line; in descriptions and comments also
// "деньги += 10" without braces, when the name is a variable. "{деньги}" shows the value in the playthrough.
// The playthrough applies them when the node is shown (the option's comment: when the option is chosen);
// checks, "where used" and renames treat them like any other effects.

import { isIdentifier, renameVariable } from './expr';

export interface TextEffect {
  /** Offsets of the whole piece in the text, braces included. */
  start: number;
  end: number;
  /** Effects source, in the language of ADR-005. */
  source: string;
  /** Offset of `source` in the text (for underlining errors). */
  at: number;
  braced: boolean;
}

export interface TextShow {
  start: number;
  end: number;
  name: string;
}

export interface TextPieces {
  effects: TextEffect[];
  shows: TextShow[];
}

const BRACED = /\{([^{}\n]*)\}/g;
const NAME = '[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*(?:\\.[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)?';
const LITERAL = `-?[0-9]+(?:\\.[0-9]+)?|"[^"\\n]*"|«[^»\\n]*»|${NAME}`;
/** "name = value", "name += 3": a single value only; anything longer goes in braces. */
const BARE = new RegExp(
  `(?<![A-Za-zА-Яа-яЁё_0-9.])(${NAME})\\s*(\\+=|-=|=(?!=))\\s*(${LITERAL})(?![A-Za-zА-Яа-яЁё_0-9])`,
  'g',
);

const EMPTY: TextPieces = { effects: [], shows: [] };

/**
 * Effects and shown values in a text. `known` says which names are variables; without it (dialogue lines)
 * only braced pieces count, so ordinary prose with "=" is never taken for an effect.
 */
export function textPieces(text: string | undefined, known?: (name: string) => boolean): TextPieces {
  if (!text || (!text.includes('{') && !(known && text.includes('=')))) return EMPTY;
  const effects: TextEffect[] = [];
  const shows: TextShow[] = [];
  for (const m of text.matchAll(BRACED)) {
    const inner = m[1];
    const source = inner.trim();
    if (!source) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isName(source)) shows.push({ start, end, name: source });
    else effects.push({ start, end, source, at: start + 1 + inner.indexOf(source), braced: true });
  }
  if (known) {
    const braced = effects.map((e): [number, number] => [e.start, e.end]).concat(shows.map((s) => [s.start, s.end]));
    for (const m of text.matchAll(BARE)) {
      const start = m.index;
      const end = start + m[0].length;
      if (braced.some(([a, b]) => start < b && end > a) || !known(m[1])) continue;
      effects.push({ start, end, source: m[0], at: start, braced: false });
    }
    effects.sort((a, b) => a.start - b.start);
  }
  return { effects, shows };
}

const isName = (s: string) => s.split('.').every((part) => isIdentifier(part)) && s.split('.').length <= 2;

/** All effects of a text as one source ("a = 1; b += 2"), for the playthrough. */
export function joinedEffects(pieces: TextPieces): string {
  return pieces.effects.map((e) => e.source).join('; ');
}

/**
 * The text as the player sees it: braced effects removed, "{name}" replaced by `value(name)` (left as
 * written when it gives null). Bare effects stay: they are the designer's own words.
 */
export function playerText(text: string, pieces: TextPieces, value: (name: string) => string | null): string {
  const cuts = [
    ...pieces.effects.filter((e) => e.braced).map((e) => ({ start: e.start, end: e.end, with: '' })),
    ...pieces.shows.map((s) => ({ start: s.start, end: s.end, with: value(s.name) })),
  ].sort((a, b) => b.start - a.start);
  let out = text;
  for (const c of cuts) if (c.with !== null) out = out.slice(0, c.start) + c.with + out.slice(c.end);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Renames a variable inside every effect and shown value of a text. */
export function renameInText(text: string, from: string, to: string, known?: (name: string) => boolean): string {
  const pieces = textPieces(text, known);
  const edits = [
    ...pieces.effects.map((e) => ({
      start: e.at,
      end: e.at + e.source.length,
      with: renameVariable(e.source, from, to),
    })),
    ...pieces.shows.filter((s) => s.name === from).map((s) => ({ start: s.start, end: s.end, with: `{${to}}` })),
  ].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.with + out.slice(e.end);
  return out;
}
