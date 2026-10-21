// Tasks (F6, FR-TSK-01…04): boards of lists of tasks, kept one board per file in data/boards/<id>.json. A task
// has a title, a description, labels from the project's registry, a checklist and links to objects of the
// project; a deleted task waits in its board's trash and comes back to the list it was in.

import { current, isDraft } from 'immer';
import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';

/** What a task can be linked to; a story node is "<graph>/<node>". */
export type TaskLinkKind = 'entity' | 'document' | 'graph' | 'node' | 'asset';
export const TASK_LINK_KINDS: readonly TaskLinkKind[] = ['entity', 'document', 'graph', 'node', 'asset'];

export interface TaskLink {
  kind: TaskLinkKind;
  id: string;
}

export interface CheckItem {
  text: string;
  done: boolean;
  [extra: string]: unknown;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** Label ids from the registry (data/variables.json → labels). */
  labels: string[];
  checklist: CheckItem[];
  links: TaskLink[];
  createdAt: string;
  [extra: string]: unknown;
}

export interface TaskList {
  id: string;
  name: string;
  tasks: Task[];
  [extra: string]: unknown;
}

export interface TrashedTask {
  task: Task;
  /** The list it was in, to come back to. */
  list: string;
  at: string;
  [extra: string]: unknown;
}

export interface Board {
  id: string;
  name: string;
  order: number;
  lists: TaskList[];
  trash: TrashedTask[];
  [extra: string]: unknown;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function asTask(raw: unknown): Task | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  return {
    ...raw,
    id: raw.id,
    title: str(raw.title),
    description: str(raw.description),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((x): x is string => typeof x === 'string') : [],
    checklist: Array.isArray(raw.checklist)
      ? raw.checklist.filter(isObject).map((c) => ({ ...c, text: str(c.text), done: c.done === true }))
      : [],
    links: Array.isArray(raw.links)
      ? raw.links
          .filter(isObject)
          .filter((l) => TASK_LINK_KINDS.includes(l.kind as TaskLinkKind) && typeof l.id === 'string')
          .map((l) => ({ kind: l.kind as TaskLinkKind, id: l.id as string }))
      : [],
    createdAt: str(raw.createdAt),
  };
}

/** A board as read from its file; what a hand edit broke is left out, unknown fields stay. */
export function asBoard(raw: JsonObject | undefined): Board | null {
  if (!raw || typeof raw.id !== 'string') return null;
  const lists = Array.isArray(raw.lists)
    ? raw.lists
        .filter((l): l is JsonObject => isObject(l) && typeof l.id === 'string')
        .map((l) => ({
          ...l,
          id: l.id as string,
          name: str(l.name),
          tasks: Array.isArray(l.tasks) ? l.tasks.map(asTask).filter((x): x is Task => x !== null) : [],
        }))
    : [];
  const trash = Array.isArray(raw.trash)
    ? raw.trash
        .filter(isObject)
        .map((x) => ({ ...x, task: asTask(x.task), list: str(x.list), at: str(x.at) }))
        .filter((x): x is TrashedTask => x.task !== null)
    : [];
  return {
    ...raw,
    id: raw.id,
    name: str(raw.name),
    order: typeof raw.order === 'number' ? raw.order : 0,
    lists,
    trash,
  };
}

/** Boards in their order, then by name. */
export function listBoards(data: Pick<ProjectData, 'boards'>): Board[] {
  return Object.values(data.boards)
    .map(asBoard)
    .filter((b): b is Board => b !== null)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Done and all items of a task's checklist. */
export function progress(task: Task): { done: number; total: number } {
  return { done: task.checklist.filter((c) => c.done).length, total: task.checklist.length };
}

/** A task wherever it is: on which board, in which list (or in the trash), at which place. */
export function findTask(
  data: Pick<ProjectData, 'boards'>,
  id: string,
): { board: Board; list: TaskList | null; task: Task; index: number; trashed: boolean } | null {
  for (const board of listBoards(data)) {
    for (const list of board.lists) {
      const index = list.tasks.findIndex((x) => x.id === id);
      if (index >= 0) return { board, list, task: list.tasks[index], index, trashed: false };
    }
    const index = board.trash.findIndex((x) => x.task.id === id);
    if (index >= 0) return { board, list: null, task: board.trash[index].task, index, trashed: true };
  }
  return null;
}

/** Tasks (not in the trash) that link to an object. */
export function tasksLinkingTo(
  data: Pick<ProjectData, 'boards'>,
  kind: TaskLinkKind,
  id: string,
): { board: Board; task: Task }[] {
  return listBoards(data).flatMap((board) =>
    board.lists.flatMap((list) =>
      list.tasks.filter((x) => x.links.some((l) => l.kind === kind && l.id === id)).map((task) => ({ board, task })),
    ),
  );
}

// ---------- changes (inside a Store recipe) ----------

/** The board as the draft keeps it, repaired (once) where a hand edit broke it, so recipes can change it in place. */
function editable(d: ProjectData, id: string): Board | null {
  const raw = d.boards[id];
  if (!raw) return null;
  const plain = isDraft(raw) ? current(raw) : raw;
  const fixed = asBoard(plain);
  if (!fixed) return null;
  if (JSON.stringify(fixed) !== JSON.stringify(plain)) d.boards[id] = fixed as unknown as JsonObject;
  return d.boards[id] as unknown as Board;
}

function taskIn(b: Board, id: string): { list: TaskList; index: number; task: Task } | null {
  for (const list of b.lists) {
    const index = list.tasks.findIndex((x) => x.id === id);
    if (index >= 0) return { list, index, task: list.tasks[index] };
  }
  return null;
}

/** A new board with the given lists, after the others. */
export function addBoard(d: ProjectData, name: string, lists: readonly string[]): string {
  const id = newId();
  const order = listBoards(d).reduce((max, b) => Math.max(max, b.order), 0) + 10;
  const board: Board = {
    id,
    name: name.trim(),
    order,
    lists: lists.map((n) => ({ id: newId(), name: n, tasks: [] })),
    trash: [],
  };
  d.boards[id] = board as unknown as JsonObject;
  return id;
}

export function renameBoard(d: ProjectData, id: string, name: string): void {
  const b = editable(d, id);
  if (b) b.name = name;
}

export function deleteBoard(d: ProjectData, id: string): void {
  delete d.boards[id];
}

export function addList(d: ProjectData, board: string, name: string): string | null {
  const b = editable(d, board);
  if (!b) return null;
  const id = newId();
  b.lists.push({ id, name: name.trim(), tasks: [] });
  return id;
}

export function renameList(d: ProjectData, board: string, list: string, name: string): void {
  const l = editable(d, board)?.lists.find((x) => x.id === list);
  if (l) l.name = name;
}

export function moveList(d: ProjectData, board: string, from: number, to: number): void {
  const b = editable(d, board);
  if (!b || from === to || from < 0 || to < 0 || from >= b.lists.length || to >= b.lists.length) return;
  const [l] = b.lists.splice(from, 1);
  b.lists.splice(to, 0, l);
}

/** Deletes a list; its tasks go to the trash, so nothing is lost. */
export function deleteList(d: ProjectData, board: string, list: string, at = new Date().toISOString()): void {
  const b = editable(d, board);
  const l = b?.lists.find((x) => x.id === list);
  if (!b || !l) return;
  for (const task of l.tasks) b.trash.unshift({ task, list, at });
  b.lists = b.lists.filter((x) => x !== l);
}

/** A new task at the end of a list (or at `index`). */
export function addTask(
  d: ProjectData,
  board: string,
  list: string,
  title: string,
  index?: number,
  now = new Date().toISOString(),
): string | null {
  const l = editable(d, board)?.lists.find((x) => x.id === list);
  if (!l) return null;
  const id = newId();
  const task: Task = { id, title: title.trim(), description: '', labels: [], checklist: [], links: [], createdAt: now };
  l.tasks.splice(index ?? l.tasks.length, 0, task);
  return id;
}

export function updateTask(
  d: ProjectData,
  board: string,
  id: string,
  patch: Partial<Pick<Task, 'title' | 'description'>>,
): void {
  const b = editable(d, board);
  const found = b && taskIn(b, id);
  if (found) Object.assign(found.task, patch);
}

/** Moves a task to `index` in a list of the same board (the place counted without the task itself). */
export function moveTask(d: ProjectData, board: string, id: string, list: string, index: number): void {
  const b = editable(d, board);
  const found = b && taskIn(b, id);
  const to = b?.lists.find((x) => x.id === list);
  if (!b || !found || !to) return;
  found.list.tasks.splice(found.index, 1);
  to.tasks.splice(Math.max(0, Math.min(index, to.tasks.length)), 0, found.task);
}

export function trashTask(d: ProjectData, board: string, id: string, at = new Date().toISOString()): void {
  const b = editable(d, board);
  const found = b && taskIn(b, id);
  if (!b || !found) return;
  found.list.tasks.splice(found.index, 1);
  b.trash.unshift({ task: found.task, list: found.list.id, at });
}

/** Back to the end of the list it was in; to the first list if that one is gone (a new one if none is left). */
export function restoreTask(d: ProjectData, board: string, id: string, fallbackList: string): void {
  const b = editable(d, board);
  const index = b?.trash.findIndex((x) => x.task.id === id) ?? -1;
  if (!b || index < 0) return;
  const [{ task, list }] = b.trash.splice(index, 1);
  let to = b.lists.find((x) => x.id === list) ?? b.lists[0];
  if (!to) {
    to = { id: newId(), name: fallbackList, tasks: [] };
    b.lists.push(to);
  }
  to.tasks.push(task);
}

export function deleteForever(d: ProjectData, board: string, id: string): void {
  const b = editable(d, board);
  if (b) b.trash = b.trash.filter((x) => x.task.id !== id);
}

export function emptyTrash(d: ProjectData, board: string): void {
  const b = editable(d, board);
  if (b) b.trash = [];
}

// ---------- the inside of a task ----------

function task(d: ProjectData, board: string, id: string): Task | null {
  const b = editable(d, board);
  return (b && taskIn(b, id)?.task) ?? null;
}

export function toggleLabel(d: ProjectData, board: string, id: string, label: string): void {
  const x = task(d, board, id);
  if (x) x.labels = x.labels.includes(label) ? x.labels.filter((l) => l !== label) : [...x.labels, label];
}

export function addCheck(d: ProjectData, board: string, id: string, text: string): void {
  const x = task(d, board, id);
  if (x && text.trim()) x.checklist.push({ text: text.trim(), done: false });
}

export function setCheck(
  d: ProjectData,
  board: string,
  id: string,
  index: number,
  patch: Partial<Pick<CheckItem, 'text' | 'done'>>,
): void {
  const item = task(d, board, id)?.checklist[index];
  if (item) Object.assign(item, patch);
}

export function removeCheck(d: ProjectData, board: string, id: string, index: number): void {
  const x = task(d, board, id);
  if (x) x.checklist.splice(index, 1);
}

export function moveCheck(d: ProjectData, board: string, id: string, from: number, to: number): void {
  const list = task(d, board, id)?.checklist;
  if (!list || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

export function addTaskLink(d: ProjectData, board: string, id: string, link: TaskLink): void {
  const x = task(d, board, id);
  if (x && !x.links.some((l) => l.kind === link.kind && l.id === link.id)) x.links.push({ ...link });
}

export function removeTaskLink(d: ProjectData, board: string, id: string, link: TaskLink): void {
  const x = task(d, board, id);
  if (x) x.links = x.links.filter((l) => !(l.kind === link.kind && l.id === link.id));
}

/** A label taken out of the registry comes off every task. */
export function forgetLabel(d: ProjectData, label: string): void {
  for (const id of Object.keys(d.boards)) {
    const b = editable(d, id);
    if (!b) continue;
    for (const t of [...b.lists.flatMap((l) => l.tasks), ...b.trash.map((x) => x.task)]) {
      if (t.labels.includes(label)) t.labels = t.labels.filter((l) => l !== label);
    }
  }
}

/** Links to assets follow a file or folder renamed or moved on disk (see world/assets.ts moveAssetRefs). */
export function moveTaskAssetLinks(d: ProjectData, from: string, to: string): void {
  for (const id of Object.keys(d.boards)) {
    const raw = d.boards[id];
    const b = asBoard(raw && isDraft(raw) ? current(raw) : raw);
    const touched =
      b &&
      [...b.lists.flatMap((l) => l.tasks), ...b.trash.map((x) => x.task)].some((t) =>
        t.links.some((l) => l.kind === 'asset' && (l.id === from || l.id.startsWith(`${from}/`))),
      );
    if (!touched) continue;
    const e = editable(d, id)!;
    for (const t of [...e.lists.flatMap((l) => l.tasks), ...e.trash.map((x) => x.task)]) {
      for (const l of t.links) {
        if (l.kind === 'asset' && (l.id === from || l.id.startsWith(`${from}/`))) l.id = to + l.id.slice(from.length);
      }
    }
  }
}
