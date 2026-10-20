// Story node data (FR-NAR-02): fields that story kinds keep on top of the generic graph node.
// Everything is stored in data/graphs/<id>.json (docs/format/project-v1.md); expressions are source text.

import { isDraft } from 'immer';
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
  /** The designer's comment; "x = 1" written in it is applied when the option is chosen (textEffects.ts). */
  note?: string;
}

export type WorldKind = 'character' | 'location' | 'item';
export const WORLD_KINDS: readonly WorldKind[] = ['character', 'location', 'item'];

/** A node that the plot devices point at can say so even before the link exists (for checks). */
export type PlotRole = 'consequence' | 'payoff';

/**
 * Literary devices laid over the story rather than placed as nodes of their own: Chekhov's gun (set up
 * here, fires later) and the butterfly effect (a small choice here, consequences later). More may follow.
 */
export type PlotDevice = 'gun' | 'butterfly';
export const PLOT_DEVICES: readonly PlotDevice[] = ['gun', 'butterfly'];

/** What a plot mark sits on inside its node: the node itself (its description), a choice option, a line. */
export type MarkAnchor = { kind: 'node' } | { kind: 'option'; id: string } | { kind: 'line'; id: string };

/** A marked fragment of the anchor's text: UTF-16 offsets, and the fragment itself to find it after edits. */
export interface TextRange {
  start: number;
  end: number;
  quote: string;
}

export interface PlotMark {
  id: string;
  device: PlotDevice;
  anchor: MarkAnchor;
  /** A fragment of the text, or null for the whole option, line or node. */
  range: TextRange | null;
  /** Where the gun fires / where the butterfly's consequences are. */
  links: NodeRef[];
  note: string;
  /** Butterfly: the variables its consequences depend on (ids), optional. */
  variables: string[];
}

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
  /** Plot devices laid over this node, its options or its lines. */
  marks?: PlotMark[];
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

/** Nodes by id, built once per version of a graph (see edgesFrom in flow.ts); drafts are not cached. */
const nodeIndex = new WeakMap<GraphDoc, Map<string, GraphNode>>();

export function nodeIn(g: GraphDoc | undefined, id: string): StoryNode | undefined {
  if (!g) return undefined;
  if (isDraft(g)) return g.nodes.find((n) => n.id === id) as StoryNode | undefined;
  let byId = nodeIndex.get(g);
  if (!byId) nodeIndex.set(g, (byId = new Map(g.nodes.map((n) => [n.id, n]))));
  return byId.get(id) as StoryNode | undefined;
}

export function findNode(data: ProjectData, ref: NodeRef | null | undefined): StoryNode | undefined {
  return ref ? nodeIn(graphOf(data, ref.graph), ref.node) : undefined;
}

/** Kinds that the playthrough stops at; the others (start, condition, effect, jump, chapter) it passes. */
export const PASS_THROUGH = new Set(['start', 'condition', 'effect', 'jump', 'chapter']);

/** Kinds outside the flow: never "unreachable" and never a dead end. */
export const OFF_FLOW = new Set(['sticker']);

export const DIALOGUE_LINE_H = 22;
/** Space above the first line of a dialogue card (keep in step with .cdialogue in story.css). */
export const DIALOGUE_TOP = 6;
export const CHOICE_ROW_H = 30;
