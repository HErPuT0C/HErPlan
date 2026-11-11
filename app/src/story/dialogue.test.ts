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
import {
  addCueMark,
  addStyleMark,
  cueAt,
  plotSources,
  setMarkProps,
  startCue,
  textMarksOn,
  tidyProject,
  toggleBold,
} from './marks';
import { graphOf, textMarks, toward, towardValue, type StoryNode } from './model';
import { createBarksGraph, removeLine, renewParts, setInterruptExit, setLineFields, updateLine } from './ops';
import { searchLines } from './lineSearch';
import { companionTalk, type CompanionWords } from './templates';
import { parseTranslations, translationsOf } from './translation';
import { faceAt, gameLine, shownAt, syllables } from './gameLine';
import { letterMove, noise, shakeAt } from './gameFx';
import { conversationScript, talkOrder } from '../ui/story/script';
import {
  actionRef,
  emptyPalette,
  NARRATOR,
  notInPalette,
  paletteSpeaker,
  parsePalette,
  type PalettePreview,
} from './palette';
import { playAct, playActions, playSetItem, startPlay, type PlayAction, type PlayState } from './play';
import { applyStamps, editStamps, graphTransfer, nodeTransfer, parseImport, transferChanges } from './transfer';
import { renameInCalls, variableUsage } from './usage';
import { listsFor, registryFor } from './variables';
import './kinds';

// 0.8, the spec "Dialogues: what to add to HErPlan": a conversation with a skeleton who takes offerings.

const G = 'g-talk';

/** A palette of the game's shape (a part of the real one of 11.11.2026, no pictures). */
const PALETTE = {
  version: '2026-11-11',
  styles: [
    { id: 'normal', name: 'Обычный', color: '#e8e6de' },
    { id: 'shout', name: 'Крик', color: '#e8e6de', hint: 'жирно' },
    { id: 'anger', name: 'Гнев', color: '#ff7a4a' },
  ],
  faces: [
    { id: 'neutral', name: 'Обычное' },
    { id: 'angry', name: 'Зол' },
    { id: 'sad', name: 'Грустит' },
  ],
  emotes: [{ id: 'question', name: '?', icon: { image: 'dialogue_preview/emotes.png', frame: 1, w: 13, h: 13 } }],
  gestures: [{ id: 'nod', name: 'Кивнул', hint: 'два коротких кивка' }],
  voices: [{ id: 'dlg_blip_bone', name: 'Костяной', sound: 'dialogue_preview/sounds/dlg_blip_bone.wav' }],
  sounds: [{ id: 'ui_deny', name: 'Отказ' }],
  speakers: [
    {
      id: 'skeleton',
      name: 'Скелет',
      color: '#3fd0c0',
      bubble: 'round',
      voice: 'dlg_blip_bone',
      faces: ['neutral', 'angry', 'sad'],
    },
    { id: 'narrator', name: 'Рассказчик', color: '#e8e6de', bubble: 'round', voice: 'dlg_blip' },
  ],
  actions: [
    { id: 'give_item', name: 'Выдать предмет', ref: 'item' },
    { id: 'hire', name: 'Нанять напарника', ref: 'character' },
    { id: 'save', name: 'Сохранить игру' },
    { id: 'event', name: 'Событие для игры', ref: 'text' },
  ],
  preview: {
    text: { color: '#e8e6de', width: 190, cps: 32, pause_stop: 0.28, pause_comma: 0.12, shake_time: 0.14 },
    styles: [
      { id: 'normal', props: {} },
      { id: 'shout', props: { bold: true, reveal: 'word', fx: ['punch'], cps: 24, shake: 2, face: 'surprised' } },
      { id: 'anger', props: { col: '#ff7a4a', fx: ['shake'], cps: 46, face: 'angry' } },
    ],
    effects: [
      { id: 'shake', params: { px: 1, rate: 22 } },
      { id: 'wave', params: { px: 2, speed: 9, step: 0.7 } },
      { id: 'rainbow', params: { speed: 0.5, step: 0.06, sat: 170, val: 255 } },
      { id: 'punch', params: { px: 3, time: 0.1 } },
      { id: 'sink', params: { px: 2, time: 1.2 } },
      { id: 'twitch', params: { rate: 9, chance: 0.08 } },
    ],
    speakers: [
      {
        id: 'skeleton',
        color: '#3fd0c0',
        voice_pitch: 1,
        faces: { neutral: 'dialogue_preview/skeleton_neutral.png' },
        frame_w: 64,
        frame_h: 32,
        frames: 4,
        fps: 5,
        head: [14, 1],
      },
    ],
  },
};

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
      // 0.8.1: no cue at the start of a line (the fields under the text are for that).
      expect(addCueMark(n, 'l1', 0, { shake: 2 })).toBeNull();
    });
    data = produce(data, (d) => updateLine(graphOf(d, G)!, 'hello', 'l1', { text: 'Эй! Кто потревожил мой покой?' }));
    const n = node(data, 'hello');
    const marks = textMarksOn(n, { kind: 'line', id: 'l1' });
    expect(marks[0].range).toEqual({ start: 8, end: 18, quote: 'потревожил' });
    expect(marks.slice(1).map((m) => cueAt(n.lines![0].text, m))).toEqual([18]);
    // Plot devices never see them; checks of the story are not confused by them.
    expect(plotSources(graphOf(data, G)!)).toEqual([]);
    expect(checkProject(data).filter((p) => p.code === 'gunNoPayoff')).toEqual([]);

    // The marked words cut out: the look goes, the cue stays at the cut.
    const cut = produce(data, (d) => updateLine(graphOf(d, G)!, 'hello', 'l1', { text: 'Эй! Кто мой покой?' }));
    const left = textMarksOn(node(cut, 'hello'), { kind: 'line', id: 'l1' });
    expect(left.map((m) => m.device)).toEqual(['cue']);
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

describe('the line typed out as in the game (19; 0.8.1, "Редактор реплик" 7.1, 7.4)', () => {
  const step = 1 / 32;
  const mark = (text: string, props: Record<string, unknown>, start: number, end: number, device = 'style') =>
    ({
      id: `m${start}-${end}-${device}`,
      device,
      anchor: { kind: 'line', id: 'l' },
      range: { start, end, quote: text.slice(start, end) },
      props,
    }) as never;
  const times = (text: string, marks: never[] = [], style?: string, preview: PalettePreview | null = null) =>
    gameLine(text, style, marks, preview);

  it('splits words into syllables as the game does', () => {
    expect(syllables('потревожил')).toEqual(['пот', 'ре', 'во', 'жил']);
    expect(syllables('кольцо')).toEqual(['коль', 'цо']);
    expect(syllables('покой?')).toEqual(['по', 'кой?']);
    expect(syllables('Кто')).toEqual(['Кто']);
  });

  it('letters one step apart; pauses after stops and commas, but not after the last sign', () => {
    const plain = times('Ab cd');
    expect(plain.letters.map((l) => l.appear)).toEqual([0, step, 2 * step, 3 * step, 4 * step]);
    expect(plain.end).toBeCloseTo(5 * step);
    const stop = times('Да. Нет');
    expect(stop.letters[3].appear).toBeCloseTo(3 * step + 0.28);
    expect(stop.end).toBeCloseTo(7 * step + 0.28);
    expect(times('a, b').letters[2].appear).toBeCloseTo(2 * step + 0.12);
    // "." not followed by a space or the end is no stop ("3.5").
    expect(times('3.5').letters[2].appear).toBeCloseTo(2 * step);
    expect(times('Да.').end).toBeCloseTo(3 * step);
  });

  it('words at once, syllables, at once; speed; pauses and cues in their places', () => {
    const t1 = 'раз два.';
    const words = times(t1, [mark(t1, { reveal: 'word' }, 0, t1.length)]);
    expect(words.chunks.map((c) => [c.from, c.to])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(words.chunks[1].time).toBeCloseTo(3 * step);
    expect(words.end).toBeCloseTo(4 * step);
    const t2 = 'потревожил';
    const syl = times(t2, [mark(t2, { reveal: 'syllable' }, 0, t2.length)]);
    expect(syl.chunks.map((c) => t2.slice(c.from, c.to))).toEqual(['пот', 'ре', 'во', 'жил']);
    const t3 = 'Ab cd';
    const fast = times(t3, [mark(t3, { speed: 2 }, 0, 2)]);
    expect(fast.letters.map((l) => l.appear)).toEqual([0, step / 2, step, 2 * step, 3 * step]);
    const instant = times(t3, [mark(t3, { reveal: 'instant' }, 3, 5)]);
    expect(instant.letters[3].appear).toBe(instant.letters[4].appear);
    const cues = times(t3, [mark(t3, { pause: 0.5 }, 2, 2, 'cue'), mark(t3, { shake: 2 }, 4, 4, 'cue')]);
    expect(cues.letters[2].appear).toBeCloseTo(2 * step + 0.5);
    expect(cues.cues.map((c) => [c.at, c.time])).toEqual([
      [2, 2 * step],
      [4, 4 * step + 0.5],
    ]);
    expect(
      shownAt(cues, 2 * step + 0.1)
        .letters.map((l) => l.ch)
        .join(''),
    ).toBe('Ab');
    // Effects written in braces are never shown and take no time.
    const hidden = times('Hi {x = 1}!');
    expect(
      hidden.letters
        .filter((l) => l.i >= 0)
        .map((l) => l.ch)
        .join(''),
    ).toBe('Hi !');
    expect(hidden.end).toBeCloseTo(4 * step);
  });

  it('a letter wears the line style, then the marks over it, outer before inner', () => {
    const { palette } = parsePalette(JSON.stringify(PALETTE));
    const preview = palette.preview!;
    const text = 'КТО ТАМ';
    const line = times(
      text,
      [mark(text, { style: 'anger' }, 0, 7), mark(text, { effect: 'wave', bold: false }, 4, 7)],
      'shout',
      preview,
    );
    const [k, , , , tt] = line.letters;
    expect(k.props).toMatchObject({ bold: true, col: '#ff7a4a', fx: ['shake'], cps: 46, shake: 2, face: 'angry' });
    expect(tt.props).toMatchObject({ bold: false, fx: ['wave'], col: '#ff7a4a' });
    // The shout's own shake goes with every piece it types.
    expect(line.chunks.every((c) => c.shake === 2)).toBe(true);
    expect(faceAt(line, 'sad', 0)).toBe('angry');
    expect(faceAt(line, 'sad', line.end + 1)).toBe('sad');
    const withCue = times('Ну и ну', [mark('Ну и ну', { face: 'happy' }, 3, 3, 'cue')], undefined, preview);
    expect(faceAt(withCue, undefined, 0)).toBe('neutral');
    expect(faceAt(withCue, undefined, withCue.end)).toBe('happy');
  });
});

describe('letters move and the screen shakes by the time (0.8.1, 7.5, 7.7)', () => {
  const params = parsePalette(JSON.stringify(PALETTE)).palette.preview!.effects;
  it('the effects of the game, as functions of t', () => {
    expect(noise(0)).toBe(0);
    expect(letterMove(['wave'], params, 0, Math.PI / 2 / 9, 1).dy).toBe(2);
    expect(letterMove(['punch'], params, 0, 0, 0).dy).toBe(-3);
    expect(letterMove(['punch'], params, 0, 0, 0.2).dy).toBe(0);
    expect(letterMove(['sink'], params, 0, 5, 5).dy).toBe(2);
    expect(letterMove(['rainbow'], params, 3, 0.4, 1).col).toMatch(/^#[0-9a-f]{6}$/);
    const shaken = letterMove(['shake'], params, 3, 0.37, 1);
    expect(Math.abs(shaken.dx) <= 1 && Math.abs(shaken.dy) <= 1).toBe(true);
    expect(letterMove(['nothing'], params, 0, 1, 1)).toEqual({ dx: 0, dy: 0 });
    // The same moment gives the same frame: playing again is the same.
    expect(letterMove(['twitch', 'shake'], params, 5, 1.23, 1)).toEqual(
      letterMove(['twitch', 'shake'], params, 5, 1.23, 1),
    );
  });

  it('the screen shakes for shake_time after each shake, weaker towards the end; again from the start shakes again', () => {
    const events = [{ time: 0.5, strength: 2 }];
    expect(shakeAt(events, 0.49, 0.14)).toEqual({ dx: 0, dy: 0 });
    expect(shakeAt(events, 0.65, 0.14)).toEqual({ dx: 0, dy: 0 });
    const moved = [0.5, 0.51, 0.52, 0.53, 0.54].map((t) => shakeAt(events, t, 0.14));
    expect(moved.some((m) => m.dx !== 0 || m.dy !== 0)).toBe(true);
    expect(moved.every((m) => Math.abs(m.dx) <= 2 && Math.abs(m.dy) <= 2)).toBe(true);
    expect(shakeAt(events, 0.52, 0.14)).toEqual(shakeAt(events, 0.52, 0.14));
    // Two shakes in a row are two shakes.
    const two = [
      { time: 0.1, strength: 1 },
      { time: 0.5, strength: 1 },
    ];
    expect([0.1, 0.11, 0.12, 0.13].some((t) => shakeAt(two, t, 0.14).dx !== 0 || shakeAt(two, t, 0.14).dy !== 0)).toBe(
      true,
    );
    expect([0.5, 0.51, 0.52, 0.53].some((t) => shakeAt(two, t, 0.14).dx !== 0 || shakeAt(two, t, 0.14).dy !== 0)).toBe(
      true,
    );
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

// ---------- 0.8.1: "Редактор реплик", step 1 ----------

describe('the palette of the game (0.8.1, 2.1)', () => {
  it('reads speakers, actions, icons, sounds and the numbers of the preview', () => {
    const { palette, ok } = parsePalette(`\uFEFF${JSON.stringify(PALETTE)}`);
    expect(ok).toBe(true);
    expect(palette.loaded).toBe(true);
    expect(palette.emotes[0].icon).toEqual({ image: 'dialogue_preview/emotes.png', frame: 1, w: 13, h: 13 });
    expect(palette.voices[0].sound).toBe('dialogue_preview/sounds/dlg_blip_bone.wav');
    expect(paletteSpeaker(palette, 'skeleton')).toMatchObject({ color: '#3fd0c0', faces: ['neutral', 'angry', 'sad'] });
    expect(paletteSpeaker(palette, 'narrator')?.faces).toEqual([]);
    expect(palette.actions.map((a) => [a.id, a.ref])).toEqual([
      ['give_item', 'item'],
      ['hire', 'character'],
      ['save', null],
      ['event', 'text'],
    ]);
    const p = palette.preview!;
    expect(p.text.cps).toBe(32);
    expect(p.styles.shout).toMatchObject({ bold: true, fx: ['punch'], shake: 2 });
    expect(p.effects.wave).toEqual({ px: 2, speed: 9, step: 0.7 });
    expect(p.speakers[0]).toMatchObject({ id: 'skeleton', frame_w: 64, head: [14, 1] });
    // Actions: the palette's list when it has one, else HErPlan's own.
    expect(actionRef(palette, 'hire')).toBe('character');
    expect(actionRef(palette, 'take_item')).toBeUndefined();
    expect(actionRef(emptyPalette(), 'take_item')).toBe('item');
    expect(emptyPalette().loaded).toBe(false);
  });
});

describe('one place for one thing (0.8.1, 3)', () => {
  const line = (d: ProjectData) => node(d, 'hello').lines!;
  it('empty looks and cues are not kept; twins join; a cue at the start goes into the field', () => {
    const messy = produce(talk(), (d) => {
      const n = node(d, 'hello');
      const anchor = { kind: 'line' as const, id: 'l1' };
      const all = 'Кто потревожил мой покой?';
      n.marks = [
        // What the owner's file had: an emote cue with no value, two looks over the whole text with no props.
        { id: 'a', device: 'cue', anchor, range: { start: 4, end: 4, quote: '' }, props: { emote: '' } },
        { id: 'b', device: 'style', anchor, range: { start: 0, end: all.length, quote: all }, props: {} },
        { id: 'c', device: 'style', anchor, range: { start: 0, end: all.length, quote: all }, props: {} },
        // Two looks over the same words: one.
        { id: 'd', device: 'style', anchor, range: { start: 4, end: 14, quote: 'потревожил' }, props: { bold: true } },
        {
          id: 'e',
          device: 'style',
          anchor,
          range: { start: 4, end: 14, quote: 'потревожил' },
          props: { style: 'anger' },
        },
        // At the start: an emote moves into the empty field; a face stays (the field is taken), shown as a mistake.
        { id: 'f', device: 'cue', anchor, range: { start: 0, end: 0, quote: '' }, props: { emote: 'question' } },
        { id: 'g', device: 'cue', anchor, range: { start: 0, end: 0, quote: '' }, props: { face: 'angry' } },
      ];
    });
    const tidy = produce(messy, (d) => void tidyProject(d));
    const n = node(tidy, 'hello');
    expect(n.marks!.map((m) => m.id)).toEqual(['d', 'g']);
    expect(textMarks(n)[0].props).toEqual({ bold: true, style: 'anger' });
    expect(line(tidy)[0]).toMatchObject({ emote: 'question', face: 'neutral' });
    expect(startCue(n, textMarks(n)[1])).toBe(true);
    // Nothing left to tidy the second time.
    expect(produce(tidy, (d) => void tidyProject(d))).toBe(tidy);
  });

  it('a look with its props taken away goes away; no cue is put at the start; typing keeps the field', () => {
    let data = produce(talk(), (d) => {
      const n = node(d, 'hello');
      const m = addStyleMark(n, 'l3', { start: 0, end: 5 }, { bold: true })!;
      setMarkProps(n, m.id, { bold: false });
      expect(textMarks(n)).toEqual([]);
      expect(addStyleMark(n, 'l3', { start: 0, end: 5 }, {})).toBeNull();
      expect(addCueMark(n, 'l3', 0, { pause: 0.3 })).toBeNull();
      addCueMark(n, 'l3', 2, { gesture: 'nod' });
    });
    // The text before the cue is cut: it comes to the start and becomes the line's gesture.
    data = produce(data, (d) => updateLine(graphOf(d, G)!, 'hello', 'l3', { text: 'одите, пока цел!' }));
    expect(textMarks(node(data, 'hello'))).toEqual([]);
    expect(line(data)[2].gesture).toBe('nod');
  });
});

describe('who speaks (0.8.1, 2.3)', () => {
  it('"narrator" is the narrator; null is nobody, and the check says so', () => {
    const data = produce(talk(), (d) => {
      const [l1, l2] = line3(d);
      l1.speaker = NARRATOR;
      l2.speaker = null;
    });
    const { palette } = parsePalette(JSON.stringify(PALETTE));
    const found = checkConversation(data, G, palette);
    expect(found.filter((p) => p.code === 'lineNoSpeaker').map((p) => p.line)).toEqual(['l2']);
    expect(found.find((p) => p.code === 'lineNoSpeaker')?.severity).toBe('warning');
    // The narrator is no card: no "no name in the game", no faces asked of it.
    expect(found.some((p) => p.params.id === NARRATOR)).toBe(false);
    expect(
      (exportStory(data, '0.8.1').story.graphs[0].nodes.find((n) => n.id === 'hello')!.lines as unknown[]).slice(0, 2),
    ).toMatchObject([{ speaker: 'narrator' }, { speaker: null }]);
  });

  it('faces come from the game for its speakers; actions the game does not know are flagged', () => {
    const { palette } = parsePalette(JSON.stringify(PALETTE));
    const data = produce(talk(), (d) => {
      node(d, 'hello').lines![0].face = 'glow';
      node(d, 'ask').options![1].actions = [{ type: 'hire', ref: 'shadow' }, { type: 'dance' }];
    });
    const found = checkConversation(data, G, palette);
    expect(found.find((p) => p.code === 'faceNotDrawn')).toMatchObject({ line: 'l1', params: { face: 'glow' } });
    expect(found.filter((p) => p.code === 'actionUnknown').map((p) => p.params.action)).toEqual(['dance']);
  });
});

function line3(d: ProjectData) {
  return node(d, 'hello').lines!;
}
