import Ajv2020 from 'ajv/dist/2020';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import schema from '../../../docs/format/export-v1.schema.json';
import { connect, copySelection, createNode, pasteClipboard } from '../canvas/ops';
import { emptyGraph, HEADER_H, type GraphDoc } from '../canvas/model';
import { portsOf } from '../canvas/kinds';
import { newProject } from '../core/project/create';
import type { ProjectData } from '../core/project/types';
import { checkProject } from './checks';
import { checkConversation } from './dialogueCheck';
import { exportStory } from './export';
import {
  callsIn,
  checkCondition,
  evaluate,
  parseCondition,
  renameCallArg,
  stripPositions,
  type CallWorld,
} from './expr';
import { callWorld, entityGame, visibleLength } from './game';
import { freeKey, isGameKey, keyProblem, suggestKey } from './gameKey';
import { addCueMark, addStyleMark, cueAt, plotSources, textMarksOn, toggleBold } from './marks';
import { graphOf, textMarks, toward, towardValue, type StoryNode } from './model';
import { createBarksGraph, removeLine, renewParts, setInterruptExit, setLineFields, updateLine } from './ops';
import { searchLines } from './lineSearch';
import { companionTalk, type CompanionWords } from './templates';
import { parseTranslations, translationsOf } from './translation';
import { BASE_CPS, syllableEnd, typedAt, typing } from './typing';
import { conversationScript, talkOrder } from '../ui/story/script';
import { emptyPalette, notInPalette, parsePalette } from './palette';
import { playAct, playActions, playSetItem, startPlay, type PlayAction, type PlayState } from './play';
import { applyStamps, editStamps, graphTransfer, nodeTransfer, parseImport, transferChanges } from './transfer';
import { renameInCalls, variableUsage } from './usage';
import { listsFor, registryFor } from './variables';
import './kinds';

// 0.8, the spec "Dialogues: what to add to HErPlan": a conversation with a skeleton who takes offerings.

const G = 'g-talk';

function talk(): ProjectData {
  const data = newProject({ name: 'Склеп', appVersion: '0.8.0', now: new Date('2026-11-10T09:00:00Z') });
  data.entities = {
    skeleton: {
      id: 'skeleton',
      type: 'character',
      name: 'Скелет',
      description: '',
      image: null,
      order: 10,
      key: 'skeleton',
      faces: ['neutral', 'angry'],
      voice: 'bones',
    },
    hero: { id: 'hero', type: 'character', name: 'Герой', description: '', image: null, order: 20, key: 'hero' },
    shadow: { id: 'shadow', type: 'character', name: 'Тень', description: '', image: null, order: 30 },
    ring: {
      id: 'ring',
      type: 'item',
      name: 'Первое кольцо',
      description: '',
      image: null,
      order: 10,
      key: 'ring_first',
    },
    sword: { id: 'sword', type: 'item', name: 'Меч', description: '', image: null, order: 20 },
  };
  data.variables = {
    variables: [
      {
        id: 'v-respect',
        name: 'уважение',
        type: 'int',
        initial: 0,
        scope: 'project',
        owner: null,
        description: '',
        key: 'skeleton_respect',
        memory: 'game',
      },
      {
        id: 'v-gifts',
        name: 'подношения',
        type: 'list',
        initial: null,
        scope: 'project',
        owner: null,
        description: '',
      },
      { id: 'v-last', name: 'отдано', type: 'entity', initial: null, scope: 'project', owner: null, description: '' },
    ],
    labels: [],
  };
  const g = emptyGraph(G, 'story', 'Разговор со скелетом');
  (g as { key?: string }).key = 'skeleton_talk';
  const add = (id: string, kind: string, title: string, extra: Partial<StoryNode> = {}) => {
    const n = { ...createNode(kind, g.nodes.length * 340, 0, title), ...extra, id } as StoryNode;
    g.nodes.push(n);
    return n;
  };
  add('start', 'start', 'Начало');
  add('hello', 'dialogue', 'Приветствие', {
    lines: [
      { id: 'l1', speaker: 'skeleton', text: 'Кто потревожил мой покой?', style: 'whisper', face: 'neutral' },
      { id: 'l2', speaker: 'hero', text: 'Я принёс кольцо. {уважение += 1}', condition: 'есть(Первое кольцо)' },
      {
        id: 'l3',
        speaker: 'skeleton',
        text: 'Уходи, пока цел!',
        emote: { id: 'question', to: 'hero' },
        interrupt: 1.5,
        interruptExit: true,
        effects: 'уважение -= 1',
        note: 'грубо',
      },
    ],
  });
  add('ask', 'choice', 'Что сделать?', {
    timer: 10,
    options: [
      {
        id: 'o-give',
        text: 'Предложить подношение',
        condition: 'есть(Первое кольцо) или есть(Меч)',
        effects: '',
        once: true,
      },
      {
        id: 'o-hire',
        text: 'Позвать Тень',
        condition: 'не нанят(Тень)',
        effects: '',
        actions: [{ type: 'hire', ref: 'shadow' }],
      },
      { id: 'o-wait', text: '', condition: '', effects: 'уважение -= 2', secret: true },
    ],
  });
  add('offer', 'give', 'Что отдать?', { store: 'v-last', keep: 'v-gifts', effects: 'уважение += 3' });
  add('thanks', 'dialogue', 'Подношение', {
    lines: [{ id: 't1', speaker: 'skeleton', text: 'Щедро.', condition: 'непусто(подношения) и видел(o-give)' }],
  });
  add('rude', 'dialogue', 'Перебил', { lines: [{ id: 'r1', speaker: 'hero', text: 'Хватит.' }] });
  add('end', 'end', 'Конец');
  const edge = (from: string, to: string, port = 'out') =>
    g.edges.push({ id: `e${g.edges.length}`, from: { node: from, port }, to: { node: to, port: 'in' } });
  edge('start', 'hello');
  edge('hello', 'ask');
  edge('hello', 'rude', 'l3');
  edge('rude', 'end');
  edge('ask', 'offer', 'o-give');
  edge('ask', 'ask', 'o-hire');
  edge('ask', 'end', 'o-wait');
  edge('offer', 'thanks', 'given');
  edge('offer', 'ask', 'cancel');
  edge('thanks', 'ask');
  data.graphs = { [G]: g as unknown as ProjectData['graphs'][string] };
  return data;
}

const node = (d: ProjectData, id: string) => graphOf(d, G)!.nodes.find((n) => n.id === id) as StoryNode;
const pick = (data: ProjectData, s: PlayState, want: (a: PlayAction) => boolean): PlayState => {
  const action = playActions(data, s).find(want);
  if (!action) throw new Error(`no such action among ${JSON.stringify(playActions(data, s))}`);
  return playAct(data, s, action);
};

describe('conditions ask the game: есть, нанят, видел, непусто (2.7)', () => {
  it('reads the four words in Russian and English, names with spaces included', () => {
    const ru = stripPositions(
      parseCondition('есть(Первое кольцо) и не нанят(Тень) или видел(l3) и непусто(подношения)'),
    );
    const en = stripPositions(
      parseCondition('has(Первое кольцо) and not hired(Тень) or seen(l3) and notempty(подношения)'),
    );
    expect(ru).toEqual(en);
    expect(callsIn('есть( «Первое кольцо» ) и уважение > 1')).toEqual([{ fn: 'has', arg: 'Первое кольцо' }]);
    // A variable that happens to be called like a word, without brackets, stays a variable.
    expect(parseCondition('есть > 2')).toMatchObject({ left: { kind: 'var', name: 'есть' } });
  });

  it('checks the names against the database and the story', () => {
    const data = talk();
    const reg = registryFor(data, G);
    const world = callWorld(data, G);
    expect(checkCondition('есть(первое кольцо) и уважение >= 0', reg, world)).toBeNull();
    expect(checkCondition('есть(корона)', reg, world)?.code).toBe('unknownItem');
    expect(checkCondition('нанят(Скелет) или нанят(Никто)', reg, world)?.code).toBe('unknownCharacter');
    expect(checkCondition('видел(l3) и видел(o-give)', reg, world)).toBeNull();
    expect(checkCondition('видел(l99)', reg, world)?.code).toBe('unknownLine');
    expect(checkCondition('непусто(подношения)', reg, world)).toBeNull();
    expect(checkCondition('непусто(уважение)', reg, world)?.code).toBe('unknownListVar');
    expect(checkCondition('есть()', reg, world)?.code).toBe('callEmpty');
    expect(checkCondition('есть(кольцо', reg, world)?.code).toBe('missingParen');
    // A list is not a value: it cannot be compared or assigned.
    expect(reg.has('подношения')).toBe(false);
    expect(listsFor(data, G).get('подношения')?.id).toBe('v-gifts');
  });

  it('evaluates with what the run knows and renames with the database', () => {
    const world: CallWorld = (fn, arg) => fn === 'has' && arg === 'кольцо';
    expect(evaluate(parseCondition('есть(кольцо) и не нанят(Тень)'), new Map(), world)).toBe(true);
    expect(evaluate(parseCondition('есть(меч)'), new Map(), world)).toBe(false);
    expect(renameCallArg('есть(кольцо) и нанят(кольцо) или есть( кольцо )', ['has'], 'кольцо', 'перстень')).toBe(
      'есть(перстень) и нанят(кольцо) или есть(перстень)',
    );
    const renamed = produce(talk(), (d) => renameInCalls(d, ['has'], 'Первое кольцо', 'Перстень'));
    expect(node(renamed, 'hello').lines![1].condition).toBe('есть(Перстень)');
    expect(node(renamed, 'ask').options![0].condition).toBe('есть(Перстень) или есть(Меч)');
  });
});

describe('names in the game (2.1)', () => {
  it('suggests a Latin name from the title and tells a bad one', () => {
    expect(suggestKey('Разговор со скелетом')).toBe('razgovor_so_skeletom');
    expect(suggestKey('Щит №2 — «Ёж»')).toBe('schit_no2_yozh');
    expect(suggestKey('3 кольца')).toBe('n_3_koltsa');
    expect(freeKey('Кольцо', ['koltso', 'koltso_2'])).toBe('koltso_3');
    expect(isGameKey('skeleton_talk')).toBe(true);
    expect(isGameKey('Skeleton') || isGameKey('1ring') || isGameKey('кольцо')).toBe(false);
    const data = talk();
    expect(keyProblem(data, 'entities', 'ring_first', 'sword')).toBe('taken');
    expect(keyProblem(data, 'entities', 'ring_first', 'ring')).toBeNull();
    expect(keyProblem(data, 'variables', 'Respect')).toBe('invalid');
    expect(keyProblem(data, 'graphs', '')).toBeNull();
  });
});

describe('the game palette (3)', () => {
  it('reads the lists, tolerates what is missing or broken', () => {
    const { palette, ok } = parsePalette(
      JSON.stringify({
        styles: [
          { id: 'whisper', name: 'Шёпот', color: '#8899aa', hint: 'тихо' },
          { id: 'whisper', name: 'дубль' },
          { name: 'без id' },
        ],
        faces: ['neutral', { id: 'angry', name: 'Злой' }],
        junk: 5,
      }),
    );
    expect(ok).toBe(true);
    expect(palette.styles).toEqual([{ id: 'whisper', name: 'Шёпот', color: '#8899aa', hint: 'тихо' }]);
    expect(palette.faces.map((f) => f.name)).toEqual(['neutral', 'Злой']);
    expect(notInPalette(palette, 'faces', 'sad')).toBe(true);
    // A list the game did not give blames nothing.
    expect(notInPalette(palette, 'sounds', 'bell')).toBe(false);
    expect(parsePalette(null)).toEqual({ palette: emptyPalette(), ok: true });
    expect(parsePalette('{ nope').ok).toBe(false);
  });
});

describe('marks of the game on a line (2.3)', () => {
  it('a look follows its words, a cue keeps its place, and both go with the line', () => {
    let data = produce(talk(), (d) => {
      const n = node(d, 'hello');
      // "Кто потревожил мой покой?": "потревожил" is 4..14.
      addStyleMark(n, 'l1', { start: 4, end: 14 }, { bold: true, color: '#ff0000', effect: 'shake' });
      addCueMark(n, 'l1', 14, { pause: 0.4 });
      addCueMark(n, 'l1', 0, { shake: 2 });
    });
    data = produce(data, (d) => updateLine(graphOf(d, G)!, 'hello', 'l1', { text: 'Эй! Кто потревожил мой покой?' }));
    const n = node(data, 'hello');
    const marks = textMarksOn(n, { kind: 'line', id: 'l1' });
    expect(marks[0].range).toEqual({ start: 8, end: 18, quote: 'потревожил' });
    expect(marks.slice(1).map((m) => cueAt(n.lines![0].text, m))).toEqual([18, 0]);
    // Plot devices never see them; checks of the story are not confused by them.
    expect(plotSources(graphOf(data, G)!)).toEqual([]);
    expect(checkProject(data).filter((p) => p.code === 'gunNoPayoff')).toEqual([]);

    // The marked words cut out: the look goes, the cue stays at the cut.
    const cut = produce(data, (d) => updateLine(graphOf(d, G)!, 'hello', 'l1', { text: 'Эй! Кто мой покой?' }));
    const left = textMarksOn(node(cut, 'hello'), { kind: 'line', id: 'l1' });
    expect(left.map((m) => m.device)).toEqual(['cue', 'cue']);
    expect(cueAt('Эй! Кто мой покой?', left[0])).toBe(8);

    const gone = produce(data, (d) => removeLine(graphOf(d, G)!, 'hello', 'l1'));
    expect(textMarks(node(gone, 'hello'))).toEqual([]);
  });

  it('Ctrl+B puts bold on and takes it off', () => {
    const on = produce(talk(), (d) => toggleBold(node(d, 'hello'), 'l3', { start: 0, end: 5 }));
    expect(textMarks(node(on, 'hello'))).toMatchObject([
      { device: 'style', props: { bold: true }, range: { quote: 'Уходи' } },
    ]);
    const off = produce(on, (d) => toggleBold(node(d, 'hello'), 'l3', { start: 0, end: 5 }));
    expect(textMarks(node(off, 'hello'))).toEqual([]);
  });

  it('a gesture or an emote is an id, or an id and whom it is for', () => {
    expect(toward('wave')).toEqual({ id: 'wave' });
    expect(toward({ id: 'question', to: 'hero' })).toEqual({ id: 'question', to: 'hero' });
    expect(toward('')).toBeNull();
    expect(towardValue('wave')).toBe('wave');
    expect(towardValue('wave', 'hero')).toEqual({ id: 'wave', to: 'hero' });
    expect(visibleLength('Я принёс кольцо. {уважение += 1}')).toBe(16);
  });
});

describe('nodes and ports (2.2, 2.5, 4.1)', () => {
  it('an interrupted line has an exit of its own; the ordinary exit moves out of its way', () => {
    const data = talk();
    const hello = node(data, 'hello');
    const ports = portsOf(hello);
    expect(ports.find((p) => p.id === 'l3')).toMatchObject({ side: 'out', face: 'right', x: hello.w });
    expect(ports.find((p) => p.id === 'out')!.y).toBe(HEADER_H / 2);
    expect(portsOf(node(data, 'thanks')).map((p) => p.id)).toEqual(['in', 'top', 'out', 'bottom']);
    // Taking the exit away takes its edges.
    const off = produce(data, (d) => setInterruptExit(graphOf(d, G)!, 'hello', 'l3', false));
    expect(graphOf(off, G)!.edges.some((e) => e.from.port === 'l3')).toBe(false);
    expect(node(off, 'hello').lines![2].interruptExit).toBeUndefined();
  });

  it('a give node has three exits; optional fields set empty leave the file', () => {
    const data = talk();
    expect(
      portsOf(node(data, 'offer'))
        .filter((p) => p.side === 'out')
        .map((p) => p.id),
    ).toEqual(['given', 'cancel', 'empty']);
    const g = structuredClone(graphOf(data, G)!) as GraphDoc;
    expect(connect(g, { node: 'offer', port: 'empty' }, { node: 'end', port: 'in' })).toMatchObject({
      from: { port: 'empty' },
    });
    const cleared = produce(data, (d) =>
      setLineFields(graphOf(d, G)!, 'hello', 'l1', { style: '', face: undefined, auto: 2 }),
    );
    expect(node(cleared, 'hello').lines![0]).toEqual({
      id: 'l1',
      speaker: 'skeleton',
      text: 'Кто потревожил мой покой?',
      auto: 2,
    });
  });

  it('a set of lines is a graph of dialogue nodes that connect to nothing', () => {
    const data = produce(talk(), (d) => {
      const g = graphOf(d, G)!;
      const owner = createNode('barks', 0, 400, 'Реплики в лавке');
      g.nodes.push(owner);
      const id = createBarksGraph(d, owner);
      const bark = {
        ...createNode('dialogue', 0, 0, 'Вход'),
        when: 'герой входит',
        lines: [{ id: 'b1', speaker: null, text: '' }],
      };
      graphOf(d, id)!.nodes.push(bark);
    });
    const barks = Object.values(data.graphs).find((g) => g.kind === 'barks') as unknown as GraphDoc;
    expect(portsOf(barks.nodes[0])).toEqual([]);
    // Never "unreachable" or a dead end; the export carries it with its kind.
    const codes = checkProject(data).map((p) => p.code);
    expect(codes).not.toContain('noStart');
    expect(checkProject(data).some((p) => p.node === barks.nodes[0].id && p.code === 'unreachable')).toBe(false);
    const out = exportStory(data, '0.8.0');
    expect(out.story.graphs.find((g) => g.kind === 'barks')?.nodes[0]).toMatchObject({ when: 'герой входит' });
  });
});

describe('the playthrough knows items, companions, lists and what was seen', () => {
  it('lines with conditions, once, the secret option, giving an item, an interrupted line', () => {
    const data = talk();
    let s = startPlay(data, null, G);
    // No ring: the hero's line is skipped; its effect does not run; the skeleton's rudeness does.
    expect(s.pos?.node).toBe('hello');
    expect(s.shown).toEqual(['l1', 'l3']);
    expect(s.vars['v-respect']).toBe(-1);
    expect(playActions(data, s).map((a) => (a.kind === 'exit' ? (a.interrupt ?? 'next') : a.kind))).toEqual([
      'next',
      'l3',
    ]);

    // Interrupting goes its own way.
    expect(pick(data, s, (a) => a.kind === 'exit' && a.interrupt === 'l3').pos?.node).toBe('rude');

    s = pick(data, s, (a) => a.kind === 'exit' && !a.interrupt);
    expect(s.pos?.node).toBe('ask');
    const options = () => playActions(data, s).filter((a) => a.kind === 'option');
    expect(options().map((a) => [a.id, a.enabled, !!a.secret])).toEqual([
      ['o-give', false, false],
      ['o-hire', true, false],
      ['o-wait', true, true],
    ]);
    // Hiring is an action: the option that asked "not hired" closes.
    s = pick(data, s, (a) => a.kind === 'option' && a.id === 'o-hire');
    expect(s.hired).toEqual(['shadow']);
    expect(options().find((a) => a.id === 'o-hire')?.enabled).toBe(false);

    // The hero finds the ring: the offering opens, and is shown once.
    s = playSetItem(s, 'ring', true);
    s = pick(data, s, (a) => a.kind === 'option' && a.id === 'o-give');
    expect(s.pos?.node).toBe('offer');
    expect(playActions(data, s)).toMatchObject([
      { kind: 'give', port: 'given', item: 'ring' },
      { kind: 'give', port: 'cancel' },
    ]);
    s = pick(data, s, (a) => a.kind === 'give' && a.port === 'given');
    expect(s.items).toEqual([]);
    expect(s.vars['v-last']).toBe('ring');
    expect(s.lists['v-gifts']).toEqual(['ring']);
    expect(s.vars['v-respect']).toBe(2);
    // "Щедро." needs a filled list and the option chosen.
    expect(s.pos?.node).toBe('thanks');
    expect(s.shown).toEqual(['t1']);
    s = pick(data, s, (a) => a.kind === 'exit');
    expect(options().map((a) => a.id)).toEqual(['o-hire', 'o-wait']);
    // Time runs out: the secret option.
    s = pick(data, s, (a) => a.kind === 'option' && a.id === 'o-wait');
    expect(s.status).toBe('ended');
    expect(s.vars['v-respect']).toBe(0);
  });

  it('with nothing to give the node goes the "empty" way, or where "refused" goes', () => {
    const data = talk();
    const s = startPlay(data, { graph: G, node: 'offer' });
    expect(playActions(data, s)).toMatchObject([{ kind: 'give', port: 'empty' }]);
    expect(pick(data, s, () => true).pos?.node).toBe('ask');
  });
});

describe('checks (4.3)', () => {
  it('the story: a give node needs "gave" and "refused"; interrupt exits alone are a dead end', () => {
    const noRefuse = produce(talk(), (d) => {
      const g = graphOf(d, G)!;
      g.edges = g.edges.filter((e) => !(e.from.node === 'offer' && e.from.port === 'cancel'));
    });
    expect(checkProject(noRefuse).find((p) => p.code === 'giveNoExit')).toMatchObject({
      node: 'offer',
      params: { branch: 'cancel' },
    });
    const onlyInterrupt = produce(talk(), (d) => {
      const g = graphOf(d, G)!;
      g.edges = g.edges.filter((e) => !(e.from.node === 'hello' && e.from.port === 'out'));
    });
    expect(checkProject(onlyInterrupt).find((p) => p.code === 'deadEnd')).toMatchObject({ node: 'hello' });
    expect(checkProject(talk()).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('"check the dialogue" finds what the game will stumble over', () => {
    const { palette } = parsePalette(
      JSON.stringify({
        styles: [{ id: 'loud', name: 'Громко' }],
        faces: ['neutral', 'angry', 'sad'],
        emotes: ['question'],
        voices: ['bones'],
      }),
    );
    const base = talk();
    const codes = (d: ProjectData) => checkConversation(d, G, palette).map((p) => p.code);
    // As built: the Shadow and the sword have no names in the game, a style is not in the palette, every
    // option the player sees has a condition.
    const found = checkConversation(base, G, palette);
    expect(
      found
        .filter((p) => p.code === 'refNoKey')
        .map((p) => p.params.name)
        .sort(),
    ).toEqual(['Меч', 'Тень', 'отдано', 'подношения']);
    expect(found.find((p) => p.code === 'notInPalette')).toMatchObject({
      node: 'hello',
      line: 'l1',
      params: { list: 'styles', id: 'whisper' },
    });
    expect(codes(base)).toContain('choiceNoFallback');
    expect(codes(base)).not.toContain('noGraphKey');

    const broken = produce(base, (d) => {
      const g = graphOf(d, G)!;
      delete (g as { key?: string }).key;
      const hello = node(d, 'hello');
      hello.lines![0].text = ' ';
      hello.lines![0].face = 'sad';
      hello.lines![1].speaker = null;
      hello.lines![2].emote = { id: 'question', to: 'shadow' };
      const ask = node(d, 'ask');
      delete ask.timer;
      ask.options![1].actions = [{ type: 'hire' }];
      // A circle of conditions with nothing to read or choose.
      const c1 = { ...createNode('condition', 0, 600, 'Круг 1'), id: 'c1' };
      const c2 = { ...createNode('condition', 300, 600, 'Круг 2'), id: 'c2' };
      g.nodes.push(c1, c2);
      g.edges.push(
        { id: 'x1', from: { node: 'c1', port: 'yes' }, to: { node: 'c2', port: 'in' } },
        { id: 'x2', from: { node: 'c2', port: 'yes' }, to: { node: 'c1', port: 'in' } },
      );
    });
    const all = checkConversation(broken, G, palette, {
      key: 'skeleton_talk',
      at: '2026-11-10T10:00:00Z',
      lines: 5,
      problems: [{ node: 'hello', line: 'l3', text: 'нет эмоции question' }],
    });
    for (const code of [
      'noGraphKey',
      'lineEmpty',
      'lineNoSpeaker',
      'faceNotDrawn',
      'towardOutsider',
      'secretNoTimer',
      'actionNoRef',
      'emptyCycle',
      'gameSaid',
    ] as const) {
      expect(
        all.map((p) => p.code),
        code,
      ).toContain(code);
    }
    expect(all.find((p) => p.code === 'gameSaid')).toMatchObject({
      node: 'hello',
      line: 'l3',
      params: { text: 'нет эмоции question' },
    });
    const twoSecrets = produce(base, (d) => {
      node(d, 'ask').options![0].secret = true;
    });
    expect(codes(twoSecrets)).toContain('manySecrets');
  });

  it('lists and what a give node writes count as uses of variables', () => {
    const usage = variableUsage(talk());
    expect(usage.get('v-gifts')?.map((u) => [u.site.node, u.writes])).toEqual([
      ['thanks', false],
      ['offer', true],
    ]);
    expect(usage.get('v-last')?.[0]).toMatchObject({ site: { node: 'offer' }, writes: true });
    expect(checkProject(talk()).filter((p) => p.code === 'unusedVar')).toEqual([]);
  });
});

describe('carrying over into the game (4.2, 4.4)', () => {
  const info = (problems: { node: string; line: string; text: string }[] = []) =>
    parseImport(
      JSON.stringify({
        graphs: {
          [G]: { key: 'skeleton_talk', at: '2026-11-12T10:00:00Z', lines: 42, problems },
          bad: { at: 'вчера' },
        },
      }),
    );

  it('reads the status file and tells where a conversation stands', () => {
    const { status, ok } = info();
    expect(ok).toBe(true);
    expect(Object.keys(status)).toEqual([G]);
    expect(status[G]).toMatchObject({ key: 'skeleton_talk', lines: 42, problems: [] });
    expect(parseImport(null)).toEqual({ status: {}, ok: true });
    expect(parseImport('[]').ok).toBe(false);
    const g = graphOf(talk(), G)!;
    expect(graphTransfer(g, undefined)).toBeNull();
    expect(graphTransfer(g, status[G])).toBe('inGame');
    expect(graphTransfer({ ...g, edited: '2026-11-12T10:00:01Z' } as GraphDoc, status[G])).toBe('changed');
    const failed = info([{ node: 'hello', line: 'l3', text: 'нет эмоции' }]).status[G];
    expect(graphTransfer(g, failed)).toBe('error');
    expect(nodeTransfer(g.nodes[1], failed)).toMatchObject({ state: 'error', problems: [{ text: 'нет эмоции' }] });
    expect(nodeTransfer(g.nodes[2], failed)?.state).toBe('inGame');
  });

  it('stamps what was edited, not what was moved, and says what changed since', () => {
    const before = talk();
    const stamp = (next: ProjectData, at: string) => produce(next, (d) => applyStamps(d, editStamps(before, next), at));
    // Moving a node, folding it, a comment, a translator's note: nothing for the game.
    const moved = produce(before, (d) => {
      const n = node(d, 'hello');
      n.x += 100;
      n.expanded = true;
      n.comment = 'проверить';
      n.lines![0].note = 'шёпотом';
    });
    expect(editStamps(before, moved)).toEqual([]);

    const edited = produce(before, (d) => {
      const g = graphOf(d, G)!;
      updateLine(g, 'hello', 'l3', { text: 'Уходи.' });
      addCueMark(node(d, 'hello'), 'l1', 3, { pause: 0.4 });
      node(d, 'ask').options![1].text = 'Позвать тень';
      node(d, 'offer').store = null;
      g.nodes.push({ ...createNode('dialogue', 0, 300, 'Прощание'), id: 'bye' });
    });
    expect(editStamps(before, edited)).toEqual([
      { graph: G, node: 'hello' },
      { graph: G, node: 'hello', line: 'l3' },
      { graph: G, node: 'hello', line: 'l1' },
      { graph: G, node: 'ask' },
      { graph: G, node: 'ask', option: 'o-hire' },
      { graph: G, node: 'offer' },
      { graph: G, node: 'bye', created: true },
      { graph: G },
    ]);
    const { status } = info();
    const late = stamp(edited, '2026-11-13T08:00:00Z');
    expect(graphTransfer(graphOf(late, G), status[G])).toBe('changed');
    expect(transferChanges(graphOf(late, G), status[G])).toEqual([
      { kind: 'linesChanged', node: 'hello', title: 'Приветствие', lines: ['l1', 'l3'] },
      { kind: 'optionsChanged', node: 'ask', title: 'Что сделать?', options: ['o-hire'] },
      { kind: 'nodeChanged', node: 'offer', title: 'Что отдать?' },
      { kind: 'nodeAdded', node: 'bye', title: 'Прощание' },
    ]);
    // Edited before it was carried over: in the game as it is.
    const early = stamp(edited, '2026-11-11T08:00:00Z');
    expect(graphTransfer(graphOf(early, G), status[G])).toBe('inGame');
    expect(transferChanges(graphOf(early, G), status[G])).toEqual([]);
    // The stamps themselves are not edits; an edge is.
    expect(
      editStamps(
        late,
        produce(late, (d) => applyStamps(d, [{ graph: G }], '2026-11-14T00:00:00Z')),
      ),
    ).toEqual([]);
    const rewired = produce(before, (d) => {
      graphOf(d, G)!.edges.pop();
    });
    expect(editStamps(before, rewired)).toEqual([{ graph: G }]);
    expect(transferChanges(graphOf(stamp(rewired, '2026-11-13T08:00:00Z'), G), status[G])).toEqual([{ kind: 'other' }]);
    // A conversation without a name in the game is left alone.
    const unnamed = produce(before, (d) => {
      delete (graphOf(d, G) as { key?: string }).key;
    });
    const typed = produce(unnamed, (d) => updateLine(graphOf(d, G)!, 'hello', 'l3', { text: '!' }));
    expect(editStamps(unnamed, typed)).toEqual([]);
  });
});

describe('export (0.8 fields)', () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  it('carries what the game needs and fits the published schema', () => {
    const data = produce(talk(), (d) => {
      const n = node(d, 'hello');
      addStyleMark(n, 'l1', { start: 4, end: 14 }, { bold: true, color: '#ff0000' });
      addCueMark(n, 'l1', 14, { emote: { id: 'question', to: 'hero' } });
    });
    const out = JSON.parse(JSON.stringify(exportStory(data, '0.8.0'))) as ReturnType<typeof exportStory>;
    validate(out);
    expect(validate.errors ?? []).toEqual([]);
    const g = out.story.graphs[0];
    expect(g.key).toBe('skeleton_talk');
    const hello = g.nodes.find((n) => n.id === 'hello')!;
    expect(hello.lines).toMatchObject([
      { id: 'l1', style: 'whisper', face: 'neutral' },
      { id: 'l2', condition: { ast: { kind: 'call', fn: 'has', arg: 'Первое кольцо', ref: 'ring' } } },
      { id: 'l3', emote: { id: 'question', to: 'hero' }, interrupt: 1.5, effects: { source: 'уважение -= 1' } },
    ]);
    // The translator's note and the editor's flag stay at home.
    expect(JSON.stringify(hello.lines)).not.toMatch(/грубо|interruptExit/);
    expect(hello.marks).toMatchObject([
      { device: 'style', range: { start: 4, end: 14, quote: 'потревожил' }, props: { bold: true, color: '#ff0000' } },
      { device: 'cue', range: { start: 14, end: 14, quote: '' }, props: { emote: { id: 'question', to: 'hero' } } },
    ]);
    const ask = g.nodes.find((n) => n.id === 'ask')!;
    expect(ask).toMatchObject({
      timer: 10,
      options: [{ once: true }, { actions: [{ type: 'hire', ref: 'shadow' }] }, { secret: true }],
    });
    expect(g.nodes.find((n) => n.id === 'offer')).toMatchObject({ kind: 'give', store: 'v-last', keep: 'v-gifts' });
    expect(g.nodes.find((n) => n.id === 'thanks')!.lines).toMatchObject([
      { condition: { ast: { left: { fn: 'notEmpty', ref: 'v-gifts' }, right: { fn: 'seen', ref: 'o-give' } } } },
    ]);
    expect(g.edges.filter((e) => e.from === 'hello').map((e) => e.fromPort)).toEqual(['out', 'l3']);
    expect(out.variables.map((v) => [v.name, v.type, v.key ?? null, v.memory])).toEqual([
      ['уважение', 'int', 'skeleton_respect', 'game'],
      ['подношения', 'list', null, 'world'],
      ['отдано', 'entity', null, 'world'],
    ]);
    expect(out.entities.find((e) => e.id === 'skeleton')).toMatchObject({
      key: 'skeleton',
      voice: 'bones',
      faces: ['neutral', 'angry'],
    });
    expect(entityGame(data.entities.skeleton)).toEqual({
      key: 'skeleton',
      bubble: '',
      voice: 'bones',
      pitch: null,
      faces: ['neutral', 'angry'],
    });
  });
});

// ---------- section В of the spec ----------

describe('the line typed out as in the game (19)', () => {
  const syllables = (word: string) => {
    const out: string[] = [];
    for (let i = 0; i < word.length;) {
      const j = syllableEnd(word, i);
      out.push(word.slice(i, j));
      i = j;
    }
    return out;
  };

  it('splits words into syllables the Russian way', () => {
    expect(syllables('потревожил')).toEqual(['по', 'тре', 'во', 'жил']);
    expect(syllables('кольцо')).toEqual(['коль', 'цо']);
    expect(syllables('покой?')).toEqual(['по', 'кой', '?']);
  });

  it('letters at the base speed; faster words, words at once, pauses, hidden effects', () => {
    const plain = typing('Ab cd', []);
    expect(plain.steps.map((s) => s.upto)).toEqual([1, 2, 3, 4, 5]);
    expect(plain.total).toBeCloseTo((5 / BASE_CPS) * 1000);

    const mark = (props: Record<string, unknown>, start: number, end: number, device = 'style') =>
      ({
        id: `m${start}`,
        device,
        anchor: { kind: 'line', id: 'l' },
        range: { start, end, quote: 'Ab cd'.slice(start, end) },
        props,
      }) as never;
    const fast = typing('Ab cd', [mark({ speed: 2 }, 0, 2)]);
    expect(fast.total).toBeCloseTo((4 / BASE_CPS) * 1000);
    const words = typing('Ab cd', [mark({ reveal: 'word' }, 0, 5)]);
    expect(words.steps.map((s) => s.upto)).toEqual([3, 5]);
    const instant = typing('Ab cd', [mark({ reveal: 'instant' }, 3, 5)]);
    expect(instant.steps.map((s) => s.upto)).toEqual([1, 2, 3, 5]);

    const cues = typing('Ab cd', [mark({ pause: 0.5 }, 2, 2, 'cue'), mark({ shake: 2 }, 3, 3, 'cue')]);
    expect(cues.total).toBeCloseTo((5 / BASE_CPS) * 1000 + 500);
    expect(cues.steps.find((s) => s.cue)).toMatchObject({ upto: 3, cue: { shake: 2 } });
    expect(typedAt(cues, 0).upto).toBe(0);
    expect(typedAt(cues, (2 / BASE_CPS) * 1000 + 100).upto).toBe(2); // held by the pause
    expect(typedAt(cues, cues.total)).toMatchObject({ upto: 5, cues: [{ cue: { shake: 2 } }] });

    const effect = typing('Hi {x = 1}!', []);
    expect(effect.hidden).toEqual([{ start: 3, end: 10 }]);
    expect(effect.total).toBeCloseTo((4 / BASE_CPS) * 1000);
  });
});

describe("the game's translations (20)", () => {
  it('reads the file and tells a line changed after its translation', () => {
    const { translations, ok } = parseTranslations(
      JSON.stringify({
        en: { l1: 'Who disturbed my rest?', l3: { text: 'Leave!', at: '2026-11-12T10:00:00Z' }, bad: 5 },
        'not a language': { l1: 'x' },
      }),
    );
    expect(ok).toBe(true);
    expect(Object.keys(translations)).toEqual(['en']);
    expect(translationsOf(translations, 'l1')).toEqual([{ lang: 'en', text: 'Who disturbed my rest?', stale: false }]);
    expect(translationsOf(translations, 'l3', '2026-11-13T00:00:00Z')[0].stale).toBe(true);
    expect(translationsOf(translations, 'l3', '2026-11-11T00:00:00Z')[0].stale).toBe(false);
    expect(translationsOf(translations, 'bad')).toEqual([]);
    expect(parseTranslations(null)).toEqual({ translations: {}, ok: true });
    expect(parseTranslations('[1]').ok).toBe(false);
  });
});

describe('a copy of a node and a template (21)', () => {
  it('copied lines and options get ids of their own; marks, exits and видел() follow', () => {
    const data = produce(talk(), (d) => {
      addStyleMark(node(d, 'hello'), 'l3', { start: 0, end: 5 }, { bold: true });
    });
    const g0 = graphOf(data, G)!;
    const clip = copySelection(g0, {
      nodes: new Set(['hello', 'ask', 'thanks', 'rude']),
      edges: new Set(),
      groups: new Set(),
    })!;
    const pasted = produce(data, (d) => {
      const g = graphOf(d, G)!;
      const { nodes } = pasteClipboard(g, clip, { x: 0, y: 900 });
      renewParts([{ g, nodes: g.nodes.filter((n) => nodes.includes(n.id)) }]);
    });
    const g = graphOf(pasted, G)!;
    const copies = g.nodes.slice(-4).map((n) => n as StoryNode);
    const [hello, ask, thanks] = copies;
    const oldIds = ['l1', 'l2', 'l3', 'o-give', 'o-hire', 'o-wait', 't1', 'r1'];
    const newIds = copies.flatMap((n) => [...(n.lines ?? []), ...(n.options ?? [])].map((p) => p.id));
    expect(newIds).toHaveLength(8);
    expect(newIds.some((id) => oldIds.includes(id))).toBe(false);
    // The look of words follows its line; the interrupted exit and the options' exits leave their new ports.
    expect(textMarks(hello)).toMatchObject([{ anchor: { kind: 'line', id: hello.lines![2].id } }]);
    expect(g.edges.filter((e) => e.from.node === hello.id).map((e) => e.from.port)).toEqual([
      'out',
      hello.lines![2].id,
    ]);
    // Only edges between copied nodes come along: "call the Shadow" goes back to the copied choice.
    expect(g.edges.filter((e) => e.from.node === ask.id).map((e) => [e.from.port, e.to.node])).toEqual([
      [ask.options![1].id, ask.id],
    ]);
    // видел(o-give) in the copy asks about the copied option; the original is untouched.
    expect(thanks.lines![0].condition).toBe(`непусто(подношения) и видел(${ask.options![0].id})`);
    expect(node(pasted, 'thanks').lines![0].condition).toBe('непусто(подношения) и видел(o-give)');
    expect(checkProject(pasted).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('"a talk with a companion" is connected and checks clean once it is entered', () => {
    const words = {
      opening: { title: 'A', lines: ['1', '2', '3'] as [string, string, string] },
      choice: { title: 'B', prompt: '?', options: ['x', 'y', 'z'] as [string, string, string] },
      replies: [
        { title: 'C1', line: 'c1' },
        { title: 'C2', line: 'c2' },
        { title: 'C3', line: 'c3' },
      ] as CompanionWords['replies'],
      end: 'E',
    };
    const piece = companionTalk({ x: 0, y: 0 }, { companion: 'shadow', hero: 'hero' }, words);
    expect(piece.nodes.map((n) => n.kind)).toEqual(['dialogue', 'choice', 'dialogue', 'dialogue', 'dialogue', 'end']);
    expect(piece.edges).toHaveLength(7);
    const opening = piece.nodes[0] as StoryNode;
    expect(opening.lines!.map((l) => l.speaker)).toEqual(['shadow', 'hero', 'shadow']);
    const data = produce(talk(), (d) => {
      const g = graphOf(d, G)!;
      g.nodes.push(...piece.nodes);
      g.edges.push(...piece.edges);
      g.edges.push({ id: 'into', from: { node: 'rude', port: 'bottom' }, to: { node: opening.id, port: 'in' } });
    });
    const mine = new Set(piece.nodes.map((n) => n.id));
    expect(checkProject(data).filter((p) => p.node && mine.has(p.node))).toEqual([]);
  });
});

describe('search over the lines (22)', () => {
  const data = talk();
  const found = (q: Parameters<typeof searchLines>[1]) =>
    searchLines(data, q).map((h) => `${h.node}/${h.part?.id ?? '-'}:${h.reasons.join('+')}`);

  it('by words and by who speaks', () => {
    expect(found({})).toEqual([]);
    expect(found({ text: 'КОЛЬЦ' })).toEqual(['hello/l2:']);
    expect(found({ text: 'подношение' })).toEqual(['ask/o-give:']);
    expect(found({ speaker: 'skeleton' })).toEqual(['hello/l1:', 'hello/l3:', 'thanks/t1:']);
    expect(found({ speaker: 'skeleton', text: 'щедро' })).toEqual(['thanks/t1:']);
    expect(found({ text: 'кольц', graph: 'elsewhere' })).toEqual([]);
  });

  it('where an item, a character or a variable is used', () => {
    expect(found({ uses: { kind: 'entity', id: 'ring' } })).toEqual(['hello/l2:condition', 'ask/o-give:condition']);
    expect(found({ uses: { kind: 'entity', id: 'shadow' } })).toEqual(['ask/o-hire:condition+action']);
    expect(found({ uses: { kind: 'entity', id: 'hero' } })).toEqual([
      'hello/l2:speaker',
      'hello/l3:to',
      'rude/r1:speaker',
    ]);
    expect(found({ uses: { kind: 'variable', id: 'v-respect' } })).toEqual([
      'hello/l2:text',
      'hello/l3:effects',
      'ask/o-wait:effects',
      'offer/-:effects',
    ]);
    expect(found({ uses: { kind: 'variable', id: 'v-gifts' } })).toEqual(['offer/-:keep', 'thanks/t1:condition']);
    expect(found({ uses: { kind: 'variable', id: 'v-respect' }, text: 'уходи' })).toEqual(['hello/l3:effects']);
  });
});

describe('the conversation as plain text (23)', () => {
  it('reads like a script, in the order the talk goes', () => {
    const { palette } = parsePalette(JSON.stringify({ styles: [{ id: 'whisper', name: 'шёпотом' }] }));
    const data = produce(talk(), (d) => {
      addCueMark(node(d, 'hello'), 'l1', 3, { pause: 0.4 });
    });
    const text = conversationScript(data, G, palette);
    const lines = text.split('\n');
    expect(lines[0]).toBe('РАЗГОВОР: Разговор со скелетом (skeleton_talk)');
    expect(text).toContain('СКЕЛЕТ (шёпотом; лицо: neutral): Кто [пауза 0.4 с] потревожил мой покой?');
    expect(text).toContain('ГЕРОЙ [если есть(Первое кольцо)]: Я принёс кольцо.');
    expect(text).not.toContain('уважение += 1');
    expect(text).toContain('СКЕЛЕТ (эмоция: question → Герой): Уходи, пока цел!');
    expect(text).toContain('    (перебили → «Перебил»)');
    expect(text).toContain('— Что сделать? — (выбор; таймер: 10 с)');
    expect(text).toContain(
      '  1. Предложить подношение [если есть(Первое кольцо) или есть(Меч); показать один раз] → «Что отдать?»',
    );
    expect(text).toContain('  *. (тайный — когда выйдет время) → «Конец»');
    expect(text).toContain('  отдал → «Подношение»; отказался → «Что сделать?»');
    // The order the talk goes: the greeting before the choice, the choice before what it leads to.
    const at = (s: string) => lines.findIndex((l) => l.startsWith(s));
    expect(at('— Приветствие —')).toBeLessThan(at('— Что сделать?'));
    expect(at('— Что сделать?')).toBeLessThan(at('— Что отдать?'));
    expect(talkOrder(graphOf(data, G)!).map((n) => n.id)).toEqual([
      'start',
      'hello',
      'ask',
      'offer',
      'thanks',
      'end',
      'rude',
    ]);
  });
});
