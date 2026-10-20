import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../core/project/types';
import { buildLinks } from '../canvas/scene';
import { GraphIndex } from '../canvas/graphIndex';
import { HEADER_H } from '../canvas/model';
import { checkProject } from './checks';
import { exportStory } from './export';
import { addMark, followText, markLabel, plotSources, resolveRange } from './marks';
import { findNode, graphOf, type StoryNode } from './model';
import { markRowY } from './kinds';
import { pasteChapterGraphs, chapterGraphsOf, removeLine, removeOption, updateLine } from './ops';
import { playAct, playActions, playText, startPlay } from './play';
import { sampleProject } from './sample';
import { playerText, renameInText, textPieces } from './textEffects';
import { markMentions, renameEverywhere, unusedVariables, variableUsage } from './usage';
import { listVariables } from './variables';

const g = (data: ProjectData, id: string) => graphOf(data, id)!;
const node = (data: ProjectData, graph: string, id: string) => findNode(data, { graph, node: id })!;
const fresh = (text: string): StoryNode =>
  ({
    id: 'n',
    kind: 'dialogue',
    title: 'T',
    x: 0,
    y: 0,
    w: 300,
    h: 100,
    lines: [{ id: 'l', speaker: null, text }],
  }) as StoryNode;
const LINE = { kind: 'line', id: 'l' } as const;

describe('plot marks over lines, options and words (0.3)', () => {
  it('a mark keeps its words while the line is edited', () => {
    const n = fresh('Над дверью висит ружьё.');
    const m = addMark(n, 'gun', LINE, { start: 16, end: 22 })!;
    expect(m.range).toEqual({ start: 17, end: 22, quote: 'ружьё' });
    const edit = (text: string) => {
      followText(n, LINE, n.lines![0].text, text);
      n.lines![0].text = text;
      return m.range?.quote ?? null;
    };
    expect(edit('Над старой дверью висит ружьё.')).toBe('ружьё');
    expect(edit('Над старой дверью висит ружьё!')).toBe('ружьё');
    expect(edit('Над старой дверью висит ружьецо!')).toBe('ружьецо');
    // Gone completely: the mark stays, over the whole line.
    expect(edit('Над старой дверью висит !')).toBeNull();
    expect(n.marks).toHaveLength(1);
  });

  it('a fragment changed outside the editor is found again by its words', () => {
    expect(resolveRange('Ружьё. И ещё ружьё.', { start: 14, end: 19, quote: 'ружьё' })).toEqual({ start: 13, end: 18 });
    expect(resolveRange('Пусто', { start: 0, end: 5, quote: 'ружьё' })).toBeNull();
    // A selection of spaces only marks the whole line.
    expect(addMark(fresh('a   b'), 'gun', LINE, { start: 1, end: 4 })?.range).toBeNull();
  });

  it('marks go away with their line or option; ops keep them in step', () => {
    const data = produce(sampleProject(), (d) => {
      updateLine(g(d, 'g-ch1'), 'a-meet', 'l2', { text: 'Ну вот. Над дверью висит старое ружьё.' });
    });
    expect(node(data, 'g-ch1', 'a-meet').marks![0].range?.quote).toBe('старое ружьё');
    const gone = produce(data, (d) => {
      removeLine(g(d, 'g-ch1'), 'a-meet', 'l2');
      removeOption(g(d, 'g-ch2'), 'b-knight', 'o-free');
    });
    expect(node(gone, 'g-ch1', 'a-meet').marks).toEqual([]);
    expect(node(gone, 'g-ch2', 'b-knight').marks).toEqual([]);
  });

  it('checks see marks like gun and butterfly nodes, and point at the mark', () => {
    const data = sampleProject();
    expect(plotSources(g(data, 'g-ch1')).map((s) => [s.device, s.mark?.id ?? null, s.title])).toEqual([
      ['gun', 'm-rifle', 'старое ружьё'],
      ['gun', null, 'Ружьё на стене'],
    ]);
    const unlinked = produce(data, (d) => {
      node(d, 'g-ch2', 'b-knight').marks![0].links = [];
    });
    const problem = checkProject(unlinked).find((p) => p.code === 'butterflyNoConsequence' && p.mark);
    expect(problem).toMatchObject({
      graph: 'g-ch2',
      node: 'b-knight',
      mark: 'm-knight',
      params: { title: 'Освободить' },
    });
  });

  it('a butterfly names the variables it affects; they count as used', () => {
    const data = produce(sampleProject(), (d) => {
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-only-mark',
        name: 'память_рыцаря',
        type: 'int',
        initial: 0,
        scope: 'project',
        owner: null,
        description: '',
      });
      node(d, 'g-ch2', 'b-knight').marks![0].variables.push('v-only-mark');
    });
    expect(markMentions(data).get('v-only-mark')).toEqual([{ graph: 'g-ch2', node: 'b-knight', mark: 'm-knight' }]);
    expect(unusedVariables(data).map((v) => v.id)).not.toContain('v-only-mark');
  });

  it('lines from marks leave the card level with their line or option, with a trail', () => {
    const data = sampleProject();
    const meet = node(data, 'g-ch1', 'a-meet');
    const knight = node(data, 'g-ch2', 'b-knight');
    expect(markRowY(meet, meet.marks![0])).toBe(HEADER_H + 6 + 22 + 11);
    expect(markRowY(knight, knight.marks![0])).toBe(HEADER_H + 40 + 15);
    // Links to other chapters are not drawn; one in the same graph is, with its trail under the dashes.
    const local = produce(data, (d) => {
      node(d, 'g-ch1', 'a-meet').marks![0].links = [{ graph: 'g-ch1', node: 'a-end' }];
    });
    const graph = g(local, 'g-ch1');
    const { links, arrows } = buildLinks({ index: new GraphIndex(graph), drag: null } as never);
    expect(arrows.count).toBe(1);
    const widths = [...links.data].filter((_, i) => i % 9 === 8);
    expect(widths.some((w) => w < -5)).toBe(true);
    expect(widths.some((w) => w === 2)).toBe(true);
  });

  it('a pasted chapter keeps its marks pointing at its own nodes and variables', () => {
    const base = produce(sampleProject(), (d) => {
      (d.variables as { variables: unknown[] }).variables.push({
        id: 'v-ch2',
        name: 'грибы',
        type: 'int',
        initial: 0,
        scope: { kind: 'graph', id: 'g-ch2' },
        owner: null,
        description: '',
      });
      const m = node(d, 'g-ch2', 'b-knight').marks![0];
      m.links = [{ graph: 'g-ch2', node: 'b-end' }];
      m.variables = ['v-ch2'];
    });
    const carried = chapterGraphsOf(base, [node(base, 'g-root', 'r-ch2')]);
    const pasted = produce(base, (d) => {
      const copy = { ...structuredClone(node(base, 'g-root', 'r-ch2')), id: 'r-copy' } as StoryNode;
      g(d, 'g-root').nodes.push(copy);
      pasteChapterGraphs(d, [copy], carried, { from: 'g-root', to: 'g-root', ids: new Map([['r-ch2', 'r-copy']]) });
    });
    const copyGraph = node(pasted, 'g-root', 'r-copy').graph!;
    const knight = g(pasted, copyGraph).nodes.find(
      (n) => n.kind === 'choice' && n.title.startsWith('Рыцарь'),
    ) as StoryNode;
    const m = knight.marks![0];
    expect(m.links[0].graph).toBe(copyGraph);
    expect(findNode(pasted, m.links[0])?.title).toBe('Конец главы 2');
    const copyVar = listVariables(pasted).find(
      (v) => v.name === 'грибы' && v.scope !== 'project' && v.scope.id === copyGraph,
    );
    expect(m.variables).toEqual([copyVar!.id]);
  });

  it('labels name the words, the option or the node', () => {
    const data = sampleProject();
    const meet = node(data, 'g-ch1', 'a-meet');
    const knight = node(data, 'g-ch2', 'b-knight');
    expect(markLabel(meet, meet.marks![0])).toBe('старое ружьё');
    expect(markLabel(knight, knight.marks![0])).toBe('Освободить');
  });

  it('marks are exported with their place, links and variables', () => {
    const out = exportStory(sampleProject(), '0.3.0');
    const meet = out.story.graphs[1].nodes.find((n) => n.id === 'a-meet')!;
    expect(meet.marks).toEqual([
      {
        id: 'm-rifle',
        device: 'gun',
        anchor: { kind: 'line', id: 'l2' },
        range: { start: 17, end: 29, quote: 'старое ружьё' },
        links: [{ graph: 'g-ch3', node: 'c-shot' }],
        note: 'Выстрелит в тронном зале',
        variables: [],
      },
    ]);
  });
});

describe('variables changed from the text (0.3)', () => {
  const known = (name: string) => ['деньги', 'Мира.доверие', 'настроение'].includes(name);

  it('finds braced effects anywhere and bare ones only for known variables', () => {
    const text =
      'Нашёл кошель. деньги += 10, а x = 5 — не переменная. {Мира.доверие += 1; настроение = рада} Итого {деньги}.';
    const p = textPieces(text, known);
    expect(p.effects.map((e) => [e.source, e.braced])).toEqual([
      ['деньги += 10', false],
      ['Мира.доверие += 1; настроение = рада', true],
    ]);
    expect(p.shows.map((s) => s.name)).toEqual(['деньги']);
    // Without names (dialogue lines) only braces count; comparisons are never effects.
    expect(textPieces('деньги = 5', undefined).effects).toEqual([]);
    expect(textPieces('если деньги == 5', known).effects).toEqual([]);
    expect(playerText(text, p, (n) => (n === 'деньги' ? '15' : null))).toBe(
      'Нашёл кошель. деньги += 10, а x = 5 — не переменная. Итого 15.',
    );
  });

  it('renames inside text', () => {
    expect(renameInText('{деньги += 1} и деньги = 2, {деньги}', 'деньги', 'золото', known)).toBe(
      '{золото += 1} и золото = 2, {золото}',
    );
  });

  it('the playthrough applies them when the node is shown and the option is chosen', () => {
    const data = produce(sampleProject(), (d) => {
      node(d, 'g-ch1', 'a-arrive').comment = 'золото += 10';
      node(d, 'g-ch1', 'a-choice').options![0].note = 'Мира благодарна: {доверие += 5}';
    });
    let s = startPlay(data, { graph: 'g-ch1', node: 'a-start' });
    const gold = listVariables(data).find((v) => v.name === 'золото')!;
    const trust = listVariables(data).find((v) => v.name === 'доверие')!;
    while (s.pos?.node !== 'a-choice') s = playAct(data, s, playActions(data, s)[0]);
    expect(s.vars[gold.id]).toBe(15);
    s = playAct(
      data,
      s,
      playActions(data, s).find((a) => a.label === 'Помочь с мешками')!,
    );
    expect(s.vars[trust.id]).toBe(7);
    expect(playText(data, s, 'g-ch3', 'Золота у тебя: {золото}. {доверие += 1}', 'да', 'нет')).toBe(
      'Золота у тебя: 15.',
    );
  });

  it('checks, "where used" and renames see effects in text', () => {
    const data = produce(sampleProject(), (d) => {
      node(d, 'g-ch1', 'a-arrive').text = 'Жернова. {серебро += 1}';
      node(d, 'g-ch1', 'a-bags').comment = 'есть_ключ = 5';
    });
    const problems = checkProject(data);
    expect(problems.find((p) => p.code === 'unknownVar' && p.node === 'a-arrive')).toBeTruthy();
    expect(problems.find((p) => p.code === 'exprError' && p.node === 'a-bags')).toBeTruthy();
    const mill = listVariables(data).find((v) => v.name === 'был_на_мельнице')!;
    expect(
      variableUsage(data)
        .get(mill.id)
        ?.map((u) => u.site.field),
    ).toContain('comment');
    const renamed = produce(data, (d) => renameEverywhere(d, 'был_на_мельнице', 'мельница', mill));
    expect(node(renamed, 'g-ch1', 'a-arrive').comment).toBe('Отметка на будущее: мельница = истина');
  });
});

describe('fixes from the review of 0.3', () => {
  const known = (name: string) => ['деньги', 'hp', 'x', 'strength'].includes(name);

  it('braces without an assignment are ordinary text; bare effects stay on one line; decimal commas work', () => {
    expect(textPieces('Ты пришёл. {машет рукой}', undefined).effects).toEqual([]);
    expect(textPieces('{x == 1}', known).effects).toEqual([]);
    expect(textPieces('hp =\nstrength', known).effects).toEqual([]);
    expect(textPieces('Итого x=1,5 монеты', known).effects.map((e) => [e.source, e.code])).toEqual([
      ['x=1,5', 'x = 1.5'],
    ]);
    expect(textPieces('x = 1, y', known).effects.map((e) => e.code)).toEqual(['x = 1']);
  });

  it('a broken effect in text is skipped, not a stop; option text effects run; stickers do not count', () => {
    const data = produce(sampleProject(), (d) => {
      node(d, 'g-ch1', 'a-arrive').text = 'Жернова. {золото += "много"} {золото += 1}';
      node(d, 'g-ch1', 'a-choice').options![0].text = 'Помочь с мешками {золото += 100}';
      g(d, 'g-ch1').nodes.push({ ...node(d, 'g-ch1', 'a-note'), id: 'a-note2', text: 'TODO {переписать = сцену}' });
    });
    const gold = listVariables(data).find((v) => v.name === 'золото')!;
    let s = startPlay(data, { graph: 'g-ch1', node: 'a-start' });
    while (s.pos?.node !== 'a-choice') s = playAct(data, s, playActions(data, s)[0]);
    expect(s.status).toBe('running');
    expect(s.vars[gold.id]).toBe(6);
    s = playAct(
      data,
      s,
      playActions(data, s).find((a) => a.label.startsWith('Помочь'))!,
    );
    expect(s.vars[gold.id]).toBe(106);
    const problems = checkProject(data);
    expect(problems.some((p) => p.node === 'a-arrive' && p.code === 'exprError')).toBe(true);
    expect(problems.some((p) => p.node === 'a-note2')).toBe(false);
  });

  it('a rename keeps marked words on their words', () => {
    const data = produce(sampleProject(), (d) => {
      const meet = node(d, 'g-ch1', 'a-meet');
      meet.lines![1].text = 'Над дверью висит {золото += 1} старое ружьё.';
      meet.marks![0].range = { start: 31, end: 43, quote: 'старое ружьё' };
    });
    const gold = listVariables(data).find((v) => v.name === 'золото')!;
    const renamed = produce(data, (d) => renameEverywhere(d, 'золото', 'деньги', gold));
    const meet = node(renamed, 'g-ch1', 'a-meet');
    expect(meet.lines![1].text).toBe('Над дверью висит {деньги += 1} старое ружьё.');
    expect(meet.marks![0].range).toEqual({ start: 31, end: 43, quote: 'старое ружьё' });
  });
});
