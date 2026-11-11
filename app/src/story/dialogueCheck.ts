// "Check the dialogue" (0.8): everything the game will stumble over when a conversation is carried over
// into it, on top of the story checks of that conversation. Run by a button, for one graph: names in the
// game, lines, exits, the palette, who is spoken to.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { checkProject, problem, type Problem, type ProblemCode } from './checks';
import { callsIn } from './expr';
import { edgesFrom } from './flow';
import { entityByName, entityGame } from './game';
import { graphKey, isGameKey, keyOf } from './gameKey';
import { asStory, graphOf, textMarks, toward, type GameAction, type StoryNode, type TowardValue } from './model';
import { notInPalette, type Palette, type PaletteList } from './palette';
import type { ImportInfo } from './transfer';
import { graphExpressions, knownNames, variableUsage } from './usage';
import { listVariables } from './variables';

/** Story problems that matter to the game, of all that checkProject finds. */
const FROM_STORY: ReadonlySet<ProblemCode> = new Set([
  'noStart',
  'unreachable',
  'deadEnd',
  'optionNoExit',
  'conditionNoBranch',
  'giveNoExit',
  'exprError',
  'unknownVar',
  'tooManyLines',
  'lineTooLong',
  'jumpNoTarget',
  'chapterNoGraph',
]);

/** Which entity an action needs, by its kind. */
const ACTION_REF: Partial<Record<GameAction['type'], 'item' | 'character' | 'list'>> = {
  give_item: 'item',
  take_item: 'item',
  hire: 'character',
  dismiss: 'character',
  list_add: 'list',
  give_list: 'list',
};

export function checkConversation(
  data: ProjectData,
  graphId: string,
  palette: Palette,
  imported?: ImportInfo,
): Problem[] {
  const g = graphOf(data, graphId);
  if (!g) return [];
  const out: Problem[] = [];
  const here = { graph: graphId };
  const flow = g.kind !== 'barks';

  // The conversation's own name.
  const key = graphKey(g);
  if (!key) out.push(problem('noGraphKey', here));
  else if (!isGameKey(key)) out.push(problem('badKey', here, { key }));

  out.push(...checkProject(data).filter((p) => p.graph === graphId && FROM_STORY.has(p.code)));

  const speakers = new Set<string>();
  for (const raw of g.nodes) for (const l of asStory(raw).lines ?? []) if (l.speaker) speakers.add(l.speaker);

  // What the conversation refers to must have names in the game too.
  const entities = new Set<string>();
  const variables = new Set<string>();
  const palettes: { list: PaletteList; id: string | undefined | null; node: string; line?: string }[] = [];
  const faceOf: { face: string; speaker: string | null; node: string; line: string }[] = [];

  const towards = (v: TowardValue | undefined, list: PaletteList, node: string, line: string) => {
    const x = toward(v);
    if (!x) return;
    palettes.push({ list, id: x.id, node, line });
    if (!x.to) return;
    entities.add(x.to);
    if (!speakers.has(x.to)) {
      out.push(
        problem(
          'towardOutsider',
          { ...here, node, line },
          { name: nameOf(data, x.to), line: lineNumber(g, node, line) },
        ),
      );
    }
  };
  const actions = (list: GameAction[] | undefined, node: string, part: { line?: string; option?: string }) => {
    for (const a of list ?? []) {
      const need = ACTION_REF[a.type];
      if (need && (!a.ref || (need === 'list' ? !isList(data, a.ref) : !data.entities[a.ref]))) {
        out.push(problem('actionNoRef', { ...here, node, ...part }, { title: titleOf(g, node), action: a.type }));
      } else if (need === 'list') variables.add(a.ref!);
      else if (need) entities.add(a.ref!);
      if (a.type === 'list_add' && a.item) entities.add(a.item);
      if ((a.type === 'event' || a.type === 'start_quest') && !a.value?.trim()) {
        out.push(problem('actionNoRef', { ...here, node, ...part }, { title: titleOf(g, node), action: a.type }));
      }
    }
  };

  for (const raw of g.nodes) {
    const n = asStory(raw);
    const at = { ...here, node: n.id };
    if (n.kind === 'dialogue') {
      (n.lines ?? []).forEach((l, i) => {
        const where = { ...at, line: l.id };
        if (!l.text.trim()) out.push(problem('lineEmpty', where, { title: n.title, line: i + 1 }));
        if (!l.speaker) out.push(problem('lineNoSpeaker', where, { title: n.title, line: i + 1 }));
        else entities.add(l.speaker);
        palettes.push({ list: 'styles', id: l.style, node: n.id, line: l.id });
        palettes.push({ list: 'faces', id: l.face, node: n.id, line: l.id });
        if (l.face) faceOf.push({ face: l.face, speaker: l.speaker, node: n.id, line: l.id });
        towards(l.gesture, 'gestures', n.id, l.id);
        towards(l.emote, 'emotes', n.id, l.id);
        actions(l.actions, n.id, { line: l.id });
      });
      for (const m of textMarks(n)) {
        if (m.anchor.kind !== 'line') continue;
        const line = m.anchor.id;
        const speaker = n.lines?.find((l) => l.id === line)?.speaker ?? null;
        if (m.device === 'style') {
          palettes.push({ list: 'styles', id: m.props.style, node: n.id, line });
          palettes.push({ list: 'sizes', id: m.props.size, node: n.id, line });
          palettes.push({ list: 'effects', id: m.props.effect, node: n.id, line });
          palettes.push({ list: 'reveals', id: m.props.reveal, node: n.id, line });
        } else {
          palettes.push({ list: 'sounds', id: m.props.sound, node: n.id, line });
          palettes.push({ list: 'faces', id: m.props.face, node: n.id, line });
          if (m.props.face) faceOf.push({ face: m.props.face, speaker, node: n.id, line });
          towards(m.props.gesture, 'gestures', n.id, line);
          towards(m.props.emote, 'emotes', n.id, line);
        }
      }
    }
    if (n.kind === 'choice') checkChoice(n, at, out);
    for (const o of n.options ?? []) actions(o.actions, n.id, { option: o.id });
    if (n.kind === 'effect' || n.kind === 'give') actions(n.actions, n.id, {});
    if (n.kind === 'give') {
      if (n.store) variables.add(n.store);
      if (n.keep) variables.add(n.keep);
    }
  }

  // Names inside есть() and нанят(), and the variables of every expression here.
  for (const site of graphExpressions(g, knownNames(data, graphId))) {
    for (const c of callsIn(site.source, site.kind)) {
      const id =
        c.fn === 'has'
          ? entityByName(data, 'item', c.arg)
          : c.fn === 'hired'
            ? entityByName(data, 'character', c.arg)
            : null;
      if (id) entities.add(id);
    }
  }
  for (const [id, uses] of variableUsage(data)) if (uses.some((u) => u.site.graph === graphId)) variables.add(id);

  for (const id of entities) {
    const e = data.entities[id];
    if (e && !keyOf(e)) out.push(problem('refNoKey', here, { what: 'entity', name: nameOf(data, id), id }));
  }
  const vars = new Map(listVariables(data).map((v) => [v.id, v]));
  for (const id of variables) {
    const v = vars.get(id);
    if (v && !v.key) out.push(problem('refNoKey', { ...here, variable: id }, { what: 'variable', name: v.name, id }));
  }

  // Ids the palette does not have; voices and bubbles of those who speak.
  const said = new Set<string>();
  for (const p of palettes) {
    if (!notInPalette(palette, p.list, p.id)) continue;
    const mark = `${p.list}/${p.id}/${p.node}/${p.line ?? ''}`;
    if (said.has(mark)) continue;
    said.add(mark);
    out.push(
      problem(
        'notInPalette',
        { ...here, node: p.node, ...(p.line ? { line: p.line } : {}) },
        { list: p.list, id: p.id!, title: titleOf(g, p.node) },
      ),
    );
  }
  for (const id of speakers) {
    const game = entityGame(data.entities[id]);
    for (const [list, value] of [
      ['voices', game.voice],
      ['bubbles', game.bubble],
    ] as const) {
      if (notInPalette(palette, list, value)) {
        out.push(problem('notInPalette', here, { list, id: value, title: nameOf(data, id) }));
      }
    }
    for (const face of game.faces) {
      if (notInPalette(palette, 'faces', face)) {
        out.push(problem('notInPalette', here, { list: 'faces', id: face, title: nameOf(data, id) }));
      }
    }
  }
  // A face the speaker is not drawn with (cards that list no faces say nothing).
  for (const f of faceOf) {
    if (!f.speaker) continue;
    const faces = entityGame(data.entities[f.speaker]).faces;
    if (faces.length && !faces.includes(f.face)) {
      out.push(
        problem(
          'faceNotDrawn',
          { ...here, node: f.node, line: f.line },
          { name: nameOf(data, f.speaker), face: f.face, line: lineNumber(g, f.node, f.line) },
        ),
      );
    }
  }

  if (flow)
    for (const node of emptyCycles(data, g))
      out.push(problem('emptyCycle', { ...here, node }, { title: titleOf(g, node) }));

  // What the game side said when it carried the conversation over.
  for (const p of imported?.problems ?? []) {
    out.push(
      problem(
        'gameSaid',
        { ...here, ...(p.node ? { node: p.node } : {}), ...(p.line ? { line: p.line } : {}) },
        { text: p.text },
      ),
    );
  }
  return out;
}

function checkChoice(n: StoryNode, at: { graph: string; node: string }, out: Problem[]): void {
  const options = n.options ?? [];
  const shown = options.filter((o) => !o.secret);
  const secrets = options.length - shown.length;
  if (secrets > 1) out.push(problem('manySecrets', at, { title: n.title }));
  if (secrets > 0 && !n.timer) out.push(problem('secretNoTimer', at, { title: n.title }));
  // Every option the player sees may be closed by its condition, and nothing is left to choose.
  if (shown.length > 0 && shown.every((o) => o.condition.trim() !== '')) {
    out.push(problem('choiceNoFallback', at, { title: n.title }));
  }
}

const isList = (data: ProjectData, id: string): boolean =>
  listVariables(data).some((v) => v.id === id && v.type === 'list');

const nameOf = (data: ProjectData, id: string): string => {
  const e = data.entities[id];
  return e && typeof e.name === 'string' ? e.name : '';
};

const titleOf = (g: GraphDoc, node: string): string => g.nodes.find((n) => n.id === node)?.title ?? '';

function lineNumber(g: GraphDoc, node: string, line: string): number {
  const n = g.nodes.find((x) => x.id === node);
  return ((n && asStory(n).lines) ?? []).findIndex((l) => l.id === line) + 1;
}

/** Kinds the player stops at: a cycle through any of them is a conversation, not a trap. */
function stops(n: StoryNode): boolean {
  if (n.kind === 'dialogue') return (n.lines?.length ?? 0) > 0;
  return n.kind === 'choice' || n.kind === 'give' || n.kind === 'scene' || n.kind === 'chapter';
}

/**
 * Cycles the game would spin in forever: through nodes that show nothing and ask nothing (conditions,
 * effects, jumps inside the graph, dialogues without lines). One node of each cycle.
 */
function emptyCycles(data: ProjectData, g: GraphDoc): string[] {
  const silent = new Map(g.nodes.filter((n) => !stops(asStory(n))).map((n) => [n.id, asStory(n)]));
  const next = (id: string): string[] => {
    const n = silent.get(id)!;
    const to = edgesFrom(g, id).map((e) => e.to.node);
    if (n.kind === 'jump' && n.target?.graph === g.id) to.push(n.target.node);
    return to.filter((t) => silent.has(t));
  };
  const state = new Map<string, 1 | 2>();
  const found: string[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const to of next(id)) {
      if (state.get(to) === 1) found.push(to);
      else if (!state.has(to)) visit(to);
    }
    state.set(id, 2);
  };
  // An explicit stack would be longer; graphs of silent nodes are small.
  for (const id of silent.keys()) if (!state.has(id)) visit(id);
  void data;
  return [...new Set(found)];
}
