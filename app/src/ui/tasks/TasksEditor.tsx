// Tasks (F6-01…F6-05): boards on the left, the open board's lists side by side, tasks as cards that are
// dragged within a list and between lists; lists are dragged by their heads. A card shows its labels, its
// checklist's progress and how many objects it is linked to; a click opens the task. Deleted tasks wait in the
// board's trash.

import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  SquareKanban,
  Tag,
  Trash,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { searchKey } from '../../canvas/ops';
import { formatDate, t } from '../../i18n';
import { taskRequest } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { listLabels, type ProjectLabel } from '../../tasks/labels';
import {
  addBoard,
  addList,
  addTask,
  deleteBoard,
  deleteForever,
  deleteList,
  emptyTrash,
  findTask,
  listBoards,
  moveList,
  moveTask,
  progress,
  renameBoard,
  renameList,
  restoreTask,
  toggleLabel,
  trashTask,
  type Board,
  type Task,
  type TaskList,
} from '../../tasks/model';
import { Button, Dialog, EmptyState, IconButton, Menu, type MenuEntry } from '../components';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { LabelChip } from './LabelChip';
import { LabelsManager } from './LabelEditor';
import { TaskDialog } from './TaskDialog';
import './tasks.css';

/** What is being dragged: a task (to a list, at a place) or a list (to a place among the lists). */
type Drag =
  | { kind: 'task'; id: string; x: number; y: number; list: string | null; before: string | null }
  | { kind: 'list'; id: string; x: number; y: number; index: number };

const THRESHOLD = 5;

export function TasksEditor({
  project,
  board: wantedBoard,
  onBoard,
}: {
  project: OpenProject;
  board: string | null;
  onBoard: (id: string) => void;
}) {
  const { store, readOnly } = project;
  const boardsRaw = useStore(store, (s) => s.boards);
  const variables = useStore(store, (s) => s.variables);
  const boards = useMemo(() => listBoards({ boards: boardsRaw }), [boardsRaw]);
  const labels = useMemo(() => listLabels({ variables }), [variables]);
  const board = boards.find((b) => b.id === wantedBoard) ?? boards[0] ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const change = (label: string, recipe: (d: ProjectData) => void, merge?: string) =>
    !readOnly && store.dispatch(label, recipe, merge ? { mergeKey: merge } : {});

  // "Open this task" (where an object is used, the search): its board, then the task itself.
  const wanted = useAtom(taskRequest);
  useEffect(() => {
    if (!wanted) return;
    const timer = setTimeout(() => {
      taskRequest.set(null);
      const found = findTask(store.getState(), wanted.id);
      if (!found) return;
      onBoard(found.board.id);
      if (!found.trashed) setOpen(found.task.id);
      else setTrashOpen(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [wanted, store, onBoard]);

  const newBoard = (first = false) =>
    setPrompt({
      title: t('tasks.newBoard'),
      label: t('tasks.boardName'),
      value: first ? t('module.tasks') : t('tasks.newBoardName'),
      onSubmit: (name) => {
        let id = '';
        change(t('tasks.step.board'), (d) => {
          id = addBoard(d, name, [t('tasks.list.todo'), t('tasks.list.doing'), t('tasks.list.done')]);
        });
        if (id) onBoard(id);
      },
    });
  const boardMenu = (b: Board, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        {
          id: 'rename',
          label: t('tasks.renameBoard'),
          icon: <Pencil size={16} />,
          disabled: readOnly,
          onSelect: () =>
            setPrompt({
              title: t('tasks.renameBoard'),
              label: t('tasks.boardName'),
              value: b.name,
              onSubmit: (name) => change(t('tasks.step.board'), (d) => renameBoard(d, b.id, name.trim())),
            }),
        },
        { id: 'sep', separator: true },
        {
          id: 'delete',
          label: t('tasks.deleteBoard'),
          icon: <Trash size={16} />,
          danger: true,
          disabled: readOnly,
          onSelect: () => {
            const count = b.lists.reduce((n, l) => n + l.tasks.length, 0) + b.trash.length;
            if (!window.confirm(t('tasks.deleteBoardConfirm', { name: b.name, count }))) return;
            change(t('tasks.step.board'), (d) => deleteBoard(d, b.id));
          },
        },
      ],
    });

  return (
    <div className="tasks" data-tour="tasks">
      <nav className="tasks-boards" aria-label={t('tasks.boards')}>
        <h3 className="insp-heading">{t('tasks.boards')}</h3>
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className="schema-item"
            aria-current={board?.id === b.id ? 'true' : undefined}
            onClick={() => onBoard(b.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              boardMenu(b, e.clientX, e.clientY);
            }}
          >
            <SquareKanban size={14} aria-hidden="true" />
            <span className="docs-item-name">{b.name || t('story.untitled')}</span>
            <span className="muted">{b.lists.reduce((n, l) => n + l.tasks.length, 0)}</span>
          </button>
        ))}
        {!readOnly && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => newBoard()}>
            {t('tasks.newBoard')}
          </Button>
        )}
      </nav>

      <div className="tasks-main">
        {board ? (
          <>
            <header className="world-bar tasks-bar">
              <input
                className="input tasks-board-name"
                value={board.name}
                disabled={readOnly}
                aria-label={t('tasks.boardName')}
                onChange={(e) =>
                  change(
                    t('tasks.step.board'),
                    (d) => renameBoard(d, board.id, e.target.value),
                    `board:${board.id}:name`,
                  )
                }
              />
              <input
                className="input world-search"
                type="search"
                value={filter}
                placeholder={t('tasks.filter')}
                aria-label={t('tasks.filter')}
                onChange={(e) => setFilter(e.target.value)}
              />
              {labels.length > 0 && (
                <select
                  className="input select"
                  value={labelFilter ?? ''}
                  aria-label={t('tasks.labelFilter')}
                  onChange={(e) => setLabelFilter(e.target.value || null)}
                >
                  <option value="">{t('tasks.anyLabel')}</option>
                  {labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.symbol ? `${l.symbol} ` : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" variant="ghost" icon={<Tag size={14} />} onClick={() => setLabelsOpen(true)}>
                {t('tasks.labels')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setTrashOpen(true)}>
                {t('tasks.trash', { count: board.trash.length })}
              </Button>
            </header>
            <BoardView
              project={project}
              board={board}
              labels={labels}
              filter={filter}
              labelFilter={labelFilter}
              onOpen={setOpen}
              onLabels={() => setLabelsOpen(true)}
              change={change}
            />
          </>
        ) : (
          <EmptyState
            icon={<SquareKanban size={48} strokeWidth={1.4} />}
            title={t('tasks.empty')}
            text={t('tasks.emptyHint')}
            actions={
              !readOnly && (
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => newBoard(true)}>
                  {t('tasks.newBoard')}
                </Button>
              )
            }
          />
        )}
      </div>

      {open && <TaskDialog project={project} id={open} onClose={() => setOpen(null)} />}
      {trashOpen && board && <TrashDialog project={project} board={board} onClose={() => setTrashOpen(false)} />}
      {labelsOpen && (
        <Dialog open onClose={() => setLabelsOpen(false)} title={t('tasks.labels.title')}>
          <LabelsManager project={project} />
        </Dialog>
      )}
      {menu && (
        <Menu entries={menu.entries} x={menu.x} y={menu.y} label={t('tasks.boards')} onClose={() => setMenu(null)} />
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

type Change = (label: string, recipe: (d: ProjectData) => void, merge?: string) => void;

/** The lists of a board, side by side; tasks and lists are moved by dragging (pointer events). */
function BoardView({
  project,
  board,
  labels,
  filter,
  labelFilter,
  onOpen,
  onLabels,
  change,
}: {
  project: OpenProject;
  board: Board;
  labels: ProjectLabel[];
  filter: string;
  labelFilter: string | null;
  onOpen: (id: string) => void;
  onLabels: () => void;
  change: Change;
}) {
  const { readOnly } = project;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [newList, setNewList] = useState('');
  const strip = useRef<HTMLDivElement>(null);
  const q = searchKey(filter.trim());
  const visible = (task: Task) =>
    (!q || searchKey(task.title).includes(q) || searchKey(task.description).includes(q)) &&
    (!labelFilter || task.labels.includes(labelFilter));

  /** Where a dragged task would go: the list under the pointer and the card it would go before (null: last). */
  const taskTarget = (x: number, y: number): { list: string | null; before: string | null } => {
    const column = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-list]');
    if (!column) return { list: null, before: null };
    const card = [...column.querySelectorAll<HTMLElement>('[data-task]')].find((c) => {
      const r = c.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { list: column.dataset.list ?? null, before: card?.dataset.task ?? null };
  };
  /** Where a dragged list would go among the others. */
  const listTarget = (x: number, id: string): number => {
    const columns = [...(strip.current?.querySelectorAll<HTMLElement>('[data-list]') ?? [])].filter(
      (c) => c.dataset.list !== id,
    );
    const index = columns.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return index < 0 ? columns.length : index;
  };

  const start = (kind: 'task' | 'list', id: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || readOnly) return;
    if ((e.target as HTMLElement).closest('input, textarea, select, [data-no-drag]')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    let last: Drag | null = null;
    const move = (m: PointerEvent) => {
      if (!moving && Math.hypot(m.clientX - x0, m.clientY - y0) < THRESHOLD) return;
      if (!moving) document.documentElement.dataset.dragging = '';
      moving = true;
      last =
        kind === 'task'
          ? { kind, id, x: m.clientX, y: m.clientY, ...taskTarget(m.clientX, m.clientY) }
          : { kind, id, x: m.clientX, y: m.clientY, index: listTarget(m.clientX, id) };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      delete document.documentElement.dataset.dragging;
      setDrag(null);
      if (!moving || !last) return;
      // The click that ends a drag does not open the card.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      const done = last;
      if (done.kind === 'task' && done.list) {
        // The place among the list's other tasks (filtered out ones included).
        const others = board.lists.find((l) => l.id === done.list)!.tasks.filter((x) => x.id !== id);
        const at = done.before ? others.findIndex((x) => x.id === done.before) : -1;
        change(t('tasks.step.move'), (d) => moveTask(d, board.id, id, done.list!, at < 0 ? others.length : at));
      }
      if (done.kind === 'list') {
        const from = board.lists.findIndex((l) => l.id === id);
        if (from !== done.index) change(t('tasks.step.list'), (d) => moveList(d, board.id, from, done.index));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const draggedName =
    drag?.kind === 'task'
      ? board.lists.flatMap((l) => l.tasks).find((x) => x.id === drag.id)?.title
      : drag?.kind === 'list'
        ? board.lists.find((l) => l.id === drag.id)?.name
        : undefined;
  const otherLists = board.lists.filter((l) => !(drag?.kind === 'list' && l.id === drag.id));

  const addNewList = () => {
    if (!newList.trim()) return;
    change(t('tasks.step.list'), (d) => void addList(d, board.id, newList));
    setNewList('');
  };

  return (
    <div className="tasks-strip" ref={strip}>
      {otherLists.map((list, i) => (
        <div key={list.id} className="tasks-slot">
          {drag?.kind === 'list' && drag.index === i && <div className="tasks-list-drop" />}
          <ListColumn
            project={project}
            board={board}
            list={list}
            index={board.lists.indexOf(list)}
            labels={labels}
            visible={visible}
            drag={drag}
            onOpen={onOpen}
            onLabels={onLabels}
            onStart={start}
            change={change}
          />
        </div>
      ))}
      {drag?.kind === 'list' && drag.index >= otherLists.length && <div className="tasks-list-drop" />}
      {!readOnly && (
        <div className="tasks-list tasks-list-new">
          <input
            className="input"
            value={newList}
            placeholder={t('tasks.newList')}
            aria-label={t('tasks.newList')}
            onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNewList()}
          />
          <Button size="sm" icon={<Plus size={14} />} disabled={!newList.trim()} onClick={addNewList}>
            {t('tasks.addList')}
          </Button>
        </div>
      )}
      {drag && draggedName !== undefined && (
        <div className="tasks-ghost" style={{ left: drag.x + 10, top: drag.y + 6 }} aria-hidden="true">
          {draggedName || t('story.untitled')}
        </div>
      )}
    </div>
  );
}

function ListColumn({
  project,
  board,
  list,
  index,
  labels,
  visible,
  drag,
  onOpen,
  onLabels,
  onStart,
  change,
}: {
  project: OpenProject;
  board: Board;
  list: TaskList;
  index: number;
  labels: ProjectLabel[];
  visible: (task: Task) => boolean;
  drag: Drag | null;
  onOpen: (id: string) => void;
  onLabels: () => void;
  onStart: (kind: 'task' | 'list', id: string) => (e: ReactPointerEvent) => void;
  change: Change;
}) {
  const { readOnly } = project;
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const tasks = list.tasks.filter((x) => !(drag?.kind === 'task' && x.id === drag.id));
  const shown = tasks.filter(visible);
  const dropHere = drag?.kind === 'task' && drag.list === list.id;
  const add = () => {
    if (!title.trim()) return;
    change(t('tasks.step.add'), (d) => void addTask(d, board.id, list.id, title));
    setTitle('');
  };
  const entries: MenuEntry[] = [
    {
      id: 'left',
      label: t('tasks.list.left'),
      icon: <ChevronLeft size={16} />,
      disabled: readOnly || index === 0,
      onSelect: () => change(t('tasks.step.list'), (d) => moveList(d, board.id, index, index - 1)),
    },
    {
      id: 'right',
      label: t('tasks.list.right'),
      icon: <ChevronRight size={16} />,
      disabled: readOnly || index === board.lists.length - 1,
      onSelect: () => change(t('tasks.step.list'), (d) => moveList(d, board.id, index, index + 1)),
    },
    { id: 'sep', separator: true },
    {
      id: 'delete',
      label: t('tasks.list.delete'),
      icon: <Trash size={16} />,
      danger: true,
      disabled: readOnly,
      onSelect: () => {
        if (
          list.tasks.length &&
          !window.confirm(t('tasks.list.deleteConfirm', { name: list.name, count: list.tasks.length }))
        )
          return;
        change(t('tasks.step.list'), (d) => deleteList(d, board.id, list.id));
      },
    },
  ];
  return (
    <section
      className={['tasks-list', dropHere && 'tasks-list-over'].filter(Boolean).join(' ')}
      data-list={list.id}
      aria-label={list.name || t('story.untitled')}
    >
      <header className="tasks-list-head" onPointerDown={onStart('list', list.id)}>
        <input
          className="input tasks-list-name"
          value={list.name}
          disabled={readOnly}
          aria-label={t('tasks.listName')}
          onChange={(e) =>
            change(
              t('tasks.step.list'),
              (d) => renameList(d, board.id, list.id, e.target.value),
              `list:${list.id}:name`,
            )
          }
        />
        <span className="tasks-count" aria-label={t('tasks.count', { count: list.tasks.length })}>
          {list.tasks.length}
        </span>
        <IconButton
          size="sm"
          label={t('tasks.list.menu', { name: list.name })}
          icon={<MoreVertical size={14} />}
          data-no-drag=""
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 200, y: r.bottom + 4 });
          }}
        />
      </header>
      <div className="tasks-cards">
        {shown.map((task) => (
          <div key={task.id}>
            {dropHere && drag.before === task.id && <div className="tasks-drop" />}
            <TaskCard
              task={task}
              labels={labels}
              readOnly={readOnly}
              onOpen={() => onOpen(task.id)}
              onPointerDown={onStart('task', task.id)}
              onToggleLabel={(label) => change(t('tasks.step.edit'), (d) => toggleLabel(d, board.id, task.id, label))}
              onLabels={onLabels}
              onTrash={() => change(t('tasks.step.trash'), (d) => trashTask(d, board.id, task.id))}
            />
          </div>
        ))}
        {dropHere && drag.before === null && <div className="tasks-drop" />}
        {shown.length === 0 && !dropHere && tasks.length > 0 && (
          <p className="muted small">{t('tasks.hiddenByFilter')}</p>
        )}
      </div>
      {!readOnly &&
        (adding ? (
          <div className="tasks-add">
            <textarea
              className="input textarea"
              rows={2}
              autoFocus
              value={title}
              placeholder={t('tasks.titlePlaceholder')}
              aria-label={t('tasks.newTask')}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
                if (e.key === 'Escape') {
                  setAdding(false);
                  setTitle('');
                }
              }}
              onBlur={() => !title.trim() && setAdding(false)}
            />
            <div className="tasks-add-row">
              <Button size="sm" variant="primary" disabled={!title.trim()} onClick={add}>
                {t('tasks.add')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            {t('tasks.newTask')}
          </Button>
        ))}
      {menu && <Menu entries={entries} x={menu.x} y={menu.y} label={list.name} onClose={() => setMenu(null)} />}
    </section>
  );
}

/** A task on the board. Pointing at it shows two buttons: its labels (a menu that stays open, so several can be
 * put on in a row) and the trash; a click anywhere else opens the task. */
function TaskCard({
  task,
  labels,
  readOnly,
  onOpen,
  onPointerDown,
  onToggleLabel,
  onLabels,
  onTrash,
}: {
  task: Task;
  labels: ProjectLabel[];
  readOnly: boolean;
  onOpen: () => void;
  onPointerDown: (e: ReactPointerEvent) => void;
  onToggleLabel: (label: string) => void;
  onLabels: () => void;
  onTrash: () => void;
}) {
  const [labelMenu, setLabelMenu] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  const labelEntries: MenuEntry[] = [
    ...labels.map((l) => ({
      id: l.id,
      label: l.name || t('story.untitled'),
      icon: <LabelChip label={l} compact />,
      checked: task.labels.includes(l.id),
      keepOpen: true,
      onSelect: () => onToggleLabel(l.id),
    })),
    ...(labels.length ? [{ id: 'sep', separator: true as const }] : []),
    {
      id: 'manage',
      label: labels.length ? t('tasks.labels.manage') : t('tasks.labels.create'),
      icon: <Settings2 size={16} />,
      onSelect: onLabels,
    },
  ];
  const shown = task.labels.map((l) => labels.find((x) => x.id === l)).filter((x) => x !== undefined);
  const { done, total } = progress(task);
  return (
    <div className={['task-card-wrap', labelMenu && 'task-card-wrap-menu'].filter(Boolean).join(' ')}>
      <button type="button" className="task-card" data-task={task.id} onClick={onOpen} onPointerDown={onPointerDown}>
        {shown.length > 0 && (
          <span className="task-card-labels">
            {shown.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </span>
        )}
        <span className="task-card-title">{task.title || t('story.untitled')}</span>
        {(total > 0 || task.links.length > 0 || task.description.trim()) && (
          <span className="task-card-foot muted small">
            {task.description.trim() && <FileText size={12} aria-label={t('tasks.hasDescription')} />}
            {total > 0 && (
              <span className={done === total ? 'task-card-done' : undefined} title={t('tasks.checklist')}>
                <CheckSquare size={12} aria-hidden="true" /> {t('tasks.progress', { done, total })}
              </span>
            )}
            {task.links.length > 0 && (
              <span title={t('tasks.links')}>
                <Link2 size={12} aria-hidden="true" /> {task.links.length}
              </span>
            )}
          </span>
        )}
      </button>
      {!readOnly && (
        <span className="task-card-tools">
          <IconButton
            size="sm"
            label={t('tasks.card.labels', { name: task.title })}
            icon={<Tag size={14} />}
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const anchor = e.currentTarget;
              setLabelMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4, anchor }));
            }}
          />
          <IconButton
            size="sm"
            label={t('tasks.card.trash', { name: task.title })}
            icon={<Trash size={14} />}
            onClick={onTrash}
          />
        </span>
      )}
      {labelMenu && (
        <Menu
          entries={labelEntries}
          x={labelMenu.x}
          y={labelMenu.y}
          anchor={labelMenu.anchor}
          label={t('tasks.labels')}
          onClose={() => setLabelMenu(null)}
        />
      )}
    </div>
  );
}

/** Deleted tasks of a board: back to their list, or gone for good. */
function TrashDialog({ project, board, onClose }: { project: OpenProject; board: Board; onClose: () => void }) {
  const { store, readOnly } = project;
  const change = (label: string, recipe: (d: ProjectData) => void) => !readOnly && store.dispatch(label, recipe);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('tasks.trashTitle', { board: board.name })}
      footer={
        !readOnly &&
        board.trash.length > 0 && (
          <Button
            variant="danger"
            icon={<Trash size={14} />}
            onClick={() => {
              if (!window.confirm(t('tasks.emptyTrashConfirm', { count: board.trash.length }))) return;
              change(t('tasks.step.trash'), (d) => emptyTrash(d, board.id));
            }}
          >
            {t('tasks.emptyTrash')}
          </Button>
        )
      }
    >
      {board.trash.length === 0 && <p className="muted small">{t('tasks.trashEmpty')}</p>}
      <ul className="docs-trash-list">
        {board.trash.map(({ task, list, at }) => (
          <li key={task.id} className="docs-trash-row">
            <span className="docs-item-name">{task.title || t('story.untitled')}</span>
            <span className="muted small">
              {board.lists.find((l) => l.id === list)?.name ?? t('tasks.listGone')}
              {at ? ` · ${formatDate(Date.parse(at))}` : ''}
            </span>
            {!readOnly && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={14} />}
                  onClick={() =>
                    change(t('tasks.step.restore'), (d) => restoreTask(d, board.id, task.id, t('tasks.list.todo')))
                  }
                >
                  {t('tasks.restore')}
                </Button>
                <IconButton
                  size="sm"
                  label={t('tasks.deleteForever')}
                  icon={<Trash size={14} />}
                  onClick={() => {
                    if (!window.confirm(t('tasks.deleteForeverConfirm', { name: task.title }))) return;
                    change(t('tasks.step.trash'), (d) => deleteForever(d, board.id, task.id));
                  }}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
