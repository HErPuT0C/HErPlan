// The window of one task (F6-02…F6-04): title, the list it is in, labels, description, a checklist with its
// progress, links to objects of the project. Every change is saved at once and can be undone.

import { ArrowDown, ArrowUp, Link2, Plus, Settings2, Tag, Trash, X } from 'lucide-react';
import { useState } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { formatDate, t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { listLabels } from '../../tasks/labels';
import {
  addCheck,
  addTaskLink,
  findTask,
  moveCheck,
  moveTask,
  progress,
  removeCheck,
  removeTaskLink,
  setCheck,
  toggleLabel,
  trashTask,
  updateTask,
} from '../../tasks/model';
import { Button, Dialog, IconButton, Menu, type MenuEntry } from '../components';
import { KindIcon } from '../search/searchUi';
import { LabelChip } from './LabelChip';
import { LabelsManager } from './LabelEditor';
import { ObjectPicker } from './ObjectPicker';
import { openTaskLink, searchKindOf, taskLinkLabel } from './taskLinks';

export function TaskDialog({ project, id, onClose }: { project: OpenProject; id: string; onClose: () => void }) {
  const { store, readOnly } = project;
  const data = useStore(store, (s) => s);
  const found = findTask(data, id);
  const [labelMenu, setLabelMenu] = useState<{ x: number; y: number } | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [item, setItem] = useState('');
  if (!found || found.trashed) return null;
  const { board, list, task } = found;
  const change = (label: string, recipe: (d: ProjectData) => void, merge?: string) =>
    !readOnly && store.dispatch(label, recipe, merge ? { mergeKey: `task:${id}:${merge}` } : {});
  const labels = listLabels(data);
  const shown = task.labels.map((l) => labels.find((x) => x.id === l)).filter((x) => x !== undefined);
  const { done, total } = progress(task);

  const labelEntries: MenuEntry[] = [
    ...labels.map((l) => ({
      id: l.id,
      label: l.name || t('story.untitled'),
      icon: <LabelChip label={l} compact />,
      checked: task.labels.includes(l.id),
      keepOpen: true,
      onSelect: () => change(t('tasks.step.edit'), (d) => toggleLabel(d, board.id, id, l.id)),
    })),
    ...(labels.length ? [{ id: 'sep', separator: true as const }] : []),
    {
      id: 'manage',
      label: labels.length ? t('tasks.labels.manage') : t('tasks.labels.create'),
      icon: <Settings2 size={16} />,
      onSelect: () => setLabelsOpen(true),
    },
  ];
  const addItem = () => {
    if (!item.trim()) return;
    change(t('tasks.step.edit'), (d) => addCheck(d, board.id, id, item));
    setItem('');
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('tasks.task')}
      size="lg"
      footer={
        <>
          {!readOnly && (
            <Button
              variant="danger"
              icon={<Trash size={14} />}
              onClick={() => {
                change(t('tasks.step.trash'), (d) => trashTask(d, board.id, id));
                onClose();
              }}
            >
              {t('tasks.toTrash')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <div className="task-dialog">
        <input
          className="input task-title-input"
          value={task.title}
          placeholder={t('tasks.titlePlaceholder')}
          aria-label={t('tasks.title')}
          disabled={readOnly}
          onChange={(e) =>
            change(t('tasks.step.edit'), (d) => updateTask(d, board.id, id, { title: e.target.value }), 'title')
          }
        />
        <div className="task-meta">
          <label className="task-meta-item">
            <span className="muted small">{t('tasks.inList', { board: board.name || t('story.untitled') })}</span>
            <select
              className="input select"
              value={list?.id ?? ''}
              disabled={readOnly}
              aria-label={t('tasks.list')}
              onChange={(e) =>
                change(t('tasks.step.move'), (d) => moveTask(d, board.id, id, e.target.value, Number.MAX_SAFE_INTEGER))
              }
            >
              {board.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || t('story.untitled')}
                </option>
              ))}
            </select>
          </label>
          {task.createdAt && (
            <span className="muted small">{t('tasks.created', { date: formatDate(Date.parse(task.createdAt)) })}</span>
          )}
        </div>

        <section className="task-section" aria-label={t('tasks.labels')}>
          <h3 className="insp-heading">{t('tasks.labels')}</h3>
          <div className="task-labels">
            {shown.map((l) => (
              <button
                key={l.id}
                type="button"
                className="task-label-button"
                title={readOnly ? l.name : t('tasks.labels.remove', { name: l.name })}
                disabled={readOnly}
                onClick={() => change(t('tasks.step.edit'), (d) => toggleLabel(d, board.id, id, l.id))}
              >
                <LabelChip label={l} />
              </button>
            ))}
            {!readOnly && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Tag size={14} />}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setLabelMenu({ x: r.left, y: r.bottom + 4 });
                }}
              >
                {t('tasks.labels.add')}
              </Button>
            )}
          </div>
        </section>

        <section className="task-section">
          <label className="insp-heading" htmlFor={`task-desc-${id}`}>
            {t('tasks.description')}
          </label>
          <textarea
            id={`task-desc-${id}`}
            className="input textarea task-description"
            rows={4}
            value={task.description}
            disabled={readOnly}
            onChange={(e) =>
              change(
                t('tasks.step.edit'),
                (d) => updateTask(d, board.id, id, { description: e.target.value }),
                'description',
              )
            }
          />
        </section>

        <section className="task-section" aria-label={t('tasks.checklist')}>
          <h3 className="insp-heading">
            {t('tasks.checklist')} {total > 0 && <span className="muted">{t('tasks.progress', { done, total })}</span>}
          </h3>
          {total > 0 && (
            <div
              className="task-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label={t('tasks.checklist')}
            >
              <span style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
          {task.checklist.map((c, i) => (
            <div key={i} className="task-check">
              <input
                type="checkbox"
                checked={c.done}
                disabled={readOnly}
                aria-label={t('tasks.checkDone', { text: c.text })}
                onChange={(e) =>
                  change(t('tasks.step.edit'), (d) => setCheck(d, board.id, id, i, { done: e.target.checked }))
                }
              />
              <input
                className={['input', 'task-check-text', c.done && 'task-check-done'].filter(Boolean).join(' ')}
                value={c.text}
                disabled={readOnly}
                aria-label={t('tasks.checkText')}
                onChange={(e) =>
                  change(
                    t('tasks.step.edit'),
                    (d) => setCheck(d, board.id, id, i, { text: e.target.value }),
                    `check:${i}`,
                  )
                }
              />
              {!readOnly && (
                <span className="iline-tools">
                  <IconButton
                    size="sm"
                    label={t('story.up')}
                    icon={<ArrowUp size={14} />}
                    disabled={i === 0}
                    onClick={() => change(t('tasks.step.edit'), (d) => moveCheck(d, board.id, id, i, i - 1))}
                  />
                  <IconButton
                    size="sm"
                    label={t('story.down')}
                    icon={<ArrowDown size={14} />}
                    disabled={i === task.checklist.length - 1}
                    onClick={() => change(t('tasks.step.edit'), (d) => moveCheck(d, board.id, id, i, i + 1))}
                  />
                  <IconButton
                    size="sm"
                    label={t('tasks.checkRemove')}
                    icon={<X size={14} />}
                    onClick={() => change(t('tasks.step.edit'), (d) => removeCheck(d, board.id, id, i))}
                  />
                </span>
              )}
            </div>
          ))}
          {!readOnly && (
            <div className="task-check-add">
              <input
                className="input"
                value={item}
                placeholder={t('tasks.checkNew')}
                aria-label={t('tasks.checkNew')}
                onChange={(e) => setItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
              />
              <Button size="sm" icon={<Plus size={14} />} disabled={!item.trim()} onClick={addItem}>
                {t('tasks.checkAdd')}
              </Button>
            </div>
          )}
        </section>

        <section className="task-section" aria-label={t('tasks.links')}>
          <h3 className="insp-heading">{t('tasks.links')}</h3>
          {task.links.length === 0 && <p className="muted small">{t('tasks.links.none')}</p>}
          <div className="task-links">
            {task.links.map((l) => {
              const name = taskLinkLabel(data, l);
              return (
                <span key={`${l.kind}:${l.id}`} className="chip task-link">
                  <button
                    type="button"
                    className={['entity-link', name === null && 'text-warning'].filter(Boolean).join(' ')}
                    disabled={name === null}
                    onClick={() => {
                      onClose();
                      openTaskLink(l);
                    }}
                  >
                    <KindIcon item={{ kind: searchKindOf(l), id: l.id }} size={13} /> {name ?? t('tasks.links.gone')}
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={t('tasks.links.remove', { name: name ?? '' })}
                      onClick={() => change(t('tasks.step.edit'), (d) => removeTaskLink(d, board.id, id, l))}
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
            {!readOnly && (
              <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => setPicking(true)}>
                {t('tasks.links.add')}
              </Button>
            )}
          </div>
        </section>
      </div>

      {labelMenu && (
        <Menu
          entries={labelEntries}
          x={labelMenu.x}
          y={labelMenu.y}
          label={t('tasks.labels')}
          onClose={() => setLabelMenu(null)}
        />
      )}
      {labelsOpen && (
        <Dialog open onClose={() => setLabelsOpen(false)} title={t('tasks.labels.title')}>
          <LabelsManager
            project={project}
            onCreated={(label) => change(t('tasks.step.edit'), (d) => toggleLabel(d, board.id, id, label))}
          />
        </Dialog>
      )}
      {picking && (
        <ObjectPicker
          project={project}
          linked={task.links}
          onPick={(link) => change(t('tasks.step.edit'), (d) => addTaskLink(d, board.id, id, link))}
          onClose={() => setPicking(false)}
        />
      )}
    </Dialog>
  );
}
