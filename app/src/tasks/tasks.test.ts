import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../core/project/types';
import { allFiles } from '../core/project/files';
import { sampleProject } from '../story/sample';
import { addLabel, deleteLabel, listLabels, normalizeColor, textOn, updateLabel } from './labels';
import {
  addBoard,
  addCheck,
  addList,
  addTask,
  addTaskLink,
  asBoard,
  deleteForever,
  deleteList,
  emptyTrash,
  findTask,
  listBoards,
  moveCheck,
  moveList,
  moveTask,
  moveTaskAssetLinks,
  progress,
  removeCheck,
  removeTaskLink,
  restoreTask,
  setCheck,
  tasksLinkingTo,
  toggleLabel,
  trashTask,
  updateTask,
} from './model';

const LISTS = ['Нужно сделать', 'В работе', 'Готово'];

function withBoard() {
  let board = '';
  const data = produce(sampleProject(), (d) => {
    board = addBoard(d, 'Задачи', LISTS);
  });
  const lists = listBoards(data)[0].lists.map((l) => l.id);
  return { data, board, lists };
}

describe('tasks (F6)', () => {
  it('a board of lists of tasks is one file; tasks are made, edited and moved between lists', () => {
    const { data, board, lists } = withBoard();
    let a = '';
    let b = '';
    let c = '';
    const filled = produce(data, (d) => {
      a = addTask(d, board, lists[0], 'Сценарий главы 3', undefined, '2026-10-21T10:00:00Z')!;
      b = addTask(d, board, lists[0], 'Портрет Миры')!;
      c = addTask(d, board, lists[1], 'Музыка мельницы')!;
      updateTask(d, board, a, { description: 'Черновик к пятнице' });
    });
    expect(allFiles(filled).map((f) => f.path)).toContain(`data/boards/${board}.json`);
    const [first] = listBoards(filled);
    expect(first.lists.map((l) => l.tasks.map((t) => t.title))).toEqual([
      ['Сценарий главы 3', 'Портрет Миры'],
      ['Музыка мельницы'],
      [],
    ]);
    expect(findTask(filled, a)?.task).toMatchObject({
      description: 'Черновик к пятнице',
      createdAt: '2026-10-21T10:00:00Z',
    });

    // To another list, at a place; within a list.
    const moved = produce(filled, (d) => {
      moveTask(d, board, a, lists[1], 0);
      moveTask(d, board, c, lists[1], 5);
      moveTask(d, board, b, lists[2], 0);
    });
    expect(listBoards(moved)[0].lists.map((l) => l.tasks.map((t) => t.id))).toEqual([[], [a, c], [b]]);
  });

  it('lists are added, renamed, moved; a deleted list leaves its tasks in the trash', () => {
    const { data, board, lists } = withBoard();
    let t = '';
    const changed = produce(data, (d) => {
      t = addTask(d, board, lists[2], 'Обложка')!;
      addList(d, board, 'Идеи');
      moveList(d, board, 3, 0);
      deleteList(d, board, lists[2], '2026-10-21T12:00:00Z');
    });
    const b = listBoards(changed)[0];
    expect(b.lists.map((l) => l.name)).toEqual(['Идеи', 'Нужно сделать', 'В работе']);
    expect(b.trash).toEqual([{ task: expect.objectContaining({ id: t }), list: lists[2], at: '2026-10-21T12:00:00Z' }]);
    // Its list is gone: the task comes back to the first list.
    const back = produce(changed, (d) => restoreTask(d, board, t, 'Задачи'));
    expect(listBoards(back)[0].lists[0].tasks.map((x) => x.id)).toEqual([t]);
    expect(listBoards(back)[0].trash).toEqual([]);
  });

  it('a task in the trash comes back to its list; it can be deleted for good, or the trash emptied', () => {
    const { data, board, lists } = withBoard();
    let a = '';
    let b = '';
    const trashed = produce(data, (d) => {
      a = addTask(d, board, lists[1], 'А')!;
      b = addTask(d, board, lists[1], 'Б')!;
      trashTask(d, board, a);
      trashTask(d, board, b);
    });
    expect(findTask(trashed, a)).toMatchObject({ trashed: true, list: null });
    const restored = produce(trashed, (d) => restoreTask(d, board, a, 'Задачи'));
    expect(listBoards(restored)[0].lists[1].tasks.map((x) => x.title)).toEqual(['А']);
    expect(listBoards(produce(restored, (d) => deleteForever(d, board, b)))[0].trash).toEqual([]);
    expect(listBoards(produce(trashed, (d) => emptyTrash(d, board)))[0].trash).toEqual([]);
  });

  it('a checklist counts its progress; items are added, ticked, edited, moved and removed', () => {
    const { data, board, lists } = withBoard();
    let t = '';
    const done = produce(data, (d) => {
      t = addTask(d, board, lists[0], 'Уровень 1')!;
      for (const text of ['Черновик', 'Враги', 'Награды', '  ']) addCheck(d, board, t, text);
      setCheck(d, board, t, 0, { done: true });
      setCheck(d, board, t, 1, { text: 'Враги и ловушки' });
      moveCheck(d, board, t, 2, 0);
      removeCheck(d, board, t, 2);
    });
    const task = findTask(done, t)!.task;
    expect(task.checklist).toEqual([
      { text: 'Награды', done: false },
      { text: 'Черновик', done: true },
    ]);
    expect(progress(task)).toEqual({ done: 1, total: 2 });
  });

  it('links to objects are found from the object; links to files follow a moved file', () => {
    const { data, board, lists } = withBoard();
    let t = '';
    const linked = produce(data, (d) => {
      t = addTask(d, board, lists[0], 'Портрет')!;
      addTaskLink(d, board, t, { kind: 'entity', id: 'ent-mira' });
      addTaskLink(d, board, t, { kind: 'entity', id: 'ent-mira' });
      addTaskLink(d, board, t, { kind: 'asset', id: 'assets/people/mira.png' });
      addTaskLink(d, board, t, { kind: 'node', id: 'g-ch1/a-who' });
    });
    expect(findTask(linked, t)!.task.links).toHaveLength(3);
    expect(tasksLinkingTo(linked, 'entity', 'ent-mira').map((x) => x.task.id)).toEqual([t]);
    const moved = produce(linked, (d) => moveTaskAssetLinks(d, 'assets/people', 'assets/герои'));
    expect(findTask(moved, t)!.task.links[1]).toEqual({ kind: 'asset', id: 'assets/герои/mira.png' });
    const unlinked = produce(moved, (d) => removeTaskLink(d, board, t, { kind: 'entity', id: 'ent-mira' }));
    expect(tasksLinkingTo(unlinked, 'entity', 'ent-mira')).toEqual([]);
  });

  it('labels: palette or HEX, a pattern and a symbol; a deleted label comes off the tasks', () => {
    const { data, board, lists } = withBoard();
    let label = '';
    let t = '';
    const labelled = produce(data, (d) => {
      label = addLabel(d, 'Бой', '#C2611A');
      updateLabel(d, label, { pattern: 'stripes', symbol: '⚔️ лишнее', color: 'f00' });
      updateLabel(d, label, { color: 'не цвет' });
      t = addTask(d, board, lists[0], 'Босс')!;
      toggleLabel(d, board, t, label);
    });
    expect(listLabels(labelled)).toEqual([
      { id: label, name: 'Бой', color: '#ff0000', pattern: 'stripes', symbol: '⚔️' },
    ]);
    expect(findTask(labelled, t)!.task.labels).toEqual([label]);
    const gone = produce(labelled, (d) => deleteLabel(d, label));
    expect(listLabels(gone)).toEqual([]);
    expect(findTask(gone, t)!.task.labels).toEqual([]);
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(textOn('#ffffff')).toBe('#14161a');
    expect(textOn('#14161a')).toBe('#ffffff');
  });

  it('a board edited by hand is read without what broke; the format example of version 1 reads', () => {
    const board = asBoard({
      id: 'bd-main00000001',
      name: 'Задачи',
      lists: [
        {
          id: 'ls-backlog00001',
          name: 'Бэклог',
          tasks: [
            {
              id: 'tk-0000000000001',
              title: 'Сценарий главы 3',
              description: '',
              labels: ['l-combat00000001'],
              checklist: [{ text: 'Черновик', done: true }],
              links: [
                { kind: 'graph', id: 'g-chapter1000001' },
                { kind: 'нечто', id: 'x' },
              ],
            },
            { title: 'без id' },
          ],
        },
        'не список',
      ],
      trash: [],
      future: { kept: true },
    } as unknown as JsonObject)!;
    expect(board.lists).toHaveLength(1);
    expect(board.lists[0].tasks).toHaveLength(1);
    expect(board.lists[0].tasks[0].links).toEqual([{ kind: 'graph', id: 'g-chapter1000001' }]);
    expect(board.future).toEqual({ kept: true });
  });
});
