// Test playthrough (FR-NAR-07): walks the story like a player would, evaluating conditions and applying
// effects to a set of variable values. Pure functions over immutable states, so "step back" is just the
// previous state and a test can script a whole run.

import type { GraphEdge } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import {
  applyEffects,
  evaluate,
  isBlank,
  parseCondition,
  parseEffects,
  type Change,
  type State,
  type Value,
} from './expr';
import { chapterStack, edgesFrom, startOf } from './flow';
import { asStory, findNode, graphOf, PASS_THROUGH, type NodeRef, type StoryNode } from './model';
import { joinedEffects, playerText, textPieces } from './textEffects';
import { entityName, listVariables, registryFor, type Variable } from './variables';

export type PlayStatus = 'running' | 'ended' | 'stuck' | 'error';

export type PlayProblemCode =
  | 'noStart'
  | 'noStartHere'
  | 'missingNode'
  | 'chapterNoStart'
  | 'jumpNoTarget'
  | 'loop'
  | 'badExpression'
  | 'deadEnd'
  | 'noOptions';

export interface PlayProblem {
  code: PlayProblemCode;
  params: Record<string, string>;
}

export type LogEntry =
  | { kind: 'arrive'; at: NodeRef; title: string; nodeKind: string }
  | { kind: 'condition'; at: NodeRef; result: boolean }
  | { kind: 'option'; at: NodeRef; text: string }
  | { kind: 'exit'; at: NodeRef; label: string }
  | { kind: 'changes'; at: NodeRef; changes: Change[] }
  | { kind: 'manual'; name: string; value: Value | null }
  | { kind: 'enter'; at: NodeRef; title: string }
  | { kind: 'leave'; at: NodeRef; title: string };

export interface PlayState {
  /** The node shown to the player. */
  pos: NodeRef | null;
  /** At a chapter node after its chapter ended: its exits are offered instead of entering it again. */
  leaving: boolean;
  /** Chapter nodes we are inside, outermost first. */
  stack: NodeRef[];
  /** Values by variable id; entity variables hold an entity id. */
  vars: Record<string, Value | null>;
  log: LogEntry[];
  status: PlayStatus;
  problem: PlayProblem | null;
}

export type PlayAction =
  | { kind: 'option'; id: string; label: string; enabled: boolean }
  | { kind: 'exit'; edge: string; label: string; to: NodeRef };

/** Auto-advance stops after this many nodes without a player decision: a loop of conditions and jumps. */
const LOOP_GUARD = 1000;

// ---------- variables ----------

function initialValues(data: ProjectData): Record<string, Value | null> {
  return Object.fromEntries(listVariables(data).map((v) => [v.id, v.initial]));
}

/** Values by name as expressions in `graph` see them; entity variables appear as the entity's name. */
function stateFor(data: ProjectData, graph: string, vars: Record<string, Value | null>): State {
  const state: State = new Map();
  for (const [name, entry] of registryFor(data, graph)) {
    const v = entry.variable;
    // A value set to "none" by hand stays none; only a variable never set falls back to its initial value.
    const raw = v.id in vars ? vars[v.id] : v.initial;
    state.set(name, v.type === 'entity' ? (raw ? (entityName(data, String(raw)) ?? '') : '') : (raw ?? ''));
  }
  return state;
}

/** Stores the variables that effects changed (by name) back by id; the others keep their exact value. */
function writeBack(
  data: ProjectData,
  graph: string,
  state: State,
  vars: Record<string, Value | null>,
  changed: ReadonlySet<string>,
) {
  const next = { ...vars };
  for (const [name, entry] of registryFor(data, graph)) {
    if (!changed.has(name) || !state.has(name)) continue;
    const v = entry.variable;
    const value = state.get(name)!;
    next[v.id] = v.type === 'entity' ? entityByName(data, String(value)) : value;
  }
  return next;
}

function entityByName(data: ProjectData, name: string): string | null {
  for (const [id, e] of Object.entries(data.entities)) if (e.name === name) return id;
  return null;
}

function isWhole(data: ProjectData, graph: string): (name: string) => boolean {
  const reg = registryFor(data, graph);
  return (name) => reg.get(name)?.variable.type === 'int';
}

/** A condition on an edge, option or node; blank means "always". Broken conditions count as false. */
function holds(data: ProjectData, graph: string, source: string | undefined, vars: PlayState['vars']): boolean {
  if (isBlank(source)) return true;
  try {
    return evaluate(parseCondition(source!), stateFor(data, graph, vars)) === true;
  } catch {
    return false;
  }
}

function runEffects(
  data: ProjectData,
  s: PlayState,
  graph: string,
  source: string | undefined,
  at: NodeRef,
): PlayState {
  if (isBlank(source)) return s;
  try {
    const state = stateFor(data, graph, s.vars);
    const changes = applyEffects(parseEffects(source!), state, isWhole(data, graph));
    const changed = new Set(changes.map((c) => c.name));
    return {
      ...s,
      vars: writeBack(data, graph, state, s.vars, changed),
      log: [...s.log, { kind: 'changes', at, changes }],
    };
  } catch {
    return fail(s, 'badExpression', { node: findNode(data, at)?.title ?? '' });
  }
}

/** Effects written in a node's description, comment and lines ("{x = 1}", see textEffects.ts). */
function nodeTextEffects(data: ProjectData, graph: string, node: StoryNode): string {
  if (!node.text && !node.comment && !node.lines?.length) return '';
  const reg = registryFor(data, graph);
  const known = (name: string) => reg.has(name);
  return [
    joinedEffects(textPieces(node.text, known)),
    joinedEffects(textPieces(node.comment, known)),
    ...(node.lines ?? []).map((l) => joinedEffects(textPieces(l.text))),
  ]
    .filter(Boolean)
    .join('; ');
}

/** A text as the player sees it now: braced effects left out, "{name}" replaced by the value. */
export function playText(
  data: ProjectData,
  s: PlayState,
  graph: string,
  text: string,
  yes: string,
  no: string,
): string {
  const pieces = textPieces(text);
  if (!pieces.effects.length && !pieces.shows.length) return text;
  const state = stateFor(data, graph, s.vars);
  return playerText(text, pieces, (name) => {
    if (!state.has(name)) return null;
    const v = state.get(name)!;
    return typeof v === 'boolean' ? (v ? yes : no) : String(v);
  });
}

function resetChapterVariables(data: ProjectData, graph: string, vars: PlayState['vars']): PlayState['vars'] {
  const scoped = listVariables(data).filter((v: Variable) => v.scope !== 'project' && v.scope.id === graph);
  if (!scoped.length) return vars;
  return { ...vars, ...Object.fromEntries(scoped.map((v) => [v.id, v.initial])) };
}

// ---------- moving ----------

function fail(s: PlayState, code: PlayProblemCode, params: Record<string, string> = {}): PlayState {
  return { ...s, status: code === 'deadEnd' || code === 'noOptions' ? 'stuck' : 'error', problem: { code, params } };
}

/** Edges out of a node whose conditions hold now. */
function openExits(data: ProjectData, s: PlayState, at: NodeRef, port?: string): GraphEdge[] {
  const g = graphOf(data, at.graph);
  if (!g) return [];
  return edgesFrom(g, at.node, port).filter((e) => holds(data, at.graph, e.condition, s.vars));
}

const titleOf = (data: ProjectData, r: NodeRef) => findNode(data, r)?.title ?? '';

/** Result of one automatic move: the new state, and whether the player has to look or decide here. */
interface Step {
  s: PlayState;
  stop: boolean;
}

const moveTo = (s: PlayState, pos: NodeRef): Step => ({ s: { ...s, pos, leaving: false }, stop: false });

/**
 * Arrives at `to` and keeps going through nodes that need no decision (start, condition, effect, jump,
 * chapter, chapter ends) until a node the player has to see, the end, or a problem.
 */
function arrive(data: ProjectData, s0: PlayState, to: NodeRef): PlayState {
  let s: PlayState = { ...s0, pos: to, leaving: false };
  for (let guard = 0; guard < LOOP_GUARD; guard++) {
    const at = s.pos!;
    const node = findNode(data, at);
    if (!node) return fail(s, 'missingNode');
    if (!s.leaving) {
      s = { ...s, log: [...s.log, { kind: 'arrive', at, title: node.title, nodeKind: node.kind }] };
      s = runEffects(data, s, at.graph, nodeTextEffects(data, at.graph, node), at);
      if (s.status !== 'running') return s;
    }
    const r = step(data, s, at, node);
    if (r.stop || r.s.status !== 'running') return r.s;
    s = r.s;
  }
  return fail(s, 'loop');
}

function step(data: ProjectData, s: PlayState, at: NodeRef, node: StoryNode): Step {
  if (s.leaving) return leave(data, s, at);
  switch (node.kind) {
    case 'butterfly':
      // A story event: its effects happen, and the player sees it.
      return { s: runEffects(data, s, at.graph, node.effects, at), stop: true };
    case 'effect': {
      const after = runEffects(data, s, at.graph, node.effects, at);
      return after.status === 'running' ? single(data, after, at) : { s: after, stop: true };
    }
    case 'start':
      return single(data, s, at);
    case 'condition': {
      const result = holds(data, at.graph, node.expr, s.vars);
      const logged: PlayState = { ...s, log: [...s.log, { kind: 'condition', at, result }] };
      const exit = openExits(data, logged, at, result ? 'yes' : 'no')[0];
      if (!exit) return { s: fail(logged, 'deadEnd', { node: node.title }), stop: true };
      return moveTo(logged, { graph: at.graph, node: exit.to.node });
    }
    case 'jump': {
      const target = node.target;
      if (!target || !findNode(data, target)) return { s: fail(s, 'jumpNoTarget', { node: node.title }), stop: true };
      return moveTo({ ...s, stack: chapterStack(data, target.graph) }, target);
    }
    case 'chapter': {
      const start = node.graph ? startOf(graphOf(data, node.graph)) : undefined;
      if (!node.graph || !start) return { s: fail(s, 'chapterNoStart', { chapter: node.title }), stop: true };
      const entered: PlayState = {
        ...s,
        stack: [...s.stack, at],
        vars: resetChapterVariables(data, node.graph, s.vars),
        log: [...s.log, { kind: 'enter', at, title: node.title }],
      };
      return moveTo(entered, { graph: node.graph, node: start.id });
    }
    case 'end':
      return up(data, s);
    default:
      return { s, stop: true };
  }
}

/** The chapter we are in ended: back to its chapter node, to continue after it; the top ends the story. */
function up(data: ProjectData, s: PlayState): Step {
  const parent = s.stack[s.stack.length - 1];
  if (!parent) return { s: { ...s, status: 'ended' }, stop: true };
  return {
    s: {
      ...s,
      pos: parent,
      leaving: true,
      stack: s.stack.slice(0, -1),
      log: [...s.log, { kind: 'leave', at: parent, title: titleOf(data, parent) }],
    },
    stop: false,
  };
}

/** From a node with no choice of its own: the only open exit, else stop (several) or a dead end (none). */
function single(data: ProjectData, s: PlayState, at: NodeRef): Step {
  const exits = openExits(data, s, at);
  if (exits.length === 1) return moveTo(s, { graph: at.graph, node: exits[0].to.node });
  if (exits.length === 0) return { s: fail(s, 'deadEnd', { node: titleOf(data, at) }), stop: true };
  return { s, stop: true };
}

/** After a chapter ended: continue from its chapter node (asking if there are several ways), or go up. */
function leave(data: ProjectData, s: PlayState, at: NodeRef): Step {
  const exits = openExits(data, s, at);
  if (exits.length === 1) return moveTo(s, { graph: at.graph, node: exits[0].to.node });
  if (exits.length > 1) return { s, stop: true };
  // No edges at all: the enclosing chapter ends too. Edges whose conditions are all false: stuck here.
  const g = graphOf(data, at.graph);
  if (g && edgesFrom(g, at.node).length > 0) {
    return { s: fail(s, 'deadEnd', { node: titleOf(data, at) }), stop: true };
  }
  return up(data, s);
}

// ---------- public API ----------

/**
 * A new run: from a node (with the chapters above it entered), from the start of a graph (a chapter tested
 * on its own continues into the story after its end), or from the start of the whole story.
 */
export function startPlay(data: ProjectData, from?: NodeRef | null, graph?: string): PlayState {
  const blank: PlayState = {
    pos: null,
    leaving: false,
    stack: [],
    vars: initialValues(data),
    log: [],
    status: 'running',
    problem: null,
  };
  let at = from ?? null;
  if (!at) {
    const id = graph ?? (Object.values(data.graphs).find((g) => g.kind === 'story') as { id: string } | undefined)?.id;
    const start = id ? startOf(graphOf(data, id)) : undefined;
    if (!id || !start) return fail(blank, graph ? 'noStartHere' : 'noStart', { graph: graph ?? '' });
    at = { graph: id, node: start.id };
  }
  return arrive(data, { ...blank, stack: chapterStack(data, at.graph) }, at);
}

/** What the player can do at the current node. */
export function playActions(data: ProjectData, s: PlayState): PlayAction[] {
  if (s.status !== 'running' || !s.pos) return [];
  const node = findNode(data, s.pos);
  if (!node) return [];
  if (node.kind === 'choice' && !s.leaving) {
    return (asStory(node).options ?? []).map((o) => ({
      kind: 'option',
      id: o.id,
      label: o.text,
      enabled: holds(data, s.pos!.graph, o.condition, s.vars),
    }));
  }
  if (PASS_THROUGH.has(node.kind) && !s.leaving && node.kind !== 'start' && node.kind !== 'effect') return [];
  return openExits(data, s, s.pos).map((e) => ({
    kind: 'exit',
    edge: e.id,
    label: e.label || titleOf(data, { graph: s.pos!.graph, node: e.to.node }),
    to: { graph: s.pos!.graph, node: e.to.node },
  }));
}

/** Takes an action; the previous state stays valid for "step back". */
export function playAct(data: ProjectData, s: PlayState, action: PlayAction): PlayState {
  if (s.status !== 'running' || !s.pos) return s;
  const at = s.pos;
  if (action.kind === 'option') {
    const node = findNode(data, at);
    const option = node?.options?.find((o) => o.id === action.id);
    if (!option || !holds(data, at.graph, option.condition, s.vars)) return s;
    let next: PlayState = { ...s, log: [...s.log, { kind: 'option', at, text: option.text }] };
    next = runEffects(data, next, at.graph, option.effects, at);
    if (next.status !== 'running') return next;
    const reg = registryFor(data, at.graph);
    next = runEffects(data, next, at.graph, joinedEffects(textPieces(option.note, (n) => reg.has(n))), at);
    if (next.status !== 'running') return next;
    const exit = openExits(data, next, at, option.id)[0];
    if (!exit) return fail(next, 'deadEnd', { node: option.text || node?.title || '' });
    return arrive(data, next, { graph: at.graph, node: exit.to.node });
  }
  const logged: PlayState = { ...s, log: [...s.log, { kind: 'exit', at, label: action.label }] };
  return arrive(data, logged, action.to);
}

/** Sets a variable by hand from the playthrough panel. */
export function playSetVariable(s: PlayState, variable: Variable, value: Value | null): PlayState {
  return {
    ...s,
    vars: { ...s.vars, [variable.id]: value },
    log: [...s.log, { kind: 'manual', name: variable.name, value }],
  };
}
