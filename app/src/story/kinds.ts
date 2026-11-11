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

/** Where a mark's line leaves its card: level with its option or line (hidden lines: the "more" row). */
export function markRowY(n: StoryNode, m: Pick<NodeMark, 'anchor'>): number | undefined {
  if (m.anchor.kind === 'option') {
    const id = m.anchor.id;
    const i = (n.options ?? []).findIndex((o) => o.id === id);
    return i < 0 ? undefined : HEADER_H + CHOICE_PROMPT_H + i * CHOICE_ROW_H + CHOICE_ROW_H / 2;
  }
  if (m.anchor.kind === 'line') {
    const id = m.anchor.id;
    const lines = n.lines ?? [];
    const i = lines.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    const shown = n.expanded ? lines.length : Math.min(lines.length, FOLDED_LINES);
    return HEADER_H + DIALOGUE_TOP + Math.min(i, shown) * DIALOGUE_LINE_H + DIALOGUE_LINE_H / 2;
  }
  return undefined;
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
      y: HEADER_H + CHOICE_PROMPT_H + i * CHOICE_ROW_H + CHOICE_ROW_H / 2,
    })),
  ];
}

export function choiceHeight(optionCount: number): number {
  return HEADER_H + CHOICE_PROMPT_H + Math.max(1, optionCount) * CHOICE_ROW_H + 10;
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

export function dialogueHeight(lineCount: number, expanded: boolean): number {
  const shown = expanded ? lineCount : Math.min(lineCount, FOLDED_LINES);
  const more = !expanded && lineCount > FOLDED_LINES ? 1 : 0;
  return Math.max(100, HEADER_H + 16 + (Math.max(1, shown) + more) * DIALOGUE_LINE_H);
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
  size: { w: 300, h: dialogueHeight(0, false) },
  ports: dialoguePorts,
  graphs: LINE_GRAPHS,
  menu: { group: 'flow', order: 2 },
  fit: (n) => {
    const s = asStory(n);
    n.h = dialogueHeight(s.lines?.length ?? 0, s.expanded === true);
  },
});
registerKind({
  id: 'choice',
  label: 'story.kind.choice',
  color: '#b88a1e',
  size: { w: 280, h: choiceHeight(0) },
  ports: choicePorts,
  graphs: STORY_GRAPHS,
  menu: { group: 'flow', order: 3 },
  fit: (n) => {
    n.h = choiceHeight(asStory(n).options?.length ?? 0);
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
