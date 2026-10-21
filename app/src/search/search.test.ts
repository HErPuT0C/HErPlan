import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject, ProjectData } from '../core/project/types';
import { addDocument } from '../documents/model';
import { sampleProject } from '../story/sample';
import { addBoard, addTask, listBoards, updateTask } from '../tasks/model';
import { excerpt, search, searchIndex, type SearchItem } from './index';

const names = (hits: ReturnType<typeof search>) => hits.map((h) => `${h.item.kind}:${h.item.name}`);

describe('the project-wide search (F6-06)', () => {
  it('finds every kind of object by a part of its name anywhere, without regard to case', () => {
    let board = '';
    const data = produce(sampleProject(), (d) => {
      addDocument(d, 'Мир', 'Сера и мельница', '# Сера\n\nО Сере.\n');
      board = addBoard(d, 'Задачи', ['Нужно сделать']);
      const list = listBoards(d)[0].lists[0].id;
      const t = addTask(d, board, list, 'Портрет Серы')!;
      updateTask(d, board, t, { description: 'для **мельницы**' });
    });
    const index = searchIndex(data, ['assets/world/Мельница ночью.png']);
    expect(names(search(index, 'МЕЛЬН'))).toEqual(
      expect.arrayContaining(['entity:Мельница', 'document:Сера и мельница', 'asset:Мельница ночью.png']),
    );
    expect(names(search(index, 'серы'))).toEqual(['task:Портрет Серы']);
    expect(names(search(index, 'встреч'))).toContain('node:Встреча');
    expect(search(index, '   ')).toEqual([]);
  });

  it('names come before descriptions; names that start with the query come first', () => {
    const data = produce(sampleProject(), (d) => {
      (d.entities['ent-boris'] as JsonObject).description = 'Друг Sera с детства';
      d.entities['ent-sera'] = {
        id: 'ent-sera',
        type: 'character',
        name: 'Sera',
        description: '',
        image: null,
        order: 30,
      };
      d.entities['ent-kasera'] = {
        id: 'ent-kasera',
        type: 'character',
        name: 'Kasera',
        description: '',
        image: null,
        order: 40,
      };
      d.entities['ent-old'] = {
        id: 'ent-old',
        type: 'character',
        name: 'Old Serafim',
        description: '',
        image: null,
        order: 50,
      };
      addDocument(d, '', 'Заметки', 'Sera приходит ночью.\n');
    });
    const hits = search(searchIndex(data), 'ser');
    expect(names(hits)).toEqual([
      'entity:Sera',
      'entity:Old Serafim',
      'entity:Kasera',
      'entity:Борис',
      'document:Заметки',
    ]);
    expect(hits.map((h) => h.rank)).toEqual([0, 1, 2, 3, 3]);
    const doc = hits[4];
    expect(excerpt(doc.item.text, doc.at, 3, 12)).toBe('Sera приходи…');
  });

  it('answers within 100 ms on the largest project of NFR-02, and an unchanged object is not indexed again', () => {
    const data = sampleProject();
    const words = ['мельница', 'река', 'замок', 'лес', 'дорога', 'ключ', 'сундук', 'травница', 'стражник', 'кузнец'];
    const w = (i: number) => words[i % words.length];
    for (let i = 0; i < 10_000; i++) {
      data.entities[`e${i}`] = {
        id: `e${i}`,
        type: 'item',
        name: `${w(i)} ${i}`,
        description: `Описание ${w(i * 7)} номер ${i}: ${w(i * 3)} у ${w(i * 5)}, рядом ${w(i * 11)}.`,
        image: null,
        order: i,
      };
    }
    const nodes = Array.from({ length: 5_000 }, (_, i) => ({
      id: `n${i}`,
      kind: 'scene',
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      title: `Сцена ${w(i)} ${i}`,
      text: `Текст сцены про ${w(i * 13)} и ${w(i * 17)}.`,
    }));
    data.graphs.big = { id: 'big', kind: 'chapter', name: 'Большая', nodes, edges: [] } as unknown as JsonObject;
    for (let i = 0; i < 300; i++) {
      addDocument(
        data as ProjectData,
        '',
        `Страница ${i}`,
        `# ${w(i)}\n\n${'Абзац текста про игру. '.repeat(150)}${w(i * 3)}\n`,
      );
    }
    const assets = Array.from({ length: 5_000 }, (_, i) => `assets/картинки/${w(i)}-${i}.png`);

    let started = performance.now();
    const index = searchIndex(data, assets);
    const built = performance.now() - started;
    expect(index.length).toBeGreaterThan(20_000);

    const times: number[] = [];
    for (const q of ['мель', 'ключ 99', 'сундук', 'игру', 'zzz', 'р']) {
      started = performance.now();
      search(index, q);
      times.push(performance.now() - started);
    }
    expect(Math.max(...times)).toBeLessThan(100);

    // A change to one entity indexes that entity again, the rest comes from the cache.
    const changed = produce(data, (d) => {
      d.entities.e5.name = 'Совсем новое имя';
    });
    started = performance.now();
    const again: SearchItem[] = searchIndex(changed, assets);
    const rebuilt = performance.now() - started;
    expect(names(search(again, 'совсем новое'))).toEqual(['entity:Совсем новое имя']);
    expect(rebuilt).toBeLessThan(Math.max(100, built));
  });
});
