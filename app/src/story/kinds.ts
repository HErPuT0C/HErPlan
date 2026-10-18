// Story node kinds (FR-NAR-02) on the shared canvas engine: sizes, colours and ports. How each kind looks up
// close is in ui/story/cards.tsx; how the playthrough treats it is in play.ts.

import { registerKind, sideAnchors, type Port } from '../canvas/kinds';
import { HEADER_H, type GraphNode } from '../canvas/model';
import { asStory, CHOICE_ROW_H, DIALOGUE_LINE_H } from './model';

const STORY_GRAPHS = ['story', 'chapter'] as const;

/** Dialogue lines shown on a folded dialogue node. */
export const FOLDED_LINES = 3;
/** Space for the question above the options of a choice node. */
export const CHOICE_PROMPT_H = 40;

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
  ports: both,
  graphs: STORY_GRAPHS,
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
  menu: { group: 'plot', order: 0 },
});
registerKind({
  id: 'gun',
  label: 'story.kind.gun',
  color: '#8c6b4f',
  size: { w: 260, h: 120 },
  ports: both,
  graphs: STORY_GRAPHS,
  menu: { group: 'plot', order: 1 },
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
