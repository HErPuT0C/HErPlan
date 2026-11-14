// Story node kinds (FR-NAR-02) on the shared canvas engine: sizes, colours and ports. How each kind looks up
// close is in ui/story/cards.tsx; how the playthrough treats it is in play.ts.

import { registerKind as register, sideAnchors, type KindLink, type NodeKindDef, type Port } from '../canvas/kinds';
import { colorHex, HEADER_H, type GraphNode } from '../canvas/model';
import {
  asStory,
  CHOICE_ROW_H,
  DIALOGUE_LINE_H,
  DIALOGUE_TOP,
  GIVE_PORTS,
  plotMarks,
  type MarkAnchor,
  type NodeMark,
  type PlotDevice,
  type StoryNode,
} from './model';

const STORY_GRAPHS = ['story', 'chapter'] as const;
/** Dialogue nodes also make up sets of lines (barks, 0.8), where nothing else is made. */
const LINE_GRAPHS = ['story', 'chapter', 'barks'] as const;

/** Dialogue lines shown on a folded dialogue node. */
export const FOLDED_LINES = 3;
/** Space for the question above the options of a choice node. */
export const CHOICE_PROMPT_H = 40;

/** Colours of the plot devices on the canvas (the same as --plot-* in tokens.css). */
export const PLOT_COLORS: Record<PlotDevice, string> = { gun: '#e8b931', butterfly: '#e0609f' };

// ---------- the rows of a card (0.8.5: long lines and options wrap on the card instead of being cut) ----------
// The card is laid out here, not measured on the screen: its height, the exits of the options and of the
// interrupted lines, and where marks leave it all come from the same numbers. Widths of the signs are
// estimated for the editor's font at 13px, a little generously; a text the estimate got short is still cut
// to its rows on the card (it never runs over the next one).

/** The left and right margins of a card's body (.cnode-body). */
const CARD_PAD = 10;
/** The most rows one line or option takes on a card; longer is cut with "…". */
export const MAX_CARD_ROWS = 4;
/** The height of a row of an option's text, and the room around it. */
export const OPTION_LINE_H = 18;
const OPTION_PAD = 12;
/** The parts of an option row around its text: the number, the gap, the margins (.coption). */
const OPTION_SIDES = 10 + 18 + 6 + 14;
/** A mark's icon in front of a text (a device over the whole line or option). */
const MARK_ICON_W = 17;

const NARROW = new Set([...'iljtfr.,:;\'!|()[]{}ІЇіїґ`"']);
const WIDE = new Set([...'mwшщжюмыфМШЩЖЮЫФWMД@%']);

/** About how wide a text is in the card's font (13px), in pixels. */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 3.8;
    else if (NARROW.has(ch)) w += 4;
    else if (WIDE.has(ch)) w += 10.5;
    else if (ch !== ch.toLowerCase()) w += 8.6;
    else w += 7.2;
  }
  return w;
}

/** How many rows a text takes in a column `width` pixels wide, word by word (a word longer than a row breaks). */
export function textRows(text: string, width: number): number {
  const room = Math.max(24, width);
  let rows = 1;
  let x = 0;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      if (part.includes('\n')) {
        rows += part.split('\n').length - 1;
        x = 0;
      } else if (x > 0) x += textWidth(' ');
      continue;
    }
    let w = textWidth(part);
    if (x > 0 && x + w > room) {
      rows++;
      x = 0;
    }
    while (w > room) {
      rows++;
      w -= room;
    }
    x += w;
  }
  return rows;
}

/** The width of the speakers' column of a dialogue card (the same for every line of it). */
export function speakerWidth(w: number): number {
  return Math.round(Math.min(130, Math.max(64, (w - 2 * CARD_PAD) * 0.3)));
}

const sameAnchor = (a: MarkAnchor, b: MarkAnchor) =>
  a.kind === b.kind && (a.kind === 'node' || (b.kind !== 'node' && a.id === b.id));
const wholeMarks = (n: StoryNode, anchor: MarkAnchor) =>
  plotMarks(n).filter((m) => sameAnchor(m.anchor, anchor) && !m.range).length;

/** Rows of each line shown on a dialogue card, and whether a "more" row follows them. */
export function dialogueRows(n: StoryNode): { rows: number[]; more: boolean } {
  const lines = n.lines ?? [];
  const shown = n.expanded ? lines : lines.slice(0, FOLDED_LINES);
  const column = n.w - 2 * CARD_PAD - speakerWidth(n.w) - 6;
  return {
    rows: shown.map((l) =>
      Math.min(
        MAX_CARD_ROWS,
        textRows(l.text || '…', column - wholeMarks(n, { kind: 'line', id: l.id }) * MARK_ICON_W),
      ),
    ),
    more: !n.expanded && lines.length > FOLDED_LINES,
  };
}

/** Rows of each option's text on a choice card, and the height of its row. */
export function optionRows(n: StoryNode): { rows: number; h: number }[] {
  return (n.options ?? []).map((o, i) => {
    const marks =
      wholeMarks(n, { kind: 'option', id: o.id }) + (o.secret ? 1 : 0) + (o.once ? 1 : 0) + (o.note?.trim() ? 1 : 0);
    const rows = Math.min(MAX_CARD_ROWS, textRows(o.text || `${i + 1}…`, n.w - OPTION_SIDES - marks * MARK_ICON_W));
    return { rows, h: Math.max(CHOICE_ROW_H, rows * OPTION_LINE_H + OPTION_PAD) };
  });
}

/** Where an option's row starts on its card. */
function optionTop(n: StoryNode, i: number): number {
  const rows = optionRows(n);
  let y = HEADER_H + CHOICE_PROMPT_H;
  for (let k = 0; k < i && k < rows.length; k++) y += rows[k].h;
  return y;
}

/** Where a mark's line leaves its card: level with its option or line (hidden lines: the "more" row). */
export function markRowY(n: StoryNode, m: Pick<NodeMark, 'anchor'>): number | undefined {
  if (m.anchor.kind === 'option') {
    const id = m.anchor.id;
    const options = n.options ?? [];
    const i = options.findIndex((o) => o.id === id);
    if (i < 0) return undefined;
    return optionTop(n, i) + optionRows(n)[i].h / 2;
  }
  if (m.anchor.kind === 'line') {
    const id = m.anchor.id;
    const lines = n.lines ?? [];
    const i = lines.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    const { rows } = dialogueRows(n);
    const before = rows.slice(0, Math.min(i, rows.length)).reduce((a, b) => a + b, 0);
    return HEADER_H + DIALOGUE_TOP + before * DIALOGUE_LINE_H + DIALOGUE_LINE_H / 2;
  }
  return undefined;
}

/** The option or dialogue line at a height inside a card (null: none there). */
export function cardRowAt(n: StoryNode, y: number): { anchor: MarkAnchor; index: number } | null {
  if (n.kind === 'choice') {
    const rows = optionRows(n);
    let top = HEADER_H + CHOICE_PROMPT_H;
    for (let i = 0; i < rows.length; i++) {
      if (y >= top && y < top + rows[i].h) return { anchor: { kind: 'option', id: n.options![i].id }, index: i };
      top += rows[i].h;
    }
    return null;
  }
  if (n.kind === 'dialogue') {
    const { rows } = dialogueRows(n);
    let top = HEADER_H + DIALOGUE_TOP;
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i] * DIALOGUE_LINE_H;
      if (y >= top && y < top + h) return { anchor: { kind: 'line', id: n.lines![i].id }, index: i };
      top += h;
    }
  }
  return null;
}

/** Lines from plot devices: marks (with a trail, from their row) and gun or butterfly nodes of old. */
function storyLinks(n: GraphNode): KindLink[] {
  const s = asStory(n);
  const out: KindLink[] = [];
  if ((n.kind === 'gun' || n.kind === 'butterfly') && s.links) {
    const color = colorHex(n.color, n.kind === 'gun' ? '#8c6b4f' : '#b8458a');
    for (const to of s.links) out.push({ key: `${to.graph}/${to.node}`, to, color });
  }
  for (const m of plotMarks(s)) {
    const y = markRowY(s, m);
    for (const to of m.links) {
      out.push({ key: `${m.id}/${to.graph}/${to.node}`, to, color: PLOT_COLORS[m.device], y, trail: true });
    }
  }
  return out;
}

/** Story kinds all draw the lines of plot devices laid over them. */
const registerKind = (def: NodeKindDef) => register({ links: storyLinks, ...def });

const both = (n: GraphNode) => sideAnchors(n);
const inputsOnly = (n: GraphNode) => sideAnchors(n, 'in');

/** Choice: inputs on three sides, one output per option on the right, level with its row. */
export function choicePorts(n: GraphNode): Port[] {
  const options = asStory(n).options ?? [];
  return [
    ...sideAnchors(n, 'in', ['left', 'top', 'bottom']),
    ...options.map((o, i) => ({
      id: o.id,
      side: 'out' as const,
      face: 'right' as const,
      x: n.w,
      // Level with the middle of the option's row, however many rows its text takes.
      y: optionTop(asStory(n), i) + optionRows(asStory(n))[i].h / 2,
    })),
  ];
}

/** The height of a choice card: the question, every option's rows (one empty row without options). */
export function choiceHeight(n: StoryNode): number {
  const rows = optionRows(n);
  const body = rows.length ? rows.reduce((a, r) => a + r.h, 0) : CHOICE_ROW_H;
  return HEADER_H + CHOICE_PROMPT_H + body + 10;
}

/** Condition: inputs on three sides, "yes" and "no" outputs on the right. */
function conditionPorts(n: GraphNode): Port[] {
  const body = n.h - HEADER_H;
  return [
    ...sideAnchors(n, 'in', ['left', 'top', 'bottom']),
    { id: 'yes', side: 'out', face: 'right', x: n.w, y: HEADER_H + body / 3, label: 'story.port.yes' },
    { id: 'no', side: 'out', face: 'right', x: n.w, y: HEADER_H + (body * 2) / 3, label: 'story.port.no' },
  ];
}

/** Where a dialogue line is on its card: its row, or the "more" row when it is folded away. */
export function lineRowY(n: StoryNode, lineId: string): number | undefined {
  return markRowY(n, { anchor: { kind: 'line', id: lineId } });
}

/**
 * Dialogue (0.8): the four sides as before, and an "interrupted" exit for every line that has one, level
 * with the line; then the ordinary exit on the right moves up to the header, out of their way. A set of
 * lines (a node with "when") connects to nothing.
 */
export function dialoguePorts(n: GraphNode): Port[] {
  const s = asStory(n);
  if (s.when !== undefined) return [];
  const exits = (s.lines ?? []).filter((l) => l.interruptExit);
  if (!exits.length) return sideAnchors(n);
  return [
    ...sideAnchors(n).map((p) => (p.id === 'out' ? { ...p, y: HEADER_H / 2 } : p)),
    ...exits.map((l): Port => ({
      id: l.id,
      side: 'out',
      face: 'right',
      x: n.w,
      y: lineRowY(s, l.id) ?? HEADER_H,
      hint: 'story.port.interrupted',
    })),
  ];
}

/** Give (0.8): inputs on three sides; "gave", "refused", "nothing to give" on the right. */
export const GIVE_ROW_H = 26;
export const GIVE_TOP = HEADER_H + 14;
function givePorts(n: GraphNode): Port[] {
  const top = GIVE_TOP;
  return [
    ...sideAnchors(n, 'in', ['left', 'top', 'bottom']),
    ...GIVE_PORTS.map((id, i) => ({
      id,
      side: 'out' as const,
      face: 'right' as const,
      x: n.w,
      y: top + GIVE_ROW_H * (i + 0.5),
    })),
  ];
}

/** The height of a dialogue card: the rows of its lines shown, the "more" row. */
export function dialogueHeight(n: StoryNode): number {
  const { rows, more } = dialogueRows(n);
  const total =
    Math.max(
      1,
      rows.reduce((a, b) => a + b, 0),
    ) + (more ? 1 : 0);
  return Math.max(100, HEADER_H + 16 + total * DIALOGUE_LINE_H);
}

registerKind({
  id: 'start',
  label: 'story.kind.start',
  color: '#2f9e6e',
  size: { w: 160, h: 64 },
  ports: (n) => sideAnchors(n, 'out'),
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 0 },
});
registerKind({
  id: 'scene',
  label: 'story.kind.scene',
  color: '#3b74c9',
  size: { w: 240, h: 120 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 1 },
});
registerKind({
  id: 'dialogue',
  label: 'story.kind.dialogue',
  color: '#23917f',
  size: { w: 300, h: Math.max(100, HEADER_H + 16 + DIALOGUE_LINE_H) },
  ports: dialoguePorts,
  graphs: LINE_GRAPHS,
  menu: { group: 'flow', order: 2 },
  fit: (n) => {
    const s = asStory(n);
    n.h = dialogueHeight(s);
  },
});
registerKind({
  id: 'choice',
  label: 'story.kind.choice',
  color: '#b88a1e',
  size: { w: 280, h: HEADER_H + CHOICE_PROMPT_H + CHOICE_ROW_H + 10 },
  ports: choicePorts,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 3 },
  fit: (n) => {
    n.h = choiceHeight(asStory(n));
  },
});
registerKind({
  id: 'end',
  label: 'story.kind.end',
  color: '#c9473f',
  size: { w: 200, h: 90 },
  ports: inputsOnly,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 4 },
});
registerKind({
  id: 'jump',
  label: 'story.kind.jump',
  color: '#5b6474',
  size: { w: 220, h: 80 },
  ports: inputsOnly,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 5 },
});
registerKind({
  id: 'chapter',
  label: 'story.kind.chapter',
  color: '#6b5bd6',
  size: { w: 280, h: 180 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 6 },
});
registerKind({
  id: 'barks',
  label: 'story.kind.barks',
  color: '#3f8f9b',
  size: { w: 260, h: 120 },
  ports: () => [],
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 7 },
});
registerKind({
  id: 'give',
  label: 'story.kind.give',
  color: '#a8643c',
  size: { w: 260, h: GIVE_TOP + GIVE_ROW_H * 3 + 10 },
  ports: givePorts,
  graphs: STORY_GRAPHS,
  menu: { group: 'logic', order: 2 },
});
registerKind({
  id: 'condition',
  label: 'story.kind.condition',
  color: '#7656c9',
  size: { w: 240, h: 110 },
  ports: conditionPorts,
  graphs: STORY_GRAPHS,
  menu: { group: 'logic', order: 0 },
});
registerKind({
  id: 'effect',
  label: 'story.kind.effect',
  color: '#c96a2b',
  size: { w: 240, h: 100 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'logic', order: 1 },
});
registerKind({
  id: 'butterfly',
  label: 'story.kind.butterfly',
  color: '#b8458a',
  size: { w: 260, h: 140 },
  ports: both,
  graphs: STORY_GRAPHS,
  hidden: true,
});
registerKind({
  id: 'gun',
  label: 'story.kind.gun',
  color: '#8c6b4f',
  size: { w: 260, h: 120 },
  ports: both,
  graphs: STORY_GRAPHS,
  hidden: true,
});
registerKind({
  id: 'character',
  label: 'story.kind.character',
  color: '#4f7cc4',
  size: { w: 240, h: 96 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'world', order: 0 },
});
registerKind({
  id: 'location',
  label: 'story.kind.location',
  color: '#4c9a6a',
  size: { w: 240, h: 96 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'world', order: 1 },
});
registerKind({
  id: 'item',
  label: 'story.kind.item',
  color: '#a08a3c',
  size: { w: 240, h: 96 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'world', order: 2 },
});
