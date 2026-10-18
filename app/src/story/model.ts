// Story node data (FR-NAR-02): fields that story kinds keep on top of the generic graph node.
// Everything is stored in data/graphs/<id>.json (docs/format/project-v1.md); expressions are source text.

import type { GraphDoc, GraphNode } from '../canvas/model';
import type { ProjectData } from '../core/project/types';

/** A node somewhere in the project: jump targets, consequences and payoffs may sit in other chapters. */
export interface NodeRef {
  graph: string;
  node: string;
}

export interface DialogueLine {
  id: string;
  /** Entity id of the speaker, or null for narration. */
  speaker: string | null;
  text: string;
}

export interface ChoiceOption {
  id: string;
  text: string;
  /** Show the option only when this holds (blank: always). */
  condition: string;
  /** Applied when the option is chosen. */
  effects: string;
}

export type WorldKind = 'character' | 'location' | 'item';
export const WORLD_KINDS: readonly WorldKind[] = ['character', 'location', 'item'];

/** A node that the plot devices point at can say so even before the link exists (for checks). */
export type PlotRole = 'consequence' | 'payoff';

export interface StoryNode extends GraphNode {
  /** Dialogue. */
  lines?: DialogueLine[];
  /** Dialogue: show every line on the canvas instead of the first few. */
  expanded?: boolean;
  /** Choice. */
  options?: ChoiceOption[];
  /** Condition node: the expression that picks the "yes" or "no" exit. */
  expr?: string;
  /** Effect and butterfly nodes. */
  effects?: string;
  /** Butterfly: consequences; Chekhov's gun: where it fires. */
  links?: NodeRef[];
  /** Jump. */
  target?: NodeRef | null;
  /** Character, location, item: the entity, or null for an unbound node. */
  ref?: string | null;
  /** Chapter: its own graph. */
  graph?: string;
  /** Chapter: picture inside the project ("assets/…"). */
  image?: string | null;
  plotRole?: PlotRole | null;
}

export const asStory = (n: GraphNode): StoryNode => n as StoryNode;

export function graphOf(data: ProjectData, id: string): GraphDoc | undefined {
  return data.graphs[id] as unknown as GraphDoc | undefined;
}

export function allGraphs(data: ProjectData): GraphDoc[] {
  return Object.values(data.graphs) as unknown as GraphDoc[];
}

/** The top of the story: the chapter overview graph. */
export function storyRoot(data: ProjectData): GraphDoc | undefined {
  return allGraphs(data).find((g) => g.kind === 'story');
}

export function findNode(data: ProjectData, ref: NodeRef | null | undefined): StoryNode | undefined {
  if (!ref) return undefined;
  return graphOf(data, ref.graph)?.nodes.find((n) => n.id === ref.node) as StoryNode | undefined;
}

/** Kinds that the playthrough stops at; the others (start, condition, effect, jump, chapter) it passes. */
export const PASS_THROUGH = new Set(['start', 'condition', 'effect', 'jump', 'chapter']);

/** Kinds outside the flow: never "unreachable" and never a dead end. */
export const OFF_FLOW = new Set(['sticker']);

export const DIALOGUE_LINE_H = 22;
export const CHOICE_ROW_H = 30;
