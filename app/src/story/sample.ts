// The reference scenario of F3-15: three chapters, 50 nodes, 10 variables, 5 choices, every story kind.
// Tests play it along a fixed route; it is also a handy fixture for checks and export.

import { createNode } from '../canvas/ops';
import { emptyGraph, type GraphDoc, type GraphEdge } from '../canvas/model';
import { newProject } from '../core/project/create';
import type { ProjectData } from '../core/project/types';
import { asStory, type StoryNode } from './model';
import { fitNode } from './ops';
import type { Variable } from './variables';
import './kinds';

class Builder {
  readonly g: GraphDoc;
  private col = 0;

  constructor(id: string, kind: 'story' | 'chapter', name: string, parent: string | null) {
    this.g = emptyGraph(id, kind, name);
    if (parent) this.g.parent = { kind: 'node', id: parent };
  }

  node(id: string, kind: string, title: string, extra: Partial<StoryNode> = {}): StoryNode {
    const n = { ...createNode(kind, this.col * 340, (this.col % 3) * 60, title), ...extra, id } as StoryNode;
    fitNode(n);
    this.col++;
    this.g.nodes.push(n);
    return n;
  }

  edge(from: string, to: string, extra: Partial<GraphEdge> & { port?: string } = {}): void {
    const { port = 'out', ...rest } = extra;
    this.g.edges.push({
      id: `e-${this.g.id}-${this.g.edges.length}`,
      from: { node: from, port },
      to: { node: to, port: 'in' },
      ...rest,
    });
  }
}

const opt = (id: string, text: string, condition = '', effects = '') => ({ id, text, condition, effects });
const line = (id: string, speaker: string | null, text: string) => ({ id, speaker, text });

export const SAMPLE_VARIABLES: Variable[] = [
  { id: 'v-trust', name: 'доверие', type: 'int', initial: 0, scope: 'project', owner: null, description: '' },
  {
    id: 'v-spared',
    name: 'пощадил_рыцаря',
    type: 'bool',
    initial: false,
    scope: 'project',
    owner: null,
    description: '',
  },
  { id: 'v-gold', name: 'золото', type: 'int', initial: 5, scope: 'project', owner: null, description: '' },
  { id: 'v-key', name: 'есть_ключ', type: 'bool', initial: false, scope: 'project', owner: null, description: '' },
  {
    id: 'v-mood',
    name: 'настроение',
    type: 'enum',
    initial: 'спокойна',
    values: ['спокойна', 'рада', 'зла'],
    scope: 'project',
    owner: null,
    description: '',
  },
  { id: 'v-companion', name: 'спутник', type: 'entity', initial: null, scope: 'project', owner: null, description: '' },
  {
    id: 'v-mill',
    name: 'был_на_мельнице',
    type: 'bool',
    initial: false,
    scope: 'project',
    owner: null,
    description: '',
  },
  { id: 'v-rep', name: 'репутация', type: 'float', initial: 0, scope: 'project', owner: null, description: '' },
  {
    id: 'v-nick',
    name: 'прозвище',
    type: 'string',
    initial: 'странник',
    scope: 'project',
    owner: null,
    description: '',
  },
  {
    id: 'v-mira',
    name: 'доверие',
    type: 'int',
    initial: 0,
    scope: 'project',
    owner: { kind: 'entity', id: 'ent-mira' },
    description: '',
  },
];

export function sampleProject(): ProjectData {
  const data = newProject({ name: 'Мельница', appVersion: '0.2.0', now: new Date('2026-10-18T09:30:00Z') });
  data.entities = {
    'ent-mira': { id: 'ent-mira', type: 'character', name: 'Мира', description: 'Травница', image: null, order: 10 },
    'ent-boris': { id: 'ent-boris', type: 'character', name: 'Борис', description: '', image: null, order: 20 },
    'ent-mill': { id: 'ent-mill', type: 'location', name: 'Мельница', description: '', image: null, order: 10 },
    'ent-castle': { id: 'ent-castle', type: 'location', name: 'Замок', description: '', image: null, order: 20 },
    'ent-key': { id: 'ent-key', type: 'item', name: 'Ключ', description: '', image: null, order: 10 },
  };
  data.variables = { variables: SAMPLE_VARIABLES, labels: [] };

  // Story overview: start → three chapters → end.
  const root = new Builder('g-root', 'story', 'Сценарий', null);
  root.node('r-start', 'start', 'Начало');
  root.node('r-ch1', 'chapter', 'Глава 1. Мельница', { graph: 'g-ch1', text: 'Знакомство с Мирой' });
  root.node('r-ch2', 'chapter', 'Глава 2. Лес', { graph: 'g-ch2' });
  root.node('r-ch3', 'chapter', 'Глава 3. Замок', { graph: 'g-ch3' });
  root.node('r-end', 'end', 'Конец истории');
  root.edge('r-start', 'r-ch1');
  root.edge('r-ch1', 'r-ch2');
  root.edge('r-ch2', 'r-ch3');
  root.edge('r-ch3', 'r-end');

  // Chapter 1: dialogue, the gun on the wall, a choice with a condition and effects.
  const c1 = new Builder('g-ch1', 'chapter', 'Глава 1. Мельница', 'r-ch1');
  c1.node('a-start', 'start', 'Начало');
  c1.node('a-morning', 'scene', 'Утро', { text: 'Туман над рекой.' });
  c1.node('a-mill', 'effect', 'Был на мельнице', { effects: 'был_на_мельнице = истина' });
  c1.node('a-arrive', 'scene', 'У мельницы', { text: 'Жернова скрипят.' });
  c1.node('a-meet', 'dialogue', 'Встреча', {
    lines: [
      line('l1', 'ent-mira', 'Ты пришёл.'),
      line('l2', null, 'Ветер стихает.'),
      line('l3', 'ent-mira', 'Помоги мне.'),
    ],
  });
  c1.node('a-gun', 'gun', 'Ружьё на стене', {
    text: 'Старое ружьё висит над дверью.',
    links: [{ graph: 'g-ch3', node: 'c-shot' }],
  });
  c1.node('a-choice', 'choice', 'Что ответить Мире?', {
    options: [
      opt('o-help', 'Помочь с мешками', '', 'доверие += 2; Мира.доверие += 1'),
      opt('o-key', 'Спросить про ключ', 'золото >= 5', 'есть_ключ = истина; золото -= 5'),
      opt('o-leave', 'Уйти', '', 'доверие -= 1'),
    ],
  });
  c1.node('a-bags', 'scene', 'Мешки');
  c1.node('a-reward', 'effect', 'Награда', { effects: 'золото += 3' });
  c1.node('a-key', 'scene', 'Ключ', { text: 'Мира отдаёт ключ.' });
  c1.node('a-check', 'condition', 'Мира обиделась?', { expr: 'доверие < 0' });
  c1.node('a-hurt', 'scene', 'Мира обиделась');
  c1.node('a-end', 'end', 'Конец главы 1');
  c1.node('a-who', 'character', 'Мира', { ref: 'ent-mira' });
  c1.node('a-where', 'location', 'Мельница', { ref: 'ent-mill' });
  c1.node('a-note', 'sticker', '', { text: 'Проверить реплики' });
  c1.edge('a-start', 'a-morning');
  c1.edge('a-morning', 'a-mill');
  c1.edge('a-mill', 'a-arrive');
  c1.edge('a-arrive', 'a-meet');
  c1.edge('a-meet', 'a-gun');
  c1.edge('a-gun', 'a-choice');
  c1.edge('a-choice', 'a-bags', { port: 'o-help' });
  c1.edge('a-choice', 'a-key', { port: 'o-key' });
  c1.edge('a-choice', 'a-check', { port: 'o-leave' });
  c1.edge('a-bags', 'a-reward');
  c1.edge('a-reward', 'a-end');
  c1.edge('a-key', 'a-end');
  c1.edge('a-check', 'a-hurt', { port: 'yes' });
  c1.edge('a-check', 'a-end', { port: 'no' });
  c1.edge('a-hurt', 'a-end');

  // Chapter 2: the knight (a butterfly effect into chapter 3), a conditional option, a jump ahead.
  const c2 = new Builder('g-ch2', 'chapter', 'Глава 2. Лес', 'r-ch2');
  c2.node('b-start', 'start', 'Начало');
  c2.node('b-edge', 'scene', 'Опушка');
  c2.node('b-knight', 'choice', 'Рыцарь просит о помощи', {
    options: [
      opt('o-free', 'Освободить', '', 'пощадил_рыцаря = истина; репутация += 1.5'),
      opt('o-pass', 'Пройти мимо', '', 'пощадил_рыцаря = ложь'),
    ],
  });
  c2.node('b-remember', 'butterfly', 'Рыцарь запомнит', {
    effects: 'репутация += 1',
    links: [{ graph: 'g-ch3', node: 'c-gate' }],
  });
  c2.node('b-fire', 'dialogue', 'Разговор у костра', {
    lines: [line('l4', 'ent-boris', 'Дальше опасно.'), line('l5', null, 'Костёр догорает.')],
  });
  c2.node('b-way', 'choice', 'Куда идти?', {
    options: [opt('o-river', 'К реке'), opt('o-thicket', 'Через чащу', 'есть_ключ')],
  });
  c2.node('b-river', 'scene', 'Река');
  c2.node('b-night', 'scene', 'Ночь');
  c2.node('b-gold', 'condition', 'Хватает золота?', { expr: 'золото > 2' });
  c2.node('b-trader', 'scene', 'Торговец');
  c2.node('b-buy', 'effect', 'Покупка', { effects: 'золото -= 2' });
  c2.node('b-door', 'scene', 'Старая дверь');
  c2.node('b-jump', 'jump', 'Тайный ход', { target: { graph: 'g-ch3', node: 'c-hall' } });
  c2.node('b-end', 'end', 'Конец главы 2');
  c2.node('b-boris', 'character', 'Борис', { ref: 'ent-boris' });
  c2.edge('b-start', 'b-edge');
  c2.edge('b-edge', 'b-knight');
  c2.edge('b-knight', 'b-remember', { port: 'o-free' });
  c2.edge('b-knight', 'b-fire', { port: 'o-pass' });
  c2.edge('b-remember', 'b-fire');
  c2.edge('b-fire', 'b-way');
  c2.edge('b-way', 'b-river', { port: 'o-river' });
  c2.edge('b-way', 'b-door', { port: 'o-thicket' });
  c2.edge('b-river', 'b-night');
  c2.edge('b-night', 'b-gold');
  c2.edge('b-gold', 'b-trader', { port: 'yes' });
  c2.edge('b-gold', 'b-end', { port: 'no' });
  c2.edge('b-trader', 'b-buy');
  c2.edge('b-buy', 'b-end');
  c2.edge('b-door', 'b-jump');

  // Chapter 3: the consequence of the knight, the gun fires.
  const c3 = new Builder('g-ch3', 'chapter', 'Глава 3. Замок', 'r-ch3');
  c3.node('c-start', 'start', 'Начало');
  c3.node('c-gate', 'scene', 'Рыцарь у ворот', { plotRole: 'consequence' });
  c3.node('c-spared', 'condition', 'Рыцарь пощажён?', { expr: 'пощадил_рыцаря' });
  c3.node('c-open', 'scene', 'Рыцарь открывает ворота');
  c3.node('c-closed', 'scene', 'Ворота заперты');
  c3.node('c-yard', 'choice', 'Как пройти двор?', {
    options: [opt('o-quiet', 'Тихо'), opt('o-fight', 'С боем', 'репутация >= 1')],
  });
  c3.node('c-sum', 'effect', 'Итог', { effects: 'доверие += 1' });
  c3.node('c-hall', 'dialogue', 'Тронный зал', { lines: [line('l6', 'ent-boris', 'Это конец пути.')] });
  c3.node('c-last', 'choice', 'Последний выбор', {
    options: [
      opt('o-shoot', 'Стрелять', 'есть_ключ или доверие >= 2'),
      opt('o-give', 'Сдаться', '', 'настроение = «зла»; спутник = «Борис»; прозвище = «трус»'),
    ],
  });
  c3.node('c-shot', 'scene', 'Выстрел', { plotRole: 'payoff' });
  c3.node('c-good', 'end', 'Хороший конец');
  c3.node('c-bad', 'end', 'Плохой конец');
  c3.node('c-item', 'item', 'Ключ', { ref: 'ent-key' });
  c3.node('c-where', 'location', 'Замок', { ref: 'ent-castle' });
  c3.edge('c-start', 'c-gate');
  c3.edge('c-gate', 'c-spared');
  c3.edge('c-spared', 'c-open', { port: 'yes' });
  c3.edge('c-spared', 'c-closed', { port: 'no' });
  c3.edge('c-open', 'c-sum');
  c3.edge('c-closed', 'c-yard');
  c3.edge('c-yard', 'c-sum', { port: 'o-quiet' });
  c3.edge('c-yard', 'c-sum', { port: 'o-fight' });
  c3.edge('c-sum', 'c-hall');
  c3.edge('c-hall', 'c-last');
  c3.edge('c-last', 'c-shot', { port: 'o-shoot' });
  c3.edge('c-last', 'c-bad', { port: 'o-give' });
  c3.edge('c-shot', 'c-good');

  for (const b of [root, c1, c2, c3]) data.graphs[b.g.id] = b.g as unknown as ProjectData['graphs'][string];
  return data;
}

/** Number of nodes (stickers included) and choices in the sample, for the test's sanity checks. */
export function sampleStats(data: ProjectData): { nodes: number; choices: number } {
  const graphs = Object.values(data.graphs) as unknown as GraphDoc[];
  return {
    nodes: graphs.reduce((s, g) => s + g.nodes.length, 0),
    choices: graphs.reduce((s, g) => s + g.nodes.filter((n) => asStory(n).kind === 'choice').length, 0),
  };
}
