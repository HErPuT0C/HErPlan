// Search over the lines of the story (0.8, item 22 of "Dialogues"): lines and choice options found by their
// words, by who speaks, and by what they use — a variable, an item or a character, wherever it is named:
// the speaker, "to whom", conditions and effects (есть(), нанят(), непусто() too), game actions, what a give
// node writes to. Nodes that use it without a line of their own (conditions, effects, give) are found too.

import { searchKey } from '../canvas/ops';
import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { callsIn, namesInCondition, namesInEffects } from './expr';
import { entityByName } from './game';
import { allGraphs, asStory, textMarks, toward, type GameAction, type StoryNode } from './model';
import { textPieces } from './textEffects';
import { listsFor, registryFor } from './variables';

/** What a line may use: a variable, or a card of the database (a character, an item…). */
export type UseTarget = { kind: 'variable'; id: string } | { kind: 'entity'; id: string };

/** Why a line uses it. */
export type UseReason = 'speaker' | 'to' | 'condition' | 'effects' | 'text' | 'action' | 'store' | 'keep';

export interface LineQuery {
  /** Words of the line or option (case and ё do not matter). */
  text?: string;
  /** Only lines this character says (an entity id). */
  speaker?: string | null;
  uses?: UseTarget | null;
  /** Only this graph; absent: the whole project. */
  graph?: string | null;
}

export interface LineHit {
  graph: string;
  node: string;
  /** The line or option; absent: the node itself (a condition, an effect, a give node). */
  part?: { kind: 'line' | 'option'; id: string };
  text: string;
  speaker: string | null;
  reasons: UseReason[];
}

/** At most this many are returned: the rest are narrowed down by more words. */
export const SEARCH_LIMIT = 500;

const hasWords = (q: LineQuery) => !!q.text?.trim();

/** Whether a query asks anything at all (an empty one finds nothing rather than everything). */
export const isEmptyQuery = (q: LineQuery): boolean => !hasWords(q) && !q.speaker && !q.uses;

interface Ctx {
  data: ProjectData;
  target: UseTarget;
  /** Names a variable or a card is written by in expressions of the graph. */
  varNames: Set<string>;
  listNames: Set<string>;
}

/** Does an expression of the graph use the target. */
function exprUses(ctx: Ctx, source: string | undefined, kind: 'condition' | 'effects'): boolean {
  if (!source?.trim()) return false;
  const names =
    kind === 'condition'
      ? namesInCondition(source)
      : (({ writes, reads }) => [...writes, ...reads])(namesInEffects(source));
  if (names.some((n) => ctx.varNames.has(n))) return true;
  for (const c of callsIn(source, kind)) {
    if (c.fn === 'notEmpty' && ctx.listNames.has(c.arg)) return true;
    if (ctx.target.kind === 'entity' && (c.fn === 'has' || c.fn === 'hired')) {
      if (entityByName(ctx.data, c.fn === 'has' ? 'item' : 'character', c.arg) === ctx.target.id) return true;
    }
  }
  return false;
}

function actionsUse(ctx: Ctx, list: GameAction[] | undefined): boolean {
  return (list ?? []).some((a) => a.ref === ctx.target.id || a.item === ctx.target.id);
}

/** Effects written in braces in a text ("{страх = 1}"). */
function textUses(ctx: Ctx, text: string | undefined): boolean {
  return textPieces(text).effects.some((e) => exprUses(ctx, e.code, 'effects'));
}

function context(data: ProjectData, g: GraphDoc, target: UseTarget): Ctx {
  const varNames = new Set<string>();
  const listNames = new Set<string>();
  for (const [name, entry] of registryFor(data, g.id)) {
    const v = entry.variable;
    // A card is used by its own variables too ("Мира.доверие").
    if (target.kind === 'variable' ? v.id === target.id : v.owner?.id === target.id) varNames.add(name);
  }
  for (const [name, v] of listsFor(data, g.id)) {
    if (target.kind === 'variable' ? v.id === target.id : v.owner?.id === target.id) listNames.add(name);
  }
  return { data, target, varNames, listNames };
}

export function searchLines(data: ProjectData, q: LineQuery): LineHit[] {
  if (isEmptyQuery(q)) return [];
  const words = searchKey(q.text?.trim() ?? '');
  const out: LineHit[] = [];
  const graphs = allGraphs(data).filter(
    (g) => (q.graph ? g.id === q.graph : true) && (g.kind === 'story' || g.kind === 'chapter' || g.kind === 'barks'),
  );
  for (const g of graphs) {
    const ctx = q.uses ? context(data, g, q.uses) : null;
    const id = q.uses?.id;
    for (const raw of g.nodes) {
      const n = asStory(raw);
      for (const l of n.lines ?? []) {
        if (q.speaker && l.speaker !== q.speaker) continue;
        if (words && !searchKey(l.text).includes(words)) continue;
        const reasons: UseReason[] = [];
        if (ctx) {
          if (q.uses?.kind === 'entity') {
            if (l.speaker === id) reasons.push('speaker');
            const cueTo = textMarks(n).some(
              (m) =>
                m.device === 'cue' &&
                m.anchor.kind === 'line' &&
                m.anchor.id === l.id &&
                (toward(m.props.gesture)?.to === id || toward(m.props.emote)?.to === id),
            );
            if (toward(l.gesture)?.to === id || toward(l.emote)?.to === id || cueTo) reasons.push('to');
          }
          if (exprUses(ctx, l.condition, 'condition')) reasons.push('condition');
          if (exprUses(ctx, l.effects, 'effects')) reasons.push('effects');
          if (textUses(ctx, l.text)) reasons.push('text');
          if (actionsUse(ctx, l.actions)) reasons.push('action');
          if (!reasons.length) continue;
        }
        out.push({
          graph: g.id,
          node: n.id,
          part: { kind: 'line', id: l.id },
          text: l.text,
          speaker: l.speaker,
          reasons,
        });
      }
      // Options are said by the player: a speaker filter leaves them out.
      if (!q.speaker) {
        for (const o of n.options ?? []) {
          if (words && !searchKey(o.text).includes(words)) continue;
          const reasons: UseReason[] = [];
          if (ctx) {
            if (exprUses(ctx, o.condition, 'condition')) reasons.push('condition');
            if (exprUses(ctx, o.effects, 'effects')) reasons.push('effects');
            if (textUses(ctx, o.text) || textUses(ctx, o.note)) reasons.push('text');
            if (actionsUse(ctx, o.actions)) reasons.push('action');
            if (!reasons.length) continue;
          }
          out.push({
            graph: g.id,
            node: n.id,
            part: { kind: 'option', id: o.id },
            text: o.text,
            speaker: null,
            reasons,
          });
        }
      }
      // The node itself, when it uses the target and has no lines to show it by.
      if (ctx && !words && !q.speaker) {
        const reasons = nodeReasons(ctx, n);
        if (reasons.length) out.push({ graph: g.id, node: n.id, text: n.title, speaker: null, reasons });
      }
      if (out.length >= SEARCH_LIMIT) return out.slice(0, SEARCH_LIMIT);
    }
    // Edges of the graph with a condition that uses it: found by the node they leave.
    if (ctx && !words && !q.speaker) {
      for (const e of g.edges) {
        if (!exprUses(ctx, e.condition, 'condition')) continue;
        if (out.some((h) => h.graph === g.id && h.node === e.from.node && !h.part)) continue;
        const from = g.nodes.find((x) => x.id === e.from.node);
        if (from) out.push({ graph: g.id, node: from.id, text: from.title, speaker: null, reasons: ['condition'] });
      }
    }
  }
  return out.slice(0, SEARCH_LIMIT);
}

function nodeReasons(ctx: Ctx, n: StoryNode): UseReason[] {
  const reasons: UseReason[] = [];
  if (n.kind === 'condition' && exprUses(ctx, n.expr, 'condition')) reasons.push('condition');
  if ((n.kind === 'effect' || n.kind === 'give' || n.kind === 'butterfly') && exprUses(ctx, n.effects, 'effects')) {
    reasons.push('effects');
  }
  if (actionsUse(ctx, n.actions)) reasons.push('action');
  if (n.kind === 'give') {
    if (n.store === ctx.target.id) reasons.push('store');
    if (n.keep === ctx.target.id) reasons.push('keep');
  }
  return reasons;
}
