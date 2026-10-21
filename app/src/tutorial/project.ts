// The tutorial project (F7-05, FR-APP-08): "The Last Lantern", a short story of our own that uses every part of
// HErPlan — chapters with dialogues, choices, conditions and plot devices, variables, a world database with
// types, catalogs of tags and relations, documents with live links, a task board, the project map and pictures.
// Notes on its canvases say what is what. Written for HErPlan in Russian and English.

import { createNode } from '../canvas/ops';
import { emptyGraph, type GraphDoc, type GraphEdge, type GraphNode } from '../canvas/model';
import { newProject } from '../core/project/create';
import type { JsonObject, ProjectData } from '../core/project/types';
import { addDocument, setBody } from '../documents/model';
import type { Locale } from '../i18n';
import { newMapGraph, refNode, REF_COLORS, type MapRef } from '../map/model';
import type { StoryNode } from '../story/model';
import { fitNode } from '../story/ops';
import type { Variable } from '../story/variables';
import { addLabel, updateLabel } from '../tasks/labels';
import {
  addBoard,
  addCheck,
  addTask,
  addTaskLink,
  listBoards,
  setCheck,
  toggleLabel,
  trashTask,
  updateTask,
  type TaskLink,
} from '../tasks/model';
import { addRelation } from '../world/entityOps';
import {
  addCatalog,
  addField,
  addSet,
  addTag,
  addType,
  attachSet,
  newField,
  setSection,
  type FieldDef,
} from '../world/schema';
import { catPortrait, cover, islandMap, lighthouse, portrait } from './art';
import '../story/kinds';

/** A picture of the project to write into its assets. */
export interface TutorialAsset {
  folder: string;
  name: string;
  text: string;
}

const COL = 320;
const ROW = 200;

class Canvas {
  readonly g: GraphDoc;
  constructor(id: string, kind: 'story' | 'chapter', name: string, parent: string | null) {
    this.g = emptyGraph(id, kind, name);
    if (parent) this.g.parent = { kind: 'node', id: parent };
  }

  node(id: string, kind: string, title: string, col: number, row: number, extra: Partial<StoryNode> = {}): StoryNode {
    const n = { ...createNode(kind, col * COL, row * ROW, title), ...extra, id } as StoryNode;
    fitNode(n);
    this.g.nodes.push(n);
    return n;
  }

  note(id: string, col: number, row: number, text: string, color = 'amber'): void {
    const n = createNode('sticker', col * COL, row * ROW, '');
    Object.assign(n, { id, text, color, w: 280, h: 150 });
    this.g.nodes.push(n);
  }

  edge(from: string, to: string, port = 'out'): void {
    const e: GraphEdge = {
      id: `e-${this.g.id}-${this.g.edges.length}`,
      from: { node: from, port },
      to: { node: to, port: 'in' },
    };
    this.g.edges.push(e);
  }
}

const opt = (id: string, text: string, condition = '', effects = '') => ({ id, text, condition, effects });
const line = (id: string, speaker: string | null, text: string) => ({ id, speaker, text });

/** A fragment of a line's text for a plot device laid over it. */
function range(text: string, quote: string) {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`"${quote}" is not in "${text}"`);
  return { start, end: start + quote.length, quote };
}

export function tutorialProject(
  locale: Locale,
  appVersion: string,
  now = new Date(),
): { data: ProjectData; assets: TutorialAsset[] } {
  const ru = locale === 'ru';
  const L = (r: string, e: string) => (ru ? r : e);

  const data = newProject({
    name: L('Учебный проект: Последний фонарь', 'Tutorial: The Last Lantern'),
    description: L(
      'Небольшая история, на которой видно всё, что умеет HErPlan. Меняйте что хотите.',
      'A short story that shows everything HErPlan can do. Change anything you like.',
    ),
    appVersion,
    now,
  });

  // ---------- pictures ----------
  const PORTRAITS = L('Портреты', 'Portraits');
  const PLACES = L('Места', 'Places');
  const asset = (folder: string, name: string) => `assets/${folder}/${name}`;
  const assets: TutorialAsset[] = [
    {
      folder: PORTRAITS,
      name: 'nika.svg',
      text: portrait({
        bg: ['#3a5a8c', '#24385a'],
        skin: '#f1c9a5',
        hair: '#6b3b22',
        shirt: '#2f7d6b',
        hairStyle: 'long',
        scarf: '#e0b84a',
      }),
    },
    {
      folder: PORTRAITS,
      name: 'yan.svg',
      text: portrait({
        bg: ['#4b4f62', '#2b2e3a'],
        skin: '#e3b48f',
        hair: '#d8d8d8',
        shirt: '#2a3f66',
        hairStyle: 'bald',
        beard: true,
      }),
    },
    {
      folder: PORTRAITS,
      name: 'vela.svg',
      text: portrait({
        bg: ['#7a4a3a', '#4a2c24'],
        skin: '#c98e66',
        hair: '#1f1a17',
        shirt: '#9c3d4a',
        hairStyle: 'bun',
      }),
    },
    {
      folder: PORTRAITS,
      name: 'ortega.svg',
      text: portrait({
        bg: ['#2f5d5a', '#1d3a38'],
        skin: '#b07a55',
        hair: '#2b211b',
        shirt: '#e3d7bd',
        hairStyle: 'short',
        beard: true,
      }),
    },
    { folder: PORTRAITS, name: 'suhar.svg', text: catPortrait() },
    { folder: PLACES, name: 'lighthouse.svg', text: lighthouse() },
    {
      folder: PLACES,
      name: 'island-map.svg',
      text: islandMap({
        island: L('Остров Гряда', 'Ridge Island'),
        lighthouse: L('Маяк', 'Lighthouse'),
        pier: L('Пристань', 'Pier'),
        stairs: L('Каменная лестница', 'Stone stairs'),
        north: L('С', 'N'),
      }),
    },
    { folder: '', name: 'cover.svg', text: cover(L('Последний фонарь', 'The Last Lantern')) },
  ];
  data.meta.cover = 'assets/cover.svg';
  // The tour tells the tutorial project from the designer's own.
  data.meta.tutorial = true;
  const MAP_PICTURE = asset(PLACES, 'island-map.svg');

  // ---------- the world database ----------
  const ROLES = {
    hero: L('Главная героиня', 'Protagonist'),
    mentor: L('Наставник', 'Mentor'),
    ally: L('Союзник', 'Ally'),
    trader: L('Торговец', 'Trader'),
    animal: L('Животное', 'Animal'),
  };
  const TIMES = { dusk: L('Сумерки', 'Dusk'), night: L('Ночь', 'Night'), dawn: L('Рассвет', 'Dawn') };
  const field = (id: string, kind: FieldDef['type'], label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
    ...newField(kind, label),
    ...extra,
    id,
  });

  const traits = addCatalog(data, L('Черты', 'Traits'));
  const tag = (name: string, description: string) => addTag(data, traits, name, description)!;
  const brave = tag(L('Смелая', 'Brave'), L('Не боится темноты и высоты.', 'Not afraid of the dark or of heights.'));
  const kind = tag(L('Добрая', 'Kind'), L('Помогает, даже когда некогда.', 'Helps even when there is no time.'));
  const stubborn = tag(
    L('Упрямый', 'Stubborn'),
    L('Делает по-своему, зато до конца.', 'Does it his way, but to the end.'),
  );
  const cunning = tag(
    L('Хитрая', 'Cunning'),
    L('Всё имеет цену — и она её знает.', 'Everything has a price, and she knows it.'),
  );
  const lazy = tag(
    L('Ленивый', 'Lazy'),
    L('Спит на тёплой лампе маяка.', 'Sleeps on the warm lamp of the lighthouse.'),
  );

  addField(
    data,
    { kind: 'type', id: 'character' },
    field('f-role', 'enum', L('Роль', 'Role'), { options: Object.values(ROLES) }),
  );
  addField(data, { kind: 'type', id: 'character' }, field('f-age', 'number', L('Возраст', 'Age')));
  addField(
    data,
    { kind: 'type', id: 'character' },
    field('f-traits', 'tags', L('Черты', 'Traits'), { catalog: traits }),
  );
  const stats = addSet(data, L('Игровые параметры', 'Game stats'), [
    field('f-health', 'number', L('Здоровье', 'Health')),
    field('f-speed', 'percent', L('Скорость', 'Speed')),
  ]);
  attachSet(data, 'character', stats, true);
  const animal = addType(data, L('Животное', 'Animal'), 'character');
  addField(data, { kind: 'type', id: animal }, field('f-breed', 'text', L('Порода', 'Breed')));
  setSection(data, animal, 'variables', false);
  addField(data, { kind: 'type', id: 'location' }, field('f-danger', 'percent', L('Опасность', 'Danger')));
  addField(
    data,
    { kind: 'type', id: 'location' },
    field('f-time', 'enum', L('Время суток', 'Time of day'), { options: Object.values(TIMES) }),
  );
  addField(
    data,
    { kind: 'type', id: 'item' },
    field('f-where', 'ref', L('Где найти', 'Where to find'), { target: 'location' }),
  );
  addField(data, { kind: 'type', id: 'item' }, field('f-value', 'number', L('Ценность', 'Value')));

  let order = 0;
  const entity = (
    id: string,
    type: string,
    name: string,
    description: string,
    values: JsonObject,
    image: string | null = null,
  ) => {
    order += 10;
    data.entities[id] = { id, type, name, description, image, order, values, relations: [] };
  };
  const N = {
    nika: L('Ника', 'Nika'),
    yan: L('Ян', 'Yan'),
    vela: L('Вела', 'Vela'),
    ortega: L('Ортега', 'Ortega'),
    suhar: L('Сухарь', 'Biscuit'),
  };
  entity(
    'tut-nika',
    'character',
    N.nika,
    L(
      'Ученица смотрителя маяка. Обещала зажечь лампу до полуночи, когда придёт «Альбатрос».',
      'The lighthouse keeper’s apprentice. She promised to light the lamp before midnight, when the Albatross arrives.',
    ),
    { 'f-role': ROLES.hero, 'f-age': 15, 'f-traits': [brave, kind], 'f-health': 10, 'f-speed': 70 },
    asset(PORTRAITS, 'nika.svg'),
  );
  entity(
    'tut-yan',
    'character',
    N.yan,
    L(
      'Старый смотритель. Сорок лет держит свет и не любит торопиться.',
      'The old keeper. He has kept the light for forty years and dislikes haste.',
    ),
    { 'f-role': ROLES.mentor, 'f-age': 67, 'f-traits': [stubborn], 'f-health': 6, 'f-speed': 30 },
    asset(PORTRAITS, 'yan.svg'),
  );
  entity(
    'tut-vela',
    'character',
    N.vela,
    L(
      'Торговка с пристани. Продаст масло — или попросит помочь.',
      'A trader on the pier. She will sell oil — or ask for a hand.',
    ),
    { 'f-role': ROLES.trader, 'f-age': 34, 'f-traits': [cunning, kind], 'f-health': 8, 'f-speed': 50 },
    asset(PORTRAITS, 'vela.svg'),
  );
  entity(
    'tut-ortega',
    'character',
    N.ortega,
    L(
      'Лоцман «Альбатроса». Ведёт корабль сквозь туман по свету маяка.',
      'The pilot of the Albatross. He steers through the fog by the lighthouse’s light.',
    ),
    { 'f-role': ROLES.ally, 'f-age': 41, 'f-traits': [], 'f-health': 9, 'f-speed': 55 },
    asset(PORTRAITS, 'ortega.svg'),
  );
  entity(
    'tut-suhar',
    animal,
    N.suhar,
    L(
      'Кот маяка. Знает все тёплые места и всегда рядом, когда страшно.',
      'The lighthouse cat. Knows every warm spot and is always near when it is scary.',
    ),
    {
      'f-role': ROLES.animal,
      'f-age': 4,
      'f-traits': [lazy],
      'f-breed': L('Рыжий', 'Ginger'),
      'f-own-spot': L('На лампе', 'On the lamp'),
    },
    asset(PORTRAITS, 'suhar.svg'),
  );
  // A field of this card only (0.5): no other card has it.
  data.entities['tut-suhar'].fields = [
    field('f-own-spot', 'text', L('Любимое место', 'Favourite spot')),
  ] as unknown as JsonObject[];
  entity(
    'tut-lighthouse',
    'location',
    L('Маяк', 'Lighthouse'),
    L(
      'Белая башня с красными поясами на скале. Сто двенадцать ступеней до лампы.',
      'A white tower with red bands on a rock. A hundred and twelve steps up to the lamp.',
    ),
    { 'f-danger': 20, 'f-time': TIMES.night },
    asset(PLACES, 'lighthouse.svg'),
  );
  entity(
    'tut-pier',
    'location',
    L('Пристань', 'Pier'),
    L(
      'Лодки, сети и бочки. Здесь всё продаётся и всё слышно.',
      'Boats, nets and barrels. Everything is sold here and everything is heard.',
    ),
    { 'f-danger': 10, 'f-time': TIMES.dusk },
  );
  entity(
    'tut-stairs',
    'location',
    L('Каменная лестница', 'Stone stairs'),
    L('Путь от пристани к маяку. Скользко и темно.', 'The way from the pier to the lighthouse. Slippery and dark.'),
    { 'f-danger': 40, 'f-time': TIMES.night },
  );
  entity(
    'tut-compass',
    'item',
    L('Компас без стрелки', 'Compass without a needle'),
    L(
      'Подарок Яна. Стрелки нет — но зачем-то он его хранит.',
      'A gift from Yan. It has no needle, yet he keeps it for some reason.',
    ),
    { 'f-where': 'tut-lighthouse', 'f-value': 1 },
  );
  entity(
    'tut-wick',
    'item',
    L('Фитиль', 'Wick'),
    L('Моток фитиля для лампы маяка.', 'A coil of wick for the lighthouse lamp.'),
    {
      'f-where': 'tut-lighthouse',
      'f-value': 2,
    },
  );
  entity(
    'tut-oil',
    'item',
    L('Бочонок масла', 'Barrel of oil'),
    L('Масло для лампы. Без него свет не зажечь.', 'Oil for the lamp. No light without it.'),
    {
      'f-where': 'tut-pier',
      'f-value': 3,
    },
  );
  addRelation(data, 'tut-yan', 'tut-nika', L('ученица', 'apprentice'), L('наставник', 'mentor'));
  addRelation(data, 'tut-nika', 'tut-vela', L('подруга', 'friend'), L('подруга', 'friend'));
  addRelation(data, 'tut-nika', 'tut-suhar', L('питомец', 'pet'), L('хозяйка', 'owner'));
  addRelation(data, 'tut-ortega', 'tut-vela', L('кредитор', 'creditor'), L('должник', 'debtor'));

  // ---------- variables ----------
  const V = {
    oil: L('масло', 'oil'),
    wick: L('фитиль', 'wick'),
    helped: L('помогла_веле', 'helped_vela'),
    coins: L('монеты', 'coins'),
    trust: L('доверие', 'trust'),
  };
  const yes = L('истина', 'true');
  const and = L('и', 'and');
  const variables: Variable[] = [
    {
      id: 'v-oil',
      name: V.oil,
      type: 'int',
      initial: 0,
      scope: 'project',
      owner: null,
      description: L('Сколько масла для лампы.', 'How much oil there is for the lamp.'),
    },
    {
      id: 'v-wick',
      name: V.wick,
      type: 'bool',
      initial: false,
      scope: 'project',
      owner: null,
      description: L('Нашла ли Ника новый фитиль.', 'Whether Nika found a new wick.'),
    },
    {
      id: 'v-helped',
      name: V.helped,
      type: 'bool',
      initial: false,
      scope: 'project',
      owner: null,
      description: L('Помогла ли Ника Веле с сетями.', 'Whether Nika helped Vela with the nets.'),
    },
    {
      id: 'v-coins',
      name: V.coins,
      type: 'int',
      initial: 3,
      scope: 'project',
      owner: null,
      description: L('Монеты в кармане Ники.', 'Coins in Nika’s pocket.'),
    },
    {
      id: 'v-trust',
      name: V.trust,
      type: 'int',
      initial: 0,
      scope: 'project',
      owner: { kind: 'entity', id: 'tut-yan' },
      description: L(
        'Насколько Ян доверяет ученице. Пишется как «Ян.доверие».',
        'How much Yan trusts his apprentice. Written as “Yan.trust”.',
      ),
    },
  ];
  const yanTrust = `${N.yan}.${V.trust}`;

  // ---------- the story ----------
  const root = new Canvas('g-root', 'story', L('Сценарий', 'Story'), null);
  root.node('r-start', 'start', L('Начало', 'Start'), 0, 0);
  root.node('r-ch1', 'chapter', L('Глава 1. Туман', 'Chapter 1. Fog'), 1, 0, {
    graph: 'g-ch1',
    text: L(
      'Лампа маяка погасла. Ника берётся её зажечь.',
      'The lighthouse lamp has gone out. Nika sets out to light it.',
    ),
    image: asset(PLACES, 'lighthouse.svg'),
  });
  root.node('r-ch2', 'chapter', L('Глава 2. Пристань', 'Chapter 2. The pier'), 2, 0, {
    graph: 'g-ch2',
    text: L('Где взять масло для лампы.', 'Where to get oil for the lamp.'),
  });
  root.node('r-ch3', 'chapter', L('Глава 3. Огонь', 'Chapter 3. Fire'), 3, 0, {
    graph: 'g-ch3',
    text: L('Успеет ли Ника до корабля.', 'Will Nika make it before the ship.'),
  });
  root.node('r-end', 'end', L('Конец', 'The end'), 4, 0);
  root.edge('r-start', 'r-ch1');
  root.edge('r-ch1', 'r-ch2');
  root.edge('r-ch2', 'r-ch3');
  root.edge('r-ch3', 'r-end');
  root.note(
    'r-note1',
    1,
    1.4,
    L(
      'Это обзор сюжета: главы и их порядок. Двойной щелчок по главе — войти в неё; обратно — по «хлебным крошкам» над холстом.',
      'This is the story overview: chapters in their order. Double-click a chapter to go into it; go back with the breadcrumbs above the canvas.',
    ),
  );
  root.note(
    'r-note2',
    2.2,
    1.4,
    L(
      'Кнопка «Пройти» над холстом проигрывает историю как игру — с выборами и переменными. Попробуйте найти все три концовки.',
      'The Play button above the canvas plays the story like a game — with choices and variables. Try to find all three endings.',
    ),
    'teal',
  );

  // Chapter 1: a dialogue with a "Chekhov's gun" laid over words of a line, a choice, an effect.
  const yanLine = L(
    'Нужны масло и новый фитиль. И возьми мой компас — тот, что без стрелки.',
    'You need oil and a new wick. And take my compass — the one without a needle.',
  );
  const c1 = new Canvas('g-ch1', 'chapter', L('Глава 1. Туман', 'Chapter 1. Fog'), 'r-ch1');
  c1.node('a-start', 'start', L('Начало', 'Start'), 0, 0);
  c1.node('a-dusk', 'scene', L('Сумерки', 'Dusk'), 1, 0, {
    text: L(
      'Туман поднимается с моря. Маяк тёмный — лампа погасла.',
      'Fog rises from the sea. The lighthouse is dark: the lamp has gone out.',
    ),
  });
  c1.node('a-yan', 'dialogue', L('Старый Ян', 'Old Yan'), 2, 0, {
    lines: [
      line(
        'l1',
        'tut-yan',
        L('Лампа погасла, а к полуночи придёт «Альбатрос».', 'The lamp is out, and the Albatross comes at midnight.'),
      ),
      line('l2', 'tut-nika', L('Я зажгу её, обещаю!', 'I will light it, I promise!')),
      line('l3', 'tut-yan', yanLine),
      line(
        'l4',
        null,
        L('Ника прячет компас в карман. Зачем он ей?', 'Nika puts the compass in her pocket. What is it for?'),
      ),
    ],
    marks: [
      {
        id: 'm-compass',
        device: 'gun',
        anchor: { kind: 'line', id: 'l3' },
        range: range(yanLine, L('компас — тот, что без стрелки', 'compass — the one without a needle')),
        links: [{ graph: 'g-ch3', node: 'c-compass' }],
        note: L('Компас «выстрелит» в главе 3.', 'The compass will “fire” in chapter 3.'),
        variables: [],
      },
    ],
  });
  c1.node('a-choice', 'choice', L('С чего начать?', 'Where to start?'), 3, 0, {
    options: [
      opt('o-store', L('Спуститься в кладовую', 'Go down to the storeroom')),
      opt('o-ask', L('Расспросить Яна о маяке', 'Ask Yan about the lighthouse'), '', `${yanTrust} += 1`),
    ],
  });
  c1.node('a-story', 'dialogue', L('Рассказ Яна', 'Yan’s story'), 4, 1, {
    lines: [
      line('l5', 'tut-yan', L('Сорок лет этот свет не гас ни разу.', 'For forty years this light never went out.')),
      line('l6', 'tut-nika', L('А теперь погас из-за меня?', 'And now it has, because of me?')),
      line('l7', 'tut-yan', L('Из-за ветра. Но чинить — тебе.', 'Because of the wind. But mending it is up to you.')),
    ],
  });
  c1.node('a-store', 'scene', L('Кладовая', 'The storeroom'), 4, 0, {
    text: L('Среди сетей и вёсел — моток фитиля.', 'Among nets and oars, a coil of wick.'),
  });
  c1.node('a-wick', 'effect', L('Нашла фитиль', 'Found the wick'), 5, 0, { effects: `${V.wick} = ${yes}` });
  c1.node('a-end', 'end', L('К пристани', 'To the pier'), 6, 0);
  c1.node('a-who', 'character', N.nika, 1, 2, { ref: 'tut-nika' });
  c1.node('a-mentor', 'character', N.yan, 2, 2, { ref: 'tut-yan' });
  c1.node('a-where', 'location', L('Маяк', 'Lighthouse'), 3, 2, { ref: 'tut-lighthouse' });
  c1.node('a-item', 'item', L('Компас без стрелки', 'Compass without a needle'), 4, 2.2, { ref: 'tut-compass' });
  c1.edge('a-start', 'a-dusk');
  c1.edge('a-dusk', 'a-yan');
  c1.edge('a-yan', 'a-choice');
  c1.edge('a-choice', 'a-store', 'o-store');
  c1.edge('a-choice', 'a-story', 'o-ask');
  c1.edge('a-story', 'a-store');
  c1.edge('a-store', 'a-wick');
  c1.edge('a-wick', 'a-end');
  c1.note(
    'a-note1',
    1.6,
    -1.2,
    L(
      'Диалог: реплики с говорящими. Подсвеченные слова «компас — тот, что без стрелки» — «ружьё Чехова»: деталь, которая сработает позже, в главе 3.',
      'A dialogue: lines with speakers. The highlighted words “compass — the one without a needle” are a Chekhov’s gun: a detail that pays off later, in chapter 3.',
    ),
  );
  c1.note(
    'a-note2',
    3,
    -1.2,
    L(
      'Выбор: у каждого варианта своя связь. Щёлкните по узлу — справа откроется инспектор с условиями и последствиями вариантов.',
      'A choice: every option has its own link. Click the node to open the inspector on the right with the options’ conditions and effects.',
    ),
    'violet',
  );
  c1.note(
    'a-note3',
    5,
    1.5,
    L(
      'Узлы «Персонаж», «Место», «Предмет» ссылаются на карточки базы данных: двойной щелчок открывает карточку.',
      'Character, Location and Item nodes point at cards of the database: double-click one to open its card.',
    ),
    'green',
  );

  // Chapter 2: a "butterfly effect" laid over an option, a conditional option, a condition node.
  const c2 = new Canvas('g-ch2', 'chapter', L('Глава 2. Пристань', 'Chapter 2. The pier'), 'r-ch2');
  c2.node('b-start', 'start', L('Начало', 'Start'), 0, 0);
  c2.node('b-pier', 'scene', L('Пристань', 'The pier'), 1, 0, {
    text: L(
      'Лодки качаются в тумане. У бочек — торговка Вела.',
      'Boats rock in the fog. By the barrels stands Vela the trader.',
    ),
  });
  c2.node('b-vela', 'dialogue', N.vela, 2, 0, {
    lines: [
      line(
        'l8',
        'tut-vela',
        L(
          'Масло? Есть бочонок. Но сети сами себя не распутают.',
          'Oil? I have a barrel. But the nets won’t untangle themselves.',
        ),
      ),
      line('l9', 'tut-nika', L('А если заплатить?', 'And if I pay?')),
      line('l10', 'tut-vela', L(`Три монеты. У тебя их {${V.coins}}.`, `Three coins. You have {${V.coins}}.`)),
    ],
  });
  c2.node('b-choice', 'choice', L('Как добыть масло?', 'How to get the oil?'), 3, 0, {
    options: [
      opt('o-help', L('Помочь Веле с сетями', 'Help Vela with the nets'), '', `${V.helped} = ${yes}`),
      opt(
        'o-buy',
        L('Купить масло за три монеты', 'Buy the oil for three coins'),
        `${V.coins} >= 3`,
        `${V.coins} -= 3; ${V.oil} += 1`,
      ),
      opt('o-leave', L('Уйти ни с чем', 'Leave empty-handed')),
    ],
    marks: [
      {
        id: 'm-nets',
        device: 'butterfly',
        anchor: { kind: 'option', id: 'o-help' },
        range: null,
        links: [{ graph: 'g-ch3', node: 'c-vela' }],
        note: L('Вела запомнит помощь.', 'Vela will remember the help.'),
        variables: ['v-helped'],
      },
    ],
  });
  c2.node('b-nets', 'scene', L('Сети', 'The nets'), 4, -0.8, {
    text: L('Узлы мокрые и тугие. Солнце садится.', 'The knots are wet and tight. The sun is setting.'),
  });
  c2.node('b-check', 'condition', L('Есть масло?', 'Any oil?'), 5, 0, { expr: `${V.oil} > 0` });
  c2.node('b-oil', 'scene', L('Бочонок у ног', 'A barrel at her feet'), 6, -0.6);
  c2.node('b-empty', 'scene', L('Пустые руки', 'Empty hands'), 6, 0.6, {
    text: L('Может, кто-то ещё поможет?', 'Maybe someone else will help?'),
  });
  c2.node('b-end', 'end', L('К маяку', 'To the lighthouse'), 7, 0);
  c2.node('b-who', 'character', N.vela, 2, 1.6, { ref: 'tut-vela' });
  c2.node('b-where', 'location', L('Пристань', 'Pier'), 3, 1.6, { ref: 'tut-pier' });
  c2.edge('b-start', 'b-pier');
  c2.edge('b-pier', 'b-vela');
  c2.edge('b-vela', 'b-choice');
  c2.edge('b-choice', 'b-nets', 'o-help');
  c2.edge('b-choice', 'b-check', 'o-buy');
  c2.edge('b-choice', 'b-check', 'o-leave');
  c2.edge('b-nets', 'b-check');
  c2.edge('b-check', 'b-oil', 'yes');
  c2.edge('b-check', 'b-empty', 'no');
  c2.edge('b-oil', 'b-end');
  c2.edge('b-empty', 'b-end');
  c2.note(
    'b-note1',
    3,
    -1.8,
    L(
      'Вариант «Помочь Веле» — «эффект бабочки»: его последствие ждёт в главе 3. «Купить масло» виден, только если монет хватает (условие варианта).',
      '“Help Vela” is a butterfly effect: its consequence waits in chapter 3. “Buy the oil” shows only when there are enough coins (the option’s condition).',
    ),
  );
  c2.note(
    'b-note2',
    5,
    1.4,
    L(
      'Условие ведёт по «да» или «нет». Выражения пишутся словами: «масло > 0», «монеты -= 3». Все переменные — в панели «Переменные и метки» (кнопка (x) вверху).',
      'A condition leads along “yes” or “no”. Expressions are written in words: “oil > 0”, “coins -= 3”. All variables are in the Variables and labels panel (the (x) button at the top).',
    ),
    'violet',
  );

  // Chapter 3: the consequence of the butterfly, the gun fires, three endings.
  const c3 = new Canvas('g-ch3', 'chapter', L('Глава 3. Огонь', 'Chapter 3. Fire'), 'r-ch3');
  c3.node('c-start', 'start', L('Начало', 'Start'), 0, 0);
  c3.node('c-stairs', 'scene', L('Каменная лестница', 'The stone stairs'), 1, 0, {
    text: L('Сто двенадцать ступеней вверх, в темноте.', 'A hundred and twelve steps up, in the dark.'),
  });
  c3.node('c-helped', 'condition', L('Вела помогла?', 'Did Vela help?'), 2, 0, { expr: V.helped });
  c3.node('c-vela', 'scene', L('Вела приносит масло', 'Vela brings the oil'), 3, -0.8, {
    text: L(
      'Вела догоняет Нику с бочонком: «Должок за сети!»',
      'Vela catches up with a barrel: “I owe you for the nets!”',
    ),
    plotRoles: ['consequence'],
  });
  c3.node('c-gift', 'effect', L('Подарок Велы', 'Vela’s gift'), 4, -0.8, { effects: `${V.oil} += 1` });
  c3.node('c-lamp', 'condition', L('Есть чем зажечь?', 'Can the lamp be lit?'), 5, 0, {
    expr: `${V.oil} > 0 ${and} ${V.wick}`,
  });
  c3.node('c-fire', 'scene', L('Огонь горит', 'The fire burns'), 6, -0.6, {
    text: L(
      'Свет режет туман. Далеко в море — огни «Альбатроса».',
      'The light cuts the fog. Far out at sea — the lights of the Albatross.',
    ),
  });
  c3.node('c-ship', 'choice', L('Корабль в тумане', 'A ship in the fog'), 7, -0.6, {
    options: [
      opt('o-compass', L('Вспомнить про компас', 'Remember the compass')),
      opt('o-signal', L('Подать сигнал, как учил Ян', 'Signal as Yan taught'), `${yanTrust} >= 1`),
      opt('o-wait', L('Ждать рассвета', 'Wait for dawn')),
    ],
  });
  c3.node('c-compass', 'scene', L('Компас указывает путь', 'The compass shows the way'), 8, -1.4, {
    text: L(
      'Стрелки нет — но в луче маяка компас светится и показывает фарватер.',
      'There is no needle — but in the lighthouse’s beam the compass glows and shows the fairway.',
    ),
    plotRoles: ['payoff'],
  });
  c3.node('c-saved', 'end', L('Корабль спасён', 'The ship is saved'), 9, -1);
  c3.node('c-dawn', 'end', L('Долгая ночь', 'A long night'), 9, 0);
  c3.node('c-dark', 'end', L('Маяк тёмный', 'The lighthouse stays dark'), 6, 0.8);
  c3.node('c-where', 'location', L('Каменная лестница', 'Stone stairs'), 1, 1.4, { ref: 'tut-stairs' });
  c3.node('c-pilot', 'character', N.ortega, 7, 1, { ref: 'tut-ortega' });
  c3.edge('c-start', 'c-stairs');
  c3.edge('c-stairs', 'c-helped');
  c3.edge('c-helped', 'c-vela', 'yes');
  c3.edge('c-helped', 'c-lamp', 'no');
  c3.edge('c-vela', 'c-gift');
  c3.edge('c-gift', 'c-lamp');
  c3.edge('c-lamp', 'c-fire', 'yes');
  c3.edge('c-lamp', 'c-dark', 'no');
  c3.edge('c-fire', 'c-ship');
  c3.edge('c-ship', 'c-compass', 'o-compass');
  c3.edge('c-ship', 'c-saved', 'o-signal');
  c3.edge('c-ship', 'c-dawn', 'o-wait');
  c3.edge('c-compass', 'c-saved');
  c3.note(
    'c-note1',
    3,
    -2.2,
    L(
      'Здесь сходятся нити: последствие «бабочки» из главы 2 и выстрел «ружья» из главы 1. Если связь потеряется, проверки (кнопка с треугольником) скажут об этом.',
      'The threads meet here: the consequence of the butterfly from chapter 2 and the payoff of the gun from chapter 1. If a link gets lost, the checks (the triangle button) will say so.',
    ),
  );
  c3.note(
    'c-note2',
    8,
    0.9,
    L(
      'Три концовки — три узла «Конец». Кнопка «Пройти» покажет, к какой из них привели выборы.',
      'Three endings — three End nodes. The Play button shows which one your choices led to.',
    ),
    'teal',
  );

  for (const c of [root, c1, c2, c3]) data.graphs[c.g.id] = c.g as unknown as ProjectData['graphs'][string];

  // ---------- documents ----------
  const docs = {
    start: addDocument(data, '', L('Начните здесь', 'Start here')),
    gdd: addDocument(data, L('Диздок', 'Design'), L('Диздок «Последний фонарь»', 'Design document: The Last Lantern')),
    island: addDocument(data, L('Мир', 'World'), L('Остров Гряда', 'Ridge Island')),
    level: addDocument(data, L('Уровни', 'Levels'), L('Каменная лестница', 'The stone stairs')),
  };
  const ent = (id: string) => `[[ent:${id}|${String(data.entities[id].name)}]]`;
  const node = (graph: string, id: string, label: string) => `[[node:${graph}/${id}|${label}]]`;
  const doc = (id: string, label: string) => `[[doc:${id}|${label}]]`;
  const live = (id: string, f: string) => `{{ent:${id}.${f}}}`;
  const fileLink = (path: string, label: string) => `[[asset:${path}|${label}]]`;

  setBody(
    data,
    docs.start,
    ru
      ? `# Начните здесь

Это учебный проект HErPlan — короткая история «Последний фонарь». Здесь можно всё трогать: менять, удалять, добавлять. Если что-то сломалось — Ctrl+Z или «История версий» вверху.

## Что посмотреть

1. **Сценарий** — ${node('g-root', 'r-ch1', 'Глава 1. Туман')}, ${node('g-root', 'r-ch2', 'Глава 2. Пристань')}, ${node('g-root', 'r-ch3', 'Глава 3. Огонь')}. На холстах — жёлтые заметки с подсказками.
2. **Прохождение** — во вкладке «Сценарий» кнопка «Пройти»: сыграйте историю и найдите три концовки.
3. **База данных** — персонажи ${ent('tut-nika')}, ${ent('tut-yan')}, ${ent('tut-vela')}, места и предметы; черты из справочника, связи между героями.
4. **Документы** — ${doc(docs.gdd, 'диздок')}, вики ${doc(docs.island, 'об острове')}, ${doc(docs.level, 'документ уровня')}. Ссылки в тексте ведут на карточки и главы, а имена в них меняются сами.
5. **Задачи** — доска «Производство»: метки, чек-листы, связи с главами и карточками.
6. **Карта проекта** — весь проект на одном холсте.
7. **Ресурсы** — портреты и картинки, например карта острова: ${fileLink(MAP_PICTURE, 'island-map.svg')}.

## Полезное

- **Ctrl+K** — поиск по всему проекту, по части слова.
- **@** в тексте документа — ссылка на карточку, главу, документ или файл.
- У карточки внизу — «Где используется»: в каких узлах, документах и задачах она встречается.
- Тур по программе можно пройти снова: **Настройки → Пройти тур**.
`
      : `# Start here

This is the HErPlan tutorial project — a short story, “The Last Lantern”. Touch anything here: change, delete, add. If something breaks — Ctrl+Z, or Version history at the top.

## What to look at

1. **Story** — ${node('g-root', 'r-ch1', 'Chapter 1. Fog')}, ${node('g-root', 'r-ch2', 'Chapter 2. The pier')}, ${node('g-root', 'r-ch3', 'Chapter 3. Fire')}. The canvases have yellow notes with hints.
2. **Playthrough** — the Play button on the Story tab: play the story and find all three endings.
3. **Database** — the characters ${ent('tut-nika')}, ${ent('tut-yan')}, ${ent('tut-vela')}, places and items; traits from a catalog, relations between the characters.
4. **Documents** — the ${doc(docs.gdd, 'design document')}, a wiki ${doc(docs.island, 'about the island')}, a ${doc(docs.level, 'level document')}. Links in the text lead to cards and chapters, and the names in them follow by themselves.
5. **Tasks** — the Production board: labels, checklists, links to chapters and cards.
6. **Project map** — the whole project on one canvas.
7. **Assets** — portraits and pictures, such as the island map: ${fileLink(MAP_PICTURE, 'island-map.svg')}.

## Good to know

- **Ctrl+K** — search the whole project by a part of a word.
- **@** in a document's text — a link to a card, a chapter, a document or a file.
- At the bottom of a card — Where used: the nodes, documents and tasks it appears in.
- The tour can be taken again: **Settings → Take the tour**.
`,
  );
  setBody(
    data,
    docs.gdd,
    ru
      ? `# Последний фонарь

## Коротко

Небольшое повествовательное приключение на одну ночь. Ученица смотрителя ${ent('tut-nika')} должна зажечь лампу маяка до прихода корабля.

## Игровой цикл

1. Исследовать место и говорить с жителями.
2. Добывать нужное: масло, фитиль — разными путями.
3. Выбирать, кому помочь: выборы возвращаются позже.

## Герои

| Герой | Роль | Возраст |
| --- | --- | --- |
| ${ent('tut-nika')} | ${live('tut-nika', 'f-role')} | ${live('tut-nika', 'f-age')} |
| ${ent('tut-yan')} | ${live('tut-yan', 'f-role')} | ${live('tut-yan', 'f-age')} |
| ${ent('tut-vela')} | ${live('tut-vela', 'f-role')} | ${live('tut-vela', 'f-age')} |

В таблице — живые значения полей карточек: поменяйте возраст в карточке, и он поменяется здесь.

## Сюжет

- ${node('g-root', 'r-ch1', 'Глава 1. Туман')} — завязка и «ружьё»: компас без стрелки.
- ${node('g-root', 'r-ch2', 'Глава 2. Пристань')} — выбор, который вернётся: помочь ли Веле.
- ${node('g-root', 'r-ch3', 'Глава 3. Огонь')} — три концовки.

## Мир

Действие — на ${doc(docs.island, 'острове Гряда')}. Самый трудный участок пути — ${doc(docs.level, 'каменная лестница')}.
`
      : `# The Last Lantern

## In short

A small narrative adventure that takes one night. The keeper's apprentice ${ent('tut-nika')} must light the lighthouse lamp before the ship arrives.

## Core loop

1. Explore the place and talk to its people.
2. Get what is needed — oil, a wick — in different ways.
3. Choose whom to help: choices come back later.

## Characters

| Character | Role | Age |
| --- | --- | --- |
| ${ent('tut-nika')} | ${live('tut-nika', 'f-role')} | ${live('tut-nika', 'f-age')} |
| ${ent('tut-yan')} | ${live('tut-yan', 'f-role')} | ${live('tut-yan', 'f-age')} |
| ${ent('tut-vela')} | ${live('tut-vela', 'f-role')} | ${live('tut-vela', 'f-age')} |

The table shows live values of the cards' fields: change an age on a card and it changes here.

## Story

- ${node('g-root', 'r-ch1', 'Chapter 1. Fog')} — the setup and the gun: a compass without a needle.
- ${node('g-root', 'r-ch2', 'Chapter 2. The pier')} — a choice that comes back: whether to help Vela.
- ${node('g-root', 'r-ch3', 'Chapter 3. Fire')} — three endings.

## World

It all happens on ${doc(docs.island, 'Ridge Island')}. The hardest part of the way is ${doc(docs.level, 'the stone stairs')}.
`,
  );
  setBody(
    data,
    docs.island,
    ru
      ? `# Остров Гряда

![Карта острова](<${MAP_PICTURE}>)

Скалистый остров в холодном море. На северной скале — ${ent('tut-lighthouse')}, у южного берега — ${ent('tut-pier')}. Между ними — ${ent('tut-stairs')}.

## Жители

- ${ent('tut-yan')} — смотритель маяка.
- ${ent('tut-vela')} — торговка на пристани.
- ${ent('tut-suhar')} — кот маяка.

> Карта нарисована в ресурсах проекта: её можно заменить своей, и картинка в документе останется на месте.
`
      : `# Ridge Island

![Island map](<${MAP_PICTURE}>)

A rocky island in a cold sea. On the northern rock stands the ${ent('tut-lighthouse')}, by the southern shore the ${ent('tut-pier')}. Between them, the ${ent('tut-stairs')}.

## People

- ${ent('tut-yan')} — the lighthouse keeper.
- ${ent('tut-vela')} — a trader on the pier.
- ${ent('tut-suhar')} — the lighthouse cat.

> The map lives in the project's assets: replace it with your own and the picture in the document stays in place.
`,
  );
  setBody(
    data,
    docs.level,
    ru
      ? `# Каменная лестница

Уровень главы 3: ${node('g-ch3', 'c-stairs', 'Каменная лестница')}.

## Цель

Подняться к лампе маяка до полуночи с маслом и фитилём.

## Путь

| Участок | Опасность | Что происходит |
| --- | --- | --- |
| Нижний пролёт | низкая | ветер, брызги |
| Поворот у скалы | средняя | скользкие ступени |
| Верхняя площадка | высокая | темно, нужен свет |

Опасность места в базе: ${live('tut-stairs', 'f-danger')} %.
`
      : `# The stone stairs

The level of chapter 3: ${node('g-ch3', 'c-stairs', 'The stone stairs')}.

## Goal

Climb to the lighthouse lamp before midnight with oil and a wick.

## The way

| Part | Danger | What happens |
| --- | --- | --- |
| Lower flight | low | wind, spray |
| Turn by the rock | medium | slippery steps |
| Top landing | high | dark, a light is needed |

The place's danger in the database: ${live('tut-stairs', 'f-danger')} %.
`,
  );

  // ---------- variables, labels and tasks ----------
  data.variables = { variables, labels: [] };
  const label = (name: string, color: string, pattern: 'stripes' | 'dots' | 'grid' | 'waves', symbol: string) => {
    const id = addLabel(data, name, color);
    updateLabel(data, id, { pattern, symbol });
    return id;
  };
  const story = label(L('Сюжет', 'Story'), '#a46ae0', 'stripes', '✎');
  const art = label(L('Арт', 'Art'), '#f0a43c', 'dots', '★');
  const code = label(L('Код', 'Code'), '#4f8fe6', 'grid', '⚙');
  const sound = label(L('Звук', 'Sound'), '#2bb5a8', 'waves', '♪');

  const board = addBoard(data, L('Производство', 'Production'), [
    L('Идеи', 'Ideas'),
    L('В работе', 'Doing'),
    L('Готово', 'Done'),
  ]);
  const [ideas, doing, done] = listBoards(data)[0].lists.map((l) => l.id);
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const task = (
    list: string,
    title: string,
    description: string,
    labels: string[],
    checklist: [string, boolean][],
    links: TaskLink[],
  ) => {
    const id = addTask(data, board, list, title, undefined, at)!;
    updateTask(data, board, id, { description });
    for (const l of labels) toggleLabel(data, board, id, l);
    checklist.forEach(([text, isDone], i) => {
      addCheck(data, board, id, text);
      if (isDone) setCheck(data, board, id, i, { done: true });
    });
    for (const link of links) addTaskLink(data, board, id, link);
    return id;
  };
  task(
    ideas,
    L('Шум прибоя на пристани', 'Surf sounds on the pier'),
    L('Тихий фон для главы 2.', 'A quiet background for chapter 2.'),
    [sound],
    [],
    [{ kind: 'entity', id: 'tut-pier' }],
  );
  task(
    ideas,
    L('Кот Сухарь подсказывает путь', 'Biscuit the cat hints the way'),
    L('Кот может вести Нику по лестнице в темноте.', 'The cat could lead Nika up the stairs in the dark.'),
    [story],
    [],
    [
      { kind: 'entity', id: 'tut-suhar' },
      { kind: 'graph', id: 'g-ch3' },
    ],
  );
  task(
    doing,
    L('Дописать концовку «Долгая ночь»', 'Finish the ending “A long night”'),
    L('Сейчас концовка — один узел. Нужна сцена рассвета.', 'For now the ending is one node. A dawn scene is needed.'),
    [story],
    [
      [L('Черновик', 'Draft'), true],
      [L('Реплики Яна', 'Yan’s lines'), false],
      [L('Пройти «Прохождением»', 'Check it in the playthrough'), false],
    ],
    [
      { kind: 'node', id: 'g-ch3/c-dawn' },
      { kind: 'entity', id: 'tut-yan' },
    ],
  );
  task(
    doing,
    L('Портрет Ортеги', 'Ortega’s portrait'),
    L('Нужен более живой вариант.', 'A livelier version is needed.'),
    [art],
    [
      [L('Набросок', 'Sketch'), true],
      [L('Цвет', 'Colour'), false],
    ],
    [
      { kind: 'entity', id: 'tut-ortega' },
      { kind: 'asset', id: asset(PORTRAITS, 'ortega.svg') },
    ],
  );
  task(
    done,
    L('Карта острова', 'Island map'),
    '',
    [art],
    [[L('Нарисовать', 'Draw'), true]],
    [
      { kind: 'asset', id: MAP_PICTURE },
      { kind: 'document', id: docs.island },
    ],
  );
  task(
    done,
    L('Проверить все концовки', 'Check all endings'),
    L('Каждая концовка достижима, проверки без ошибок.', 'Every ending can be reached, the checks find no errors.'),
    [code],
    [
      [L('Корабль спасён', 'The ship is saved'), true],
      [L('Долгая ночь', 'A long night'), true],
      [L('Маяк тёмный', 'The lighthouse stays dark'), true],
    ],
    [{ kind: 'document', id: docs.gdd }],
  );
  const old = task(
    ideas,
    L('Шторм в главе 1', 'A storm in chapter 1'),
    L('Отказались: и так тревожно.', 'Dropped: tense enough as it is.'),
    [story],
    [],
    [],
  );
  trashTask(data, board, old, at);

  // ---------- the project map ----------
  const map = newMapGraph(L('Карта проекта', 'Project map'));
  const card = (ref: MapRef, x: number, y: number, title: string): GraphNode => {
    const n = refNode(ref, x, y, title);
    n.color = REF_COLORS[ref.kind];
    map.nodes.push(n);
    return n;
  };
  const chapters = [
    card({ kind: 'chapter', id: 'g-ch1' }, 0, 0, L('Глава', 'Chapter')),
    card({ kind: 'chapter', id: 'g-ch2' }, 280, 0, L('Глава', 'Chapter')),
    card({ kind: 'chapter', id: 'g-ch3' }, 560, 0, L('Глава', 'Chapter')),
  ];
  chapters
    .slice(1)
    .forEach((n, i) =>
      map.edges.push({ id: `e-map-${i}`, from: { node: chapters[i].id, port: 'out' }, to: { node: n.id, port: 'in' } }),
    );
  map.groups.push({
    id: 'grp-story',
    title: L('Сюжет', 'Story'),
    x: -20,
    y: -40,
    w: 840,
    h: 180,
    color: 'violet',
    members: chapters.map((n) => n.id),
  });
  card({ kind: 'document', id: docs.start }, 0, 220, L('Документ', 'Document'));
  card({ kind: 'document', id: docs.gdd }, 280, 220, L('Документ', 'Document'));
  card({ kind: 'entity', id: 'tut-nika' }, 0, 400, L('Карточка', 'Card'));
  card({ kind: 'entity', id: 'tut-yan' }, 280, 400, L('Карточка', 'Card'));
  card({ kind: 'entity', id: 'tut-vela' }, 560, 400, L('Карточка', 'Card'));
  card({ kind: 'asset', id: MAP_PICTURE }, 860, 220, L('Картинка', 'Picture'));
  const mapNote = createNode('sticker', 860, 0, '');
  Object.assign(mapNote, {
    text: L(
      'Карта проекта — всё сразу. Перетащите сюда главы, документы, карточки и картинки из списка слева (или добавьте из поиска Ctrl+K). Двойной щелчок по карточке открывает объект.',
      'The project map — everything at once. Drag chapters, documents, cards and pictures here from the list on the left (or add them from Ctrl+K search). Double-click a card to open the object.',
    ),
    color: 'amber',
    w: 300,
    h: 170,
  });
  map.nodes.push(mapNote);
  data.graphs[map.id] = map as unknown as ProjectData['graphs'][string];

  return { data, assets };
}
