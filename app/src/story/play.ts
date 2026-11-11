// Test playthrough (FR-NAR-07): walks the story like a player would, evaluating conditions and applying
// effects to a set of variable values. Pure functions over immutable states, so "step back" is just the
// previous state and a test can script a whole run.

import type { GraphEdge } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import {
  applyEffects,
  checkEffects,
  evaluate,
  isBlank,
  parseCondition,
  parseEffects,
  type CallWorld,
  type Change,
  type State,
  type Value,
} from './expr';
import { chapterStack, edgesFrom, startOf } from './flow';
import { entityByName as entityOfKind } from './game';
import {
  asStory,
  findNode,
  graphOf,
  PASS_THROUGH,
  type ActionType,
  type DialogueLine,
  type GameAction,
  type GivePort,
  type NodeRef,
  type StoryNode,
} from './model';
import { playerText, textPieces } from './textEffects';
import { asRegistry, entityName, listsFor, listVariables, registryFor, type Variable } from './variables';

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
  /** What the game would do (0.8): an item given or taken, a companion hired, a save, an event. */
  | { kind: 'action'; at: NodeRef; action: ActionType; name: string }
  | { kind: 'gave'; at: NodeRef; name: string }
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
  // 0.8: what the game keeps besides variables, as far as the playthrough can tell.
  /** Items the hero has and companions hired (entity ids): given and taken by actions. */
  items: string[];
  hired: string[];
  /** Lines the player saw and options chosen (ids): видел(), "show once". */
  seen: string[];
  /** List variables by id. */
  lists: Record<string, string[]>;
  /** Lines of the dialogue node the player is at whose conditions held when they came. */
  shown: string[];
}

export type PlayAction =
  | { kind: 'option'; id: string; label: string; enabled: boolean; secret?: boolean }
  /** `interrupt`: the exit of an interrupted line (its id). */
  | { kind: 'exit'; edge: string; label: string; to: NodeRef; interrupt?: string }
  /** A give node: hand over an item the hero has, refuse, or have nothing. */
  | { kind: 'give'; port: GivePort; item?: string; label: string };

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

/** What есть(), нанят(), видел() and непусто() answer in this run (0.8). */
function worldOf(data: ProjectData, graph: string, s: PlayState): CallWorld {
  return (fn, arg) => {
    switch (fn) {
      case 'has': {
        const id = entityOfKind(data, 'item', arg);
        return !!id && s.items.includes(id);
      }
      case 'hired': {
        const id = entityOfKind(data, 'character', arg);
        return !!id && s.hired.includes(id);
      }
      case 'seen':
        return s.seen.includes(arg);
      case 'notEmpty': {
        const v = listsFor(data, graph).get(arg);
        return !!v && (s.lists[v.id]?.length ?? 0) > 0;
      }
    }
  };
}

/** A condition on an edge, option, line or node; blank means "always". Broken conditions count as false. */
function holds(data: ProjectData, graph: string, source: string | undefined, s: PlayState): boolean {
  if (isBlank(source)) return true;
  try {
    return evaluate(parseCondition(source!), stateFor(data, graph, s.vars), worldOf(data, graph, s)) === true;
  } catch {
    return false;
  }
}

/** What the game would do, as far as the playthrough keeps track: items, companions, lists (0.8). */
function runActions(data: ProjectData, s: PlayState, actions: GameAction[] | undefined, at: NodeRef): PlayState {
  if (!actions?.length) return s;
  let items = s.items;
  let hired = s.hired;
  let lists = s.lists;
  const log = [...s.log];
  const add = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
  const name = (id: string | null | undefined) => (id ? (entityName(data, id) ?? '') : '');
  const listName = (id: string | null | undefined) => listVariables(data).find((v) => v.id === id)?.name ?? '';
  for (const a of actions) {
    let what: string;
    switch (a.type) {
      case 'give_item':
        if (a.ref) items = add(items, a.ref);
        what = name(a.ref);
        break;
      case 'take_item':
        items = items.filter((id) => id !== a.ref);
        what = name(a.ref);
        break;
      case 'hire':
        if (a.ref) hired = add(hired, a.ref);
        what = name(a.ref);
        break;
      case 'dismiss':
        hired = hired.filter((id) => id !== a.ref);
        what = name(a.ref);
        break;
      case 'list_add': {
        const value = a.item || a.value || '';
        if (a.ref && value) lists = { ...lists, [a.ref]: [...(lists[a.ref] ?? []), value] };
        what = `${listName(a.ref)} ← ${a.item ? name(a.item) : (a.value ?? '')}`;
        break;
      }
      case 'give_list':
        if (a.ref) {
          for (const id of lists[a.ref] ?? []) if (data.entities[id]) items = add(items, id);
          lists = { ...lists, [a.ref]: [] };
        }
        what = listName(a.ref);
        break;
      default:
        what = a.value ?? '';
    }
    log.push({ kind: 'action', at, action: a.type, name: what });
  }
  return { ...s, items, hired, lists, log };
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
    const changes = applyEffects(parseEffects(source!), state, isWhole(data, graph), worldOf(data, graph, s));
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

/**
 * Effects written in text run one by one; one that is broken is skipped (the checks report it) rather
 * than stopping the playthrough, as a broken condition counts as false.
 */
function runTextEffects(data: ProjectData, s: PlayState, graph: string, codes: string[], at: NodeRef): PlayState {
  if (!codes.length) return s;
  const registry = asRegistry(registryFor(data, graph));
  for (const code of codes) {
    // Checked first: an effect of the wrong type would otherwise spoil the value instead of failing.
    if (checkEffects(code, registry)) continue;
    const next = runEffects(data, s, graph, code, at);
    if (next.status === 'running') s = next;
  }
  return s;
}

/** Effects written in a node's description and comment ("{x = 1}", see textEffects.ts); lines go one by one. */
function nodeTextEffects(data: ProjectData, graph: string, node: StoryNode): string[] {
  if (!node.text && !node.comment) return [];
  const reg = registryFor(data, graph);
  const known = (name: string) => reg.has(name);
  return [...textPieces(node.text, known).effects, ...textPieces(node.comment, known).effects].map((e) => e.code);
}

/**
 * The lines of a dialogue node as the player gets them, in order (0.8): a line whose condition does not hold
 * is skipped; a line shown is remembered as seen, then its effects (written in the text, then its own) and
 * its actions happen, so a later line can depend on an earlier one.
 */
function sayLines(data: ProjectData, s0: PlayState, at: NodeRef, lines: DialogueLine[]): PlayState {
  let s: PlayState = { ...s0, shown: [] };
  for (const l of lines) {
    if (!holds(data, at.graph, l.condition, s)) continue;
    s = { ...s, shown: [...s.shown, l.id], seen: s.seen.includes(l.id) ? s.seen : [...s.seen, l.id] };
    s = runTextEffects(
      data,
      s,
      at.graph,
      textPieces(l.text).effects.map((e) => e.code),
      at,
    );
    if (!isBlank(l.effects)) {
      const next = runEffects(data, s, at.graph, l.effects, at);
      if (next.status === 'running') s = next;
    }
    s = runActions(data, s, l.actions, at);
  }
  return s;
}

/** Effects written in an option's text (braced only: the player reads it) and in its comment. */
function optionTextEffects(data: ProjectData, graph: string, option: { text: string; note?: string }): string[] {
  const reg = registryFor(data, graph);
  return [...textPieces(option.text).effects, ...textPieces(option.note, (n) => reg.has(n)).effects].map((e) => e.code);
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
  return edgesFrom(g, at.node, port).filter((e) => holds(data, at.graph, e.condition, s));
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
      s = { ...s, shown: [], log: [...s.log, { kind: 'arrive', at, title: node.title, nodeKind: node.kind }] };
      s = runTextEffects(data, s, at.graph, nodeTextEffects(data, at.graph, node), at);
      if (node.lines?.length) s = sayLines(data, s, at, node.lines);
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
      const done = runEffects(data, s, at.graph, node.effects, at);
      const after = done.status === 'running' ? runActions(data, done, node.actions, at) : done;
      return after.status === 'running' ? single(data, after, at) : { s: after, stop: true };
    }
    case 'start':
      return single(data, s, at);
    case 'condition': {
      const result = holds(data, at.graph, node.expr, s);
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
    items: [],
    hired: [],
    seen: [],
    lists: {},
    shown: [],
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
    return (
      (asStory(node).options ?? [])
        // "Show once": gone after it was chosen (0.8).
        .filter((o) => !(o.once && s.seen.includes(o.id)))
        .map((o) => ({
          kind: 'option',
          id: o.id,
          label: o.text,
          enabled: holds(data, s.pos!.graph, o.condition, s),
          ...(o.secret ? { secret: true } : {}),
        }))
    );
  }
  if (node.kind === 'give' && !s.leaving) {
    // Any item the hero has can be handed over; with none, the game goes the "nothing to give" way.
    const items = s.items.filter((id) => data.entities[id]);
    return [
      ...items.map((id) => ({
        kind: 'give' as const,
        port: 'given' as const,
        item: id,
        label: entityName(data, id) ?? '',
      })),
      items.length ? { kind: 'give', port: 'cancel', label: '' } : { kind: 'give', port: 'empty', label: '' },
    ];
  }
  if (PASS_THROUGH.has(node.kind) && !s.leaving && node.kind !== 'start' && node.kind !== 'effect') return [];
  const lineIds = new Set((node.kind === 'dialogue' ? node.lines : undefined)?.map((l) => l.id));
  return (
    openExits(data, s, s.pos)
      // An interrupted line the player did not get (its condition) cannot be interrupted.
      .filter((e) => !lineIds.has(e.from.port) || s.shown.includes(e.from.port))
      .map((e) => ({
        kind: 'exit',
        edge: e.id,
        label: e.label || titleOf(data, { graph: s.pos!.graph, node: e.to.node }),
        to: { graph: s.pos!.graph, node: e.to.node },
        ...(lineIds.has(e.from.port) ? { interrupt: e.from.port } : {}),
      }))
  );
}

/** Takes an action; the previous state stays valid for "step back". */
export function playAct(data: ProjectData, s: PlayState, action: PlayAction): PlayState {
  if (s.status !== 'running' || !s.pos) return s;
  const at = s.pos;
  if (action.kind === 'option') {
    const node = findNode(data, at);
    const option = node?.options?.find((o) => o.id === action.id);
    if (!option || !holds(data, at.graph, option.condition, s)) return s;
    let next: PlayState = {
      ...s,
      seen: s.seen.includes(option.id) ? s.seen : [...s.seen, option.id],
      log: [...s.log, { kind: 'option', at, text: option.text }],
    };
    next = runEffects(data, next, at.graph, option.effects, at);
    if (next.status !== 'running') return next;
    next = runTextEffects(data, next, at.graph, optionTextEffects(data, at.graph, option), at);
    next = runActions(data, next, option.actions, at);
    const exit = openExits(data, next, at, option.id)[0];
    if (!exit) return fail(next, 'deadEnd', { node: option.text || node?.title || '' });
    return arrive(data, next, { graph: at.graph, node: exit.to.node });
  }
  if (action.kind === 'give') return give(data, s, at, action);
  const logged: PlayState = { ...s, log: [...s.log, { kind: 'exit', at, label: action.label }] };
  return arrive(data, logged, action.to);
}

/** A give node (0.8): the item leaves the hero and is written where the node says; then its exit. */
function give(data: ProjectData, s: PlayState, at: NodeRef, action: Extract<PlayAction, { kind: 'give' }>): PlayState {
  const node = findNode(data, at);
  if (!node) return s;
  let next = s;
  if (action.port === 'given' && action.item) {
    const item = action.item;
    const vars = { ...next.vars };
    const store = listVariables(data).find((v) => v.id === node.store);
    if (store) vars[store.id] = store.type === 'entity' ? item : (entityName(data, item) ?? '');
    const lists = node.keep ? { ...next.lists, [node.keep]: [...(next.lists[node.keep] ?? []), item] } : next.lists;
    next = {
      ...next,
      vars,
      lists,
      items: next.items.filter((id) => id !== item),
      log: [...next.log, { kind: 'gave', at, name: entityName(data, item) ?? '' }],
    };
    next = runEffects(data, next, at.graph, node.effects, at);
    if (next.status !== 'running') return next;
    next = runActions(data, next, node.actions, at);
  }
  // "Nothing to give" left unconnected goes where "refused" goes.
  const exit =
    openExits(data, next, at, action.port)[0] ??
    (action.port === 'empty' ? openExits(data, next, at, 'cancel')[0] : undefined);
  if (!exit) return fail(next, 'deadEnd', { node: node.title });
  return arrive(data, next, { graph: at.graph, node: exit.to.node });
}

/** Puts an item into the hero's hands or takes it away by hand, from the playthrough panel (0.8). */
export function playSetItem(s: PlayState, item: string, has: boolean): PlayState {
  const items = has ? (s.items.includes(item) ? s.items : [...s.items, item]) : s.items.filter((id) => id !== item);
  return { ...s, items };
}

/** Sets a variable by hand from the playthrough panel. */
export function playSetVariable(s: PlayState, variable: Variable, value: Value | null): PlayState {
  return {
    ...s,
    vars: { ...s.vars, [variable.id]: value },
    log: [...s.log, { kind: 'manual', name: variable.name, value }],
  };
}
