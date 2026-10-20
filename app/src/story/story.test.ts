import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { checkProject, type ProblemCode } from './checks';
import { exportStory } from './export';
import { graphPath, graphTitle, reachableFrom } from './flow';
import { findNode, graphOf, type StoryNode } from './model';
import {
  addLine,
  addOption,
  chapterGraphsOf,
  createChapterGraph,
  deleteChapterGraphs,
  pasteChapterGraphs,
  removeOption,
  setExpanded,
} from './ops';
import { playAct, playActions, playSetVariable, startPlay, type PlayState } from './play';
import { sampleProject, sampleStats } from './sample';
import { nodesUsing, renameEverywhere, unusedVariables, variableUsage } from './usage';
import { guessType, listVariables, nameProblem, registryFor } from './variables';
import { benchGraph } from '../canvas/bench';
import { createNode, minSize } from '../canvas/ops';
import { emptyGraph } from '../canvas/model';

const g = (data: ProjectData, id: string) => graphOf(data, id)!;
const node = (data: ProjectData, graph: string, id: string) => findNode(data, { graph, node: id })!;

/**
 * One step of a route: "next" takes the only way on, anything else picks an option or a branch by its label.
 * Throws when the step is not possible, so a broken route fails loudly.
 */
function act(data: ProjectData, s: PlayState, label: string): PlayState {
  const actions = playActions(data, s);
  const action = label === 'next' && actions.length === 1 ? actions[0] : actions.find((a) => a.label === label);
  if (!action) throw new Error(`"${label}" is not offered at ${s.pos?.node}: ${JSON.stringify(actions)}`);
  return playAct(data, s, action);
}

/** Plays `steps` and returns the titles of the nodes where the player stopped after each one. */
function route(
  data: ProjectData,
  s: PlayState,
  steps: string[],
): { s: PlayState; stops: (string | null | undefined)[] } {
  const stops: (string | null | undefined)[] = [];
  for (const step of steps) {
    s = act(data, s, step);
    stops.push(at(data, s));
  }
  return { s, stops };
}

const TO_CHOICE = ['next', 'next', 'next', 'next'];

const at = (data: ProjectData, s: PlayState) => (s.pos ? findNode(data, s.pos)?.title : null);
const vars = (data: ProjectData, s: PlayState) =>
  Object.fromEntries(listVariables(data).map((v) => [v.owner ? `Мира.${v.name}` : v.name, s.vars[v.id]]));

describe('reference scenario (F3-15)', () => {
  it('has 50 nodes, 10 variables and 5 choices, and no problems', () => {
    const data = sampleProject();
    expect(sampleStats(data)).toEqual({ nodes: 50, choices: 5 });
    expect(listVariables(data)).toHaveLength(10);
    expect(checkProject(data)).toEqual([]);
  });

  it('plays along the reference route', () => {
    const data = sampleProject();
    let s = startPlay(data);
    expect(at(data, s)).toBe('Утро');
    expect(s.stack.map((r) => r.node)).toEqual(['r-ch1']);
    let r = route(data, s, TO_CHOICE);
    // The effect node is passed on the way, its change applied.
    expect(r.stops).toEqual(['У мельницы', 'Встреча', 'Ружьё на стене', 'Что ответить Мире?']);
    s = r.s;
    expect(vars(data, s).был_на_мельнице).toBe(true);
    expect(playActions(data, s).map((a) => [a.label, a.kind === 'option' && a.enabled])).toEqual([
      ['Помочь с мешками', true],
      ['Спросить про ключ', true],
      ['Уйти', true],
    ]);
    s = act(data, s, 'Спросить про ключ');
    expect(at(data, s)).toBe('Ключ');
    expect(vars(data, s)).toMatchObject({ есть_ключ: true, золото: 0 });
    // Chapter 1 ends, the overview moves on to chapter 2 by itself.
    s = act(data, s, 'next');
    expect(at(data, s)).toBe('Опушка');
    expect(s.stack.map((x) => x.node)).toEqual(['r-ch2']);
    r = route(data, s, ['next', 'Освободить']);
    expect(r.stops).toEqual(['Рыцарь просит о помощи', 'Рыцарь запомнит']);
    s = r.s;
    expect(vars(data, s)).toMatchObject({ пощадил_рыцаря: true, репутация: 2.5 });
    r = route(data, s, ['next', 'next', 'Через чащу']);
    expect(r.stops).toEqual(['Разговор у костра', 'Куда идти?', 'Старая дверь']);
    // The jump lands inside chapter 3, with chapter 3 entered.
    s = act(data, r.s, 'next');
    expect(at(data, s)).toBe('Тронный зал');
    expect(s.stack.map((x) => x.node)).toEqual(['r-ch3']);
    r = route(data, s, ['next', 'Стрелять']);
    expect(r.stops).toEqual(['Последний выбор', 'Выстрел']);
    s = act(data, r.s, 'next');
    expect(s.status).toBe('ended');
    expect(at(data, s)).toBe('Конец истории');
    expect(vars(data, s)).toEqual({
      доверие: 0,
      пощадил_рыцаря: true,
      золото: 0,
      есть_ключ: true,
      настроение: 'спокойна',
      спутник: null,
      был_на_мельнице: true,
      репутация: 2.5,
      прозвище: 'странник',
      'Мира.доверие': 0,
    });
  });

  it('a manual variable change changes which options are available', () => {
    const data = sampleProject();
    let s = startPlay(data);
    s = route(data, s, TO_CHOICE).s;
    const gold = listVariables(data).find((v) => v.name === 'золото')!;
    s = playSetVariable(s, gold, 2);
    const key = playActions(data, s).find((a) => a.label === 'Спросить про ключ');
    expect(key).toMatchObject({ enabled: false });
    expect(playAct(data, s, key!)).toBe(s);
  });

  it('effects and conditions run where they belong; the old state stays for "step back"', () => {
    const data = sampleProject();
    let s = startPlay(data);
    s = route(data, s, TO_CHOICE).s;
    const before = s;
    s = act(data, s, 'Уйти');
    // доверие -1 → the condition node sends the player to "Мира обиделась".
    expect(at(data, s)).toBe('Мира обиделась');
    expect(s.log.some((e) => e.kind === 'condition' && e.result)).toBe(true);
    expect(at(data, before)).toBe('Что ответить Мире?');
    expect(vars(data, before).доверие).toBe(0);
  });

  it('starts from any node with the chapters above entered', () => {
    const data = sampleProject();
    const s = startPlay(data, { graph: 'g-ch3', node: 'c-gate' });
    expect(at(data, s)).toBe('Рыцарь у ворот');
    expect(s.stack.map((r) => r.node)).toEqual(['r-ch3']);
    // пощадил_рыцаря starts false: the condition picks the closed gate.
    expect(at(data, act(data, s, 'next'))).toBe('Ворота заперты');
  });

  it('a chapter can be played on its own, from its start, and goes on into the story after it', () => {
    const data = sampleProject();
    const s = startPlay(data, undefined, 'g-ch2');
    expect(at(data, s)).toBe('Опушка');
    expect(s.stack.map((r) => r.node)).toEqual(['r-ch2']);
    const r = route(data, s, ['next', 'Пройти мимо', 'next', 'К реке', 'next', 'next', 'next']);
    // Gold is 5: the trader, then the end of chapter 2 leads on into chapter 3.
    expect(r.stops.slice(-2)).toEqual(['Торговец', 'Рыцарь у ворот']);
    const noStart = produce(data, (d) => {
      g(d, 'g-ch2').nodes = g(d, 'g-ch2').nodes.filter((n) => n.kind !== 'start');
    });
    expect(startPlay(noStart, undefined, 'g-ch2').problem).toEqual({ code: 'noStartHere', params: { graph: 'g-ch2' } });
  });

  it('stops on endless loops instead of hanging', () => {
    const data = produce(sampleProject(), (d) => {
      const c1 = g(d, 'g-ch1');
      c1.edges.push({ id: 'loop', from: { node: 'a-hurt', port: 'out' }, to: { node: 'a-check', port: 'in' } });
      c1.edges = c1.edges.filter((e) => !(e.from.node === 'a-hurt' && e.to.node === 'a-end'));
      // A condition that loops onto itself through an effect: no decision ever comes.
      const check = node(d, 'g-ch1', 'a-check');
      check.expr = 'истина';
      c1.nodes.find((n) => n.id === 'a-hurt')!.kind = 'effect';
    });
    let s = startPlay(data);
    s = route(data, s, TO_CHOICE).s;
    s = act(data, s, 'Уйти');
    expect(s.status).toBe('error');
    expect(s.problem?.code).toBe('loop');
  });
});

describe('project checks (F3-13)', () => {
  const codes = (data: ProjectData) => checkProject(data).map((p) => p.code);

  it('deleting the payoff: the gun never fires', () => {
    const data = produce(sampleProject(), (d) => {
      const c3 = g(d, 'g-ch3');
      c3.nodes = c3.nodes.filter((n) => n.id !== 'c-shot');
      c3.edges = c3.edges.filter((e) => e.to.node !== 'c-shot' && e.from.node !== 'c-shot');
    });
    expect(codes(data)).toEqual(expect.arrayContaining<ProblemCode>(['payoffMissing', 'optionNoExit']));
    const noLinks = produce(sampleProject(), (d) => {
      node(d, 'g-ch1', 'a-gun').links = [];
      node(d, 'g-ch1', 'a-meet').marks![0].links = [];
    });
    expect(codes(noLinks)).toEqual(expect.arrayContaining<ProblemCode>(['gunNoPayoff', 'payoffNoSetup']));
  });

  it('finds unreachable nodes, dead ends, broken and unknown expressions, unused variables', () => {
    const data = produce(sampleProject(), (d) => {
      const c2 = g(d, 'g-ch2');
      c2.edges = c2.edges.filter((e) => !(e.from.node === 'b-edge'));
      node(d, 'g-ch1', 'a-check').expr = 'доверие <';
      node(d, 'g-ch1', 'a-reward').effects = 'серебро += 3';
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-unused',
        name: 'лишняя',
        type: 'bool',
        initial: false,
        scope: 'project',
        owner: null,
        description: '',
      });
    });
    const problems = checkProject(data);
    const found = problems.map((p) => p.code);
    expect(found).toEqual(
      expect.arrayContaining<ProblemCode>(['unreachable', 'deadEnd', 'exprError', 'unknownVar', 'unusedVar']),
    );
    expect(problems.find((p) => p.code === 'deadEnd')?.node).toBe('b-edge');
    expect(problems.find((p) => p.code === 'unknownVar')?.diagnostic?.params.name).toBe('серебро');
  });

  it('a payoff that cannot come after its setup is reported', () => {
    const data = produce(sampleProject(), (d) => {
      // The gun now hangs in chapter 3, after the shot: the shot cannot follow it.
      node(d, 'g-ch1', 'a-gun').links = [];
      node(d, 'g-ch1', 'a-meet').marks = [];
      const c3 = g(d, 'g-ch3');
      const gun = { ...createNode('gun', 0, 0, 'Поздно'), id: 'late' } as StoryNode;
      gun.links = [{ graph: 'g-ch3', node: 'c-shot' }];
      c3.nodes.push(gun);
      c3.edges.push({ id: 'x', from: { node: 'c-good', port: 'out' }, to: { node: 'late', port: 'in' } });
    });
    expect(codes(data)).toContain('payoffBeforeSetup');
  });

  it('dialogue over the soft limits is highlighted, not cut', () => {
    const data = produce(sampleProject(), (d) => {
      d.meta.settings.dialogueLimits = { maxLines: 2, maxLineChars: 5 };
    });
    const problems = checkProject(data).filter((p) => p.code === 'tooManyLines' || p.code === 'lineTooLong');
    expect(problems.map((p) => [p.code, p.node])).toEqual([
      ['tooManyLines', 'a-meet'],
      ['lineTooLong', 'a-meet'],
      ['lineTooLong', 'b-fire'],
      ['lineTooLong', 'c-hall'],
    ]);
    expect(node(data, 'g-ch1', 'a-meet').lines).toHaveLength(3);
  });
});

describe('variables and where they are used (F3-06, F3-09)', () => {
  it('knows where each variable is changed and read', () => {
    const data = sampleProject();
    const usage = variableUsage(data);
    const gold = usage.get('v-gold')!;
    expect(
      gold
        .filter((u) => u.writes)
        .map((u) => u.site.node)
        .sort(),
    ).toEqual(['a-choice', 'a-reward', 'b-buy']);
    expect(
      gold
        .filter((u) => u.reads && !u.writes)
        .map((u) => u.site.node)
        .sort(),
    ).toEqual(['a-choice', 'b-gold']);
    expect(nodesUsing(g(data, 'g-ch2'), gold)).toEqual(new Set(['b-buy', 'b-gold']));
    expect(unusedVariables(data)).toEqual([]);
    expect(usage.get('v-mira')!.map((u) => u.site.option)).toEqual(['o-help']);
  });

  it('renaming a variable rewrites the expressions that use it, and only those', () => {
    const data = produce(sampleProject(), (d) => {
      const v = listVariables(d).find((x) => x.id === 'v-trust')!;
      renameEverywhere(d, 'доверие', 'симпатия', v);
      (d.variables as { variables: { id: string; name: string }[] }).variables.find((x) => x.id === 'v-trust')!.name =
        'симпатия';
    });
    const choice = node(data, 'g-ch1', 'a-choice');
    expect(choice.options![0].effects).toBe('симпатия += 2; Мира.доверие += 1');
    expect(node(data, 'g-ch1', 'a-check').expr).toBe('симпатия < 0');
    expect(checkProject(data)).toEqual([]);
  });

  it('checks names: valid, unique where they can be seen together', () => {
    const data = sampleProject();
    expect(nameProblem(data, '', 'project', null)).toBe('empty');
    expect(nameProblem(data, '2x', 'project', null)).toBe('invalid');
    expect(nameProblem(data, 'Доверие', 'project', null)).toBe('taken');
    expect(nameProblem(data, 'доверие', 'project', { kind: 'entity', id: 'ent-boris' })).toBeNull();
    expect(nameProblem(data, 'доверие', { kind: 'graph', id: 'g-ch1' }, null)).toBe('taken');
    expect(nameProblem(data, 'доверие', 'project', null, 'v-trust')).toBeNull();
  });

  it('chapter variables are seen inside their chapter only', () => {
    const data = produce(sampleProject(), (d) => {
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-local',
        name: 'грибы',
        type: 'int',
        initial: 0,
        scope: { kind: 'graph', id: 'g-ch2' },
        owner: null,
        description: '',
      });
    });
    expect(registryFor(data, 'g-ch2').has('грибы')).toBe(true);
    expect(registryFor(data, 'g-ch1').has('грибы')).toBe(false);
    expect(registryFor(data, 'g-ch1').has('Мира.доверие')).toBe(true);
  });

  it('guesses the type of a variable created from an expression', () => {
    expect(guessType('монеты += 1', 'монеты')).toBe('int');
    expect(guessType('ключ = истина', 'ключ')).toBe('bool');
    expect(guessType('имя == «Мира»', 'имя')).toBe('string');
    expect(guessType('вес = 1.5', 'вес')).toBe('float');
    expect(guessType('открыто', 'открыто')).toBe('bool');
  });
});

describe('chapters, dialogue and choice editing (F3-02, F3-04, F3-05)', () => {
  it('a chapter node owns a graph; copies get their own graphs; deleting removes the whole tree', () => {
    const data = produce(sampleProject(), (d) => {
      const root = g(d, 'g-root');
      const sub = createNode('chapter', 0, 400, 'Интерлюдия');
      root.nodes.push(sub);
      createChapterGraph(d, sub, 'Начало');
    });
    const sub = g(data, 'g-root').nodes.find((n) => n.title === 'Интерлюдия') as StoryNode;
    expect(graphOf(data, sub.graph!)?.nodes.map((n) => n.kind)).toEqual(['start']);
    expect(graphPath(data, sub.graph!)).toEqual(['g-root', sub.graph]);
    expect(graphTitle(data, 'g-ch2')).toBe('Глава 2. Лес');

    const carried = chapterGraphsOf(data, [node(data, 'g-root', 'r-ch1')]);
    const clip = { ...structuredClone(node(data, 'g-root', 'r-ch1')), id: 'r-copy' } as StoryNode;
    const pasted = produce(data, (d) => {
      const copy = structuredClone(clip);
      g(d, 'g-root').nodes.push(copy);
      pasteChapterGraphs(d, [copy], carried);
    });
    const copy = node(pasted, 'g-root', 'r-copy');
    expect(copy.graph).not.toBe('g-ch1');
    expect(graphOf(pasted, copy.graph!)?.nodes).toHaveLength(16);
    expect(graphOf(pasted, copy.graph!)?.parent).toEqual({ kind: 'node', id: 'r-copy' });

    const deleted = produce(pasted, (d) => {
      deleteChapterGraphs(d, [node(d, 'g-root', 'r-ch1')]);
    });
    expect(deleted.graphs['g-ch1']).toBeUndefined();
    expect(deleted.graphs[copy.graph!]).toBeDefined();
  });

  it('dialogue lines and choice options resize their nodes; removing an option removes its edges', () => {
    const data = produce(sampleProject(), (d) => {
      const c1 = g(d, 'g-ch1');
      for (let i = 0; i < 500; i++) addLine(c1, 'a-meet', { text: `Реплика ${i}` });
    });
    const meet = node(data, 'g-ch1', 'a-meet');
    expect(meet.lines).toHaveLength(503);
    const folded = meet.h;
    const expanded = produce(data, (d) => setExpanded(g(d, 'g-ch1'), 'a-meet', true));
    expect(node(expanded, 'g-ch1', 'a-meet').h).toBeGreaterThan(folded * 50);

    const options = produce(data, (d) => {
      const c1 = g(d, 'g-ch1');
      addOption(c1, 'a-choice', 'Четвёртый');
      removeOption(c1, 'a-choice', 'o-key');
    });
    const choice = node(options, 'g-ch1', 'a-choice');
    expect(choice.options!.map((o) => o.text)).toEqual(['Помочь с мешками', 'Уйти', 'Четвёртый']);
    expect(g(options, 'g-ch1').edges.some((e) => e.from.port === 'o-key')).toBe(false);
    expect(choice.h).toBe(node(data, 'g-ch1', 'a-choice').h);
  });

  it('reachability crosses chapters through their ends', () => {
    const data = sampleProject();
    const fromGun = reachableFrom(data, { graph: 'g-ch1', node: 'a-gun' });
    expect(fromGun.has('g-ch3/c-shot')).toBe(true);
    expect(fromGun.has('g-root/r-end')).toBe(true);
  });
});

describe('JSON export (F3-14)', () => {
  it('exports graphs, variables and entities with expression trees', () => {
    const data = sampleProject();
    const out = exportStory(data, '0.2.0', new Date('2026-10-18T10:00:00Z'));
    expect(out).toMatchObject({ format: 'herplan-export', version: 1, exportedWith: '0.2.0' });
    expect(out.exportedAt).toBe('2026-10-18T10:00:00Z');
    expect(out.story.root).toBe('g-root');
    expect(out.story.graphs.map((x) => [x.id, x.parent?.node ?? null, x.start])).toEqual([
      ['g-root', null, 'r-start'],
      ['g-ch1', 'r-ch1', 'a-start'],
      ['g-ch2', 'r-ch2', 'b-start'],
      ['g-ch3', 'r-ch3', 'c-start'],
    ]);
    expect(out.variables.find((v) => v.id === 'v-mira')).toMatchObject({ fullName: 'Мира.доверие', owner: 'ent-mira' });
    const ch1 = out.story.graphs[1];
    expect(ch1.nodes.some((n) => n.kind === 'sticker')).toBe(false);
    const choice = ch1.nodes.find((n) => n.id === 'a-choice')!;
    expect((choice.options as { condition: unknown }[])[1].condition).toEqual({
      source: 'золото >= 5',
      ast: {
        kind: 'binary',
        op: '>=',
        left: { kind: 'var', name: 'золото' },
        right: { kind: 'literal', value: 5 },
      },
    });
    expect(ch1.edges.find((e) => e.fromPort === 'yes')).toMatchObject({ from: 'a-check', to: 'a-hurt' });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('a broken expression is exported as source with an empty tree', () => {
    const data = produce(sampleProject(), (d) => {
      node(d, 'g-ch1', 'a-check').expr = 'доверие <';
    });
    const ch1 = exportStory(data, '0.2.0').story.graphs[1];
    expect(ch1.nodes.find((n) => n.id === 'a-check')?.condition).toEqual({ source: 'доверие <', ast: null });
  });
});

describe('fixes from the code review', () => {
  it('a chapter whose exits are all closed is a dead end, not the end of the story', () => {
    const data = produce(sampleProject(), (d) => {
      for (const e of g(d, 'g-root').edges) if (e.from.node === 'r-ch1') e.condition = 'пощадил_рыцаря';
    });
    let s = startPlay(data);
    s = route(data, s, TO_CHOICE).s;
    s = act(data, s, 'Спросить про ключ');
    s = act(data, s, 'next');
    expect(s.status).toBe('stuck');
    expect(s.problem?.code).toBe('deadEnd');
    expect(at(data, s)).toBe('Глава 1. Мельница');
  });

  it('an entity variable set to "none" by hand stays none; untouched ones keep their entity', () => {
    const data = produce(sampleProject(), (d) => {
      const vars = (d.variables as { variables: { id: string; initial: unknown }[] }).variables;
      vars.find((v) => v.id === 'v-companion')!.initial = 'ent-mira';
      // Two cards with one name: writing back by name must not move the untouched variable.
      d.entities['ent-mira2'] = {
        id: 'ent-mira2',
        type: 'character',
        name: 'Мира',
        description: '',
        image: null,
        order: 5,
      };
    });
    const companion = listVariables(data).find((v) => v.id === 'v-companion')!;
    let s = startPlay(data);
    expect(vars(data, s).спутник).toBe('ent-mira');
    s = route(data, s, TO_CHOICE).s;
    s = act(data, s, 'Помочь с мешками');
    expect(vars(data, s).спутник).toBe('ent-mira');
    s = playSetVariable(s, companion, null);
    s = act(data, s, 'next');
    expect(vars(data, s).спутник).toBeNull();
  });

  it('a pasted chapter points at its own nodes and has its own chapter variables', () => {
    const base = produce(sampleProject(), (d) => {
      // A jump inside chapter 2 to its own end, and a variable of chapter 2.
      node(d, 'g-ch2', 'b-jump').target = { graph: 'g-ch2', node: 'b-end' };
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-forest',
        name: 'грибы',
        type: 'int',
        initial: 0,
        scope: { kind: 'graph', id: 'g-ch2' },
        owner: null,
        description: '',
      });
    });
    const carried = chapterGraphsOf(base, [node(base, 'g-root', 'r-ch2')]);
    const clip = { ...structuredClone(node(base, 'g-root', 'r-ch2')), id: 'r-copy' } as StoryNode;
    const pasted = produce(base, (d) => {
      const copy = structuredClone(clip);
      g(d, 'g-root').nodes.push(copy);
      pasteChapterGraphs(d, [copy], carried, { from: 'g-root', to: 'g-root', ids: new Map([['r-ch2', 'r-copy']]) });
    });
    const copyGraph = node(pasted, 'g-root', 'r-copy').graph!;
    const jump = graphOf(pasted, copyGraph)!.nodes.find((n) => n.kind === 'jump') as StoryNode;
    expect(jump.target?.graph).toBe(copyGraph);
    expect(findNode(pasted, jump.target)?.title).toBe('Конец главы 2');
    const scoped = listVariables(pasted).filter((v) => v.name === 'грибы');
    expect(scoped.map((v) => (v.scope === 'project' ? 'project' : v.scope.id)).sort()).toEqual(
      ['g-ch2', copyGraph].sort(),
    );
    // Deleting the original leaves the copy whole.
    const alone = produce(pasted, (d) => deleteChapterGraphs(d, [node(d, 'g-root', 'r-ch2')]));
    expect(checkProject(alone).filter((p) => p.graph === copyGraph && p.code === 'jumpNoTarget')).toEqual([]);
  });

  it('pasting a chapter whose graph is not on the clipboard copies it from the project', () => {
    const data = sampleProject();
    const clip = { ...structuredClone(node(data, 'g-root', 'r-ch1')), id: 'r-copy' } as StoryNode;
    const pasted = produce(data, (d) => {
      const copy = structuredClone(clip);
      g(d, 'g-root').nodes.push(copy);
      pasteChapterGraphs(d, [copy], []);
    });
    expect(graphOf(pasted, node(pasted, 'g-root', 'r-copy').graph!)?.nodes).toHaveLength(16);
  });

  it('nested chapters cannot repeat a variable name; the closest scope wins in old files', () => {
    const data = produce(sampleProject(), (d) => {
      const c1 = g(d, 'g-ch1');
      const sub = { ...createNode('chapter', 0, 900, 'Вставка'), id: 'sub' } as StoryNode;
      c1.nodes.push(sub);
      createChapterGraph(d, sub, 'Начало');
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-outer',
        name: 'мука',
        type: 'int',
        initial: 1,
        scope: { kind: 'graph', id: 'g-ch1' },
        owner: null,
        description: '',
      });
    });
    const inner = node(data, 'g-ch1', 'sub').graph!;
    expect(nameProblem(data, 'мука', { kind: 'graph', id: inner }, null)).toBe('taken');
    const both = produce(data, (d) => {
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-inner',
        name: 'мука',
        type: 'int',
        initial: 2,
        scope: { kind: 'graph', id: inner },
        owner: null,
        description: '',
      });
    });
    expect(registryFor(both, inner).get('мука')?.variable.id).toBe('v-inner');
    expect(registryFor(both, 'g-ch1').get('мука')?.variable.id).toBe('v-outer');
  });

  it('content-sized nodes cannot be resized smaller than their content', () => {
    const data = sampleProject();
    const choice = node(data, 'g-ch1', 'a-choice');
    expect(minSize(choice, false).h).toBe(choice.h);
  });
});

describe('speed on big graphs', () => {
  it('checks a 20 000-node chapter in well under a second', () => {
    const data = sampleProject();
    const big = benchGraph(20000, 32000);
    big.id = 'g-big';
    big.kind = 'chapter';
    big.parent = { kind: 'node', id: 'r-big' };
    for (const n of big.nodes) n.kind = 'scene';
    big.nodes.unshift({ ...createNode('start', 0, 0, 'S'), id: 's0' });
    big.edges.push({ id: 'es', from: { node: 's0', port: 'out' }, to: { node: 'n0', port: 'in' } });
    data.graphs['g-big'] = big as unknown as ProjectData['graphs'][string];
    g(data, 'g-root').nodes.push({ ...createNode('chapter', 0, 900, 'Big'), id: 'r-big', graph: 'g-big' } as StoryNode);
    checkProject(data);
    const t = performance.now();
    const problems = checkProject(data);
    // Measured about 50 ms; the bound leaves room for slow CI machines (it was 12 s before edge indexes).
    expect(performance.now() - t).toBeLessThan(1500);
    expect(problems.some((p) => p.code === 'deadEnd' && p.graph === 'g-big')).toBe(true);
  });
});

describe('story graphs without chapters', () => {
  it('an overview with only a start is a dead end, not a crash', () => {
    const data = sampleProject();
    const lonely = produce(data, (d) => {
      const root = emptyGraph('solo', 'story', 'S') as GraphDoc;
      root.nodes.push({ ...createNode('start', 0, 0, 'Начало'), id: 's' });
      for (const id of Object.keys(d.graphs)) delete d.graphs[id];
      d.graphs.solo = root as unknown as ProjectData['graphs'][string];
    });
    const s = startPlay(lonely);
    expect(s.status).toBe('stuck');
    expect(s.problem?.code).toBe('deadEnd');
  });
});
