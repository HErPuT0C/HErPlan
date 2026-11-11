// Ready pieces of a conversation (0.8, item 21 of "Dialogues"): "a talk with a companion" put on the canvas
// in one step — the companion speaks up, the hero answers with a choice, the companion replies to each
// answer, and the talk ends. The words come from the interface language; the speakers are cards picked when
// the template is put.

import { createNode } from '../canvas/ops';
import type { GraphEdge, GraphNode } from '../canvas/model';
import { newId } from '../core/ids';
import type { DialogueLine, StoryNode } from './model';
import { fitNode } from './ops';

/** The words of the template, in the interface language. */
export interface CompanionWords {
  opening: { title: string; lines: [string, string, string] };
  choice: { title: string; prompt: string; options: [string, string, string] };
  replies: [{ title: string; line: string }, { title: string; line: string }, { title: string; line: string }];
  end: string;
}

/** The nodes and edges of "a talk with a companion", its top-left corner at `at`. */
export function companionTalk(
  at: { x: number; y: number },
  who: { companion: string | null; hero: string | null },
  w: CompanionWords,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const node = (kind: string, dx: number, dy: number, title: string, extra: Partial<StoryNode> = {}) => {
    const n = { ...createNode(kind, at.x + dx, at.y + dy, title), ...extra } as StoryNode;
    fitNode(n);
    return n;
  };
  const line = (speaker: string | null, text: string): DialogueLine => ({ id: newId(), speaker, text });
  const opening = node('dialogue', 0, 0, w.opening.title, {
    lines: [
      line(who.companion, w.opening.lines[0]),
      line(who.hero, w.opening.lines[1]),
      line(who.companion, w.opening.lines[2]),
    ],
  });
  const options = w.choice.options.map((text) => ({ id: newId(), text, condition: '', effects: '' }));
  const choice = node('choice', 380, 0, w.choice.title, { text: w.choice.prompt, options });
  const replies = w.replies.map((r, i) =>
    node('dialogue', 760, (i - 1) * 160, r.title, { lines: [line(who.companion, r.line)] }),
  );
  const end = node('end', 1140, 0, w.end);
  const edge = (from: string, port: string, to: string): GraphEdge => ({
    id: newId(),
    from: { node: from, port },
    to: { node: to, port: 'in' },
  });
  return {
    nodes: [opening, choice, ...replies, end],
    edges: [
      edge(opening.id, 'out', choice.id),
      ...options.map((o, i) => edge(choice.id, o.id, replies[i].id)),
      ...replies.map((r) => edge(r.id, 'out', end.id)),
    ],
  };
}
