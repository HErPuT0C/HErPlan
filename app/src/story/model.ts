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

/**
 * A gesture or an emote, optionally aimed at another participant of the conversation (0.8). In files: the
 * palette id alone ("wave"), or `{ "id": "question", "to": "<entity id>" }` when it is aimed at somebody.
 */
export interface Toward {
  id: string;
  to?: string | null;
}
export type TowardValue = string | Toward;

/** What the game does besides changing variables (0.8): on a line, an option, an effect or a give node. */
export type ActionType =
  'give_item' | 'take_item' | 'hire' | 'dismiss' | 'list_add' | 'give_list' | 'save' | 'event' | 'start_quest';
export const ACTION_TYPES: readonly ActionType[] = [
  'give_item',
  'take_item',
  'hire',
  'dismiss',
  'list_add',
  'give_list',
  'save',
  'event',
  'start_quest',
];

export interface GameAction {
  /** One of ACTION_TYPES, or (0.8.1) any action of the palette's list. */
  type: ActionType | (string & {});
  /** give_item, take_item: an item; hire, dismiss: a character; list_add, give_list: a list variable (ids). */
  ref?: string | null;
  /** list_add: the item put on the list (entity id)… */
  item?: string | null;
  /** …or a value of its own; event, start_quest: the key the game knows. */
  value?: string;
  [extra: string]: unknown;
}

export interface DialogueLine {
  id: string;
  /** Entity id of the speaker, or null for narration. */
  speaker: string | null;
  text: string;
  // 0.8, all optional: what the game needs to play the line (ids of data/dialogue_palette.json).
  /** Style of the whole line. */
  style?: string;
  /** The face the speaker's sprite takes. */
  face?: string;
  gesture?: TowardValue;
  emote?: TowardValue;
  /** Seconds until the line goes on by itself; absent: waits for a press. */
  auto?: number;
  /** Seconds the line can be interrupted for; absent: as the game decides, 0: cannot be interrupted. */
  interrupt?: number;
  /** The line has an "interrupted" exit of its own: a port with the line's id on the dialogue node. */
  interruptExit?: boolean;
  /** Shown only when this holds (blank: always). */
  condition?: string;
  /** Applied after the line. */
  effects?: string;
  actions?: GameAction[];
  /** For the translator; never sent to the game. */
  note?: string;
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
  // 0.8:
  /** Not shown to the player: taken when the choice's time runs out. At most one per choice. */
  secret?: boolean;
  /** Shown once: gone after it was chosen. */
  once?: boolean;
  actions?: GameAction[];
  // 0.8.5: an option is a line the player's side says, with what a line has for the game.
  /** Who says it: a card's id or "narrator"; absent — the hero (the card named "hero" in the game); null — nobody. */
  speaker?: string | null;
  style?: string;
  face?: string;
  gesture?: TowardValue;
  emote?: TowardValue;
  /** Seconds until it goes on by itself once said. */
  auto?: number;
}

/** What text marks of the game sit on: a dialogue's line or (0.8.5) a choice's option. */
export type PartKind = 'line' | 'option';

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

/** How marked words of a line look and sound in the game (0.8); ids of the palette. */
export interface StyleProps {
  style?: string;
  /** "#rrggbb". */
  color?: string;
  size?: string;
  bold?: boolean;
  effect?: string;
  /** How many times faster (or slower, below 1) the words are typed. */
  speed?: number;
  reveal?: string;
}

/** Something that happens at a point between the words of a line (0.8): exactly one of these. */
export interface CueProps {
  /** Seconds of silence. */
  pause?: number;
  /** How hard the screen shakes. */
  shake?: number;
  sound?: string;
  gesture?: TowardValue;
  emote?: TowardValue;
  /** Held until the end of the line; since 0.8.1 with "to whom" like a gesture. */
  face?: TowardValue;
}
export const CUE_KINDS = ['pause', 'shake', 'sound', 'gesture', 'emote', 'face'] as const;
export type CueKind = (typeof CUE_KINDS)[number];

/**
 * Marks of the game's own (0.8), kept among the plot marks: "style" over words of a dialogue line, "cue" at
 * a point of it (its range has start = end). They have no links; plot devices never see them (plotMarks).
 */
export type TextMark =
  | { id: string; device: 'style'; anchor: MarkAnchor; range: TextRange | null; props: StyleProps }
  | { id: string; device: 'cue'; anchor: MarkAnchor; range: TextRange | null; props: CueProps };

export type NodeMark = PlotMark | TextMark;

export const isTextMark = (m: NodeMark): m is TextMark => m.device === 'style' || m.device === 'cue';
export const isPlotMark = (m: NodeMark): m is PlotMark => m.device === 'gun' || m.device === 'butterfly';

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
  /** 0.2 files: a single role; read through rolesOf() (marks.ts). */
  plotRole?: PlotRole | null;
  /** Expected roles (a node can be both a payoff and a consequence), for checks; see rolesOf(). */
  plotRoles?: PlotRole[];
  /** Plot devices laid over this node, its options or its lines; and the game's marks on lines (0.8). */
  marks?: NodeMark[];
  // 0.8:
  /** Choice: seconds to choose; absent: no timer. When it runs out the game takes the option the player is on. */
  timer?: number;
  /** Choice: the game saves before it. */
  checkpoint?: boolean;
  /** Give: the variable that gets what was given (id), and the list variable it is added to. */
  store?: string | null;
  keep?: string | null;
  /** Effect and give nodes: what the game does besides changing variables. */
  actions?: GameAction[];
  /** A dialogue node of a set of lines (barks): when the game says them. */
  when?: string;
}

export const asStory = (n: GraphNode): StoryNode => n as StoryNode;

export function graphOf(data: ProjectData, id: string): GraphDoc | undefined {
  return data.graphs[id] as unknown as GraphDoc | undefined;
}

export function allGraphs(data: ProjectData): GraphDoc[] {
  return Object.values(data.graphs) as unknown as GraphDoc[];
}

/** Graphs the story flows through; sets of lines (barks, 0.8) are not among them. */
export const isFlowGraph = (g: Pick<GraphDoc, 'kind'>): boolean => g.kind === 'story' || g.kind === 'chapter';

/** Nodes that own a graph: a chapter, a set of lines. */
export const ownsGraph = (n: Pick<GraphNode, 'kind'>): boolean => n.kind === 'chapter' || n.kind === 'barks';

/** Plot devices among the marks of a node. */
export function plotMarks(n: StoryNode | undefined): PlotMark[] {
  return (n?.marks ?? []).filter(isPlotMark);
}

/** The game's marks (style, cue) among the marks of a node. */
export function textMarks(n: StoryNode | undefined): TextMark[] {
  return (n?.marks ?? []).filter(isTextMark);
}

/** A gesture or an emote read from either form; null when there is none. */
export function toward(v: TowardValue | null | undefined): Toward | null {
  if (typeof v === 'string') return v ? { id: v } : null;
  if (v && typeof v === 'object' && typeof v.id === 'string' && v.id) {
    return typeof v.to === 'string' && v.to ? { id: v.id, to: v.to } : { id: v.id };
  }
  return null;
}

/** As it is stored: the id alone, or the id and whom it is aimed at. */
export function towardValue(id: string, to?: string | null): TowardValue | undefined {
  if (!id) return undefined;
  return to ? { id, to } : id;
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
export const OFF_FLOW = new Set(['sticker', 'barks']);

/** Exits of a give node (0.8): gave, refused, had nothing to give. */
export const GIVE_PORTS = ['given', 'cancel', 'empty'] as const;
export type GivePort = (typeof GIVE_PORTS)[number];

export const DIALOGUE_LINE_H = 22;
/** Space above the first line of a dialogue card (keep in step with .cdialogue in story.css). */
export const DIALOGUE_TOP = 6;
export const CHOICE_ROW_H = 30;
