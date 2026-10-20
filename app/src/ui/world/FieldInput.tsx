// Editors for the values of entity fields (F4-02), one per kind of field.

import { ArrowUpRight, Plus, Trash, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { JsonObject } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openEntity } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { asEntity, listEntities, newEntity } from '../../story/entities';
import { addTag, findCatalog, typesFile, type FieldDef } from '../../world/schema';
import { coerceValue, type FieldValue, type TableValue } from '../../world/values';
import { Button, IconButton, Switch } from '../components';
import { ImageField } from './ImageField';

export interface FieldInputProps {
  project: OpenProject;
  field: FieldDef;
  value: unknown;
  /** The entity being edited: it is not offered as a reference to itself. */
  self: string;
  onChange: (value: FieldValue) => void;
}

/** Entities a reference field may point at, for a select. */
function useTargets(project: OpenProject, field: FieldDef, self: string) {
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  return listEntities({ entities, types }, field.target ?? undefined).filter((e) => e.id !== self);
}

function EntityLink({ project, id }: { project: OpenProject; id: string }) {
  const name = useStore(project.store, (s) => (s.entities[id]?.name as string | undefined) ?? null);
  return (
    <button
      type="button"
      className={['entity-link', name === null && 'text-warning'].filter(Boolean).join(' ')}
      title={t('world.openCard')}
      onClick={() => openEntity(id)}
    >
      {name === null ? t('world.deletedEntity') : name || t('story.untitled')}
    </button>
  );
}

export function FieldInput({ project, field, value: raw, self, onChange }: FieldInputProps) {
  const id = useId();
  const readOnly = project.readOnly;
  const value = coerceValue(field, raw);
  const label = (
    <label htmlFor={id} className="field-label">
      {field.label || t('schema.untitledField')}
    </label>
  );
  const frame = (control: ReactNode, extra = '') => (
    <div className={`field world-field ${extra}`} data-field={`value:${field.id}`}>
      {label}
      {control}
    </div>
  );

  switch (field.type) {
    case 'text':
      return frame(
        <input
          id={id}
          className="input"
          value={value as string}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
    case 'richtext':
      return frame(
        <textarea
          id={id}
          className="input textarea world-long"
          value={value as string}
          rows={3}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
    case 'number':
    case 'percent': {
      const pct = field.type === 'percent';
      const n = value as number | null;
      const set = (text: string) => {
        if (text.trim() === '') return onChange(null);
        const v = Number(text.replace(',', '.'));
        if (Number.isFinite(v)) onChange(pct ? Math.max(0, Math.min(100, v)) : v);
      };
      return frame(
        <div className="world-number">
          <input
            id={id}
            className="input"
            type="number"
            step="any"
            min={pct ? 0 : undefined}
            max={pct ? 100 : undefined}
            value={n ?? ''}
            disabled={readOnly}
            onChange={(e) => set(e.target.value)}
          />
          {pct && (
            <>
              <input
                type="range"
                min={0}
                max={100}
                value={n ?? 0}
                disabled={readOnly}
                aria-label={field.label}
                onChange={(e) => set(e.target.value)}
              />
              <span className="muted">%</span>
            </>
          )}
        </div>,
      );
    }
    case 'bool':
      return (
        <div className="field world-field" data-field={`value:${field.id}`}>
          <Switch
            label={field.label || t('schema.untitledField')}
            checked={value === true}
            disabled={readOnly}
            onChange={(on) => onChange(on)}
          />
        </div>
      );
    case 'enum':
      return frame(
        <select
          id={id}
          className="input select"
          value={(value as string | null) ?? ''}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('world.none')}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>,
      );
    case 'ref':
      return (
        <RefInput
          project={project}
          field={field}
          value={value as string | null}
          self={self}
          onChange={onChange}
          id={id}
          label={label}
        />
      );
    case 'refList':
      return (
        <RefListInput
          project={project}
          field={field}
          value={value as string[]}
          self={self}
          onChange={onChange}
          label={label}
        />
      );
    case 'tags':
      return (
        <TagsInput
          project={project}
          field={field}
          value={value as string[]}
          self={self}
          onChange={onChange}
          label={label}
        />
      );
    case 'image':
      return frame(
        <ImageField
          project={project}
          value={value as string | null}
          label={field.label || t('schema.untitledField')}
          onChange={(path) => onChange(path)}
        />,
      );
    case 'color':
      return frame(
        <div className="world-color">
          <input
            id={id}
            type="color"
            value={(value as string | null) ?? '#888888'}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className={value ? '' : 'muted'}>{(value as string | null) ?? t('world.noColor')}</span>
          {value && !readOnly && (
            <IconButton size="sm" label={t('world.clear')} icon={<X size={14} />} onClick={() => onChange(null)} />
          )}
        </div>,
      );
    case 'table':
      return frame(
        <TableInput field={field} value={value as TableValue} readOnly={readOnly} onChange={onChange} />,
        'world-field-wide',
      );
  }
}

function RefInput({
  project,
  field,
  value,
  self,
  onChange,
  id,
  label,
}: Omit<FieldInputProps, 'value'> & { value: string | null; id: string; label: ReactNode }) {
  const targets = useTargets(project, field, self);
  return (
    <div className="field world-field" data-field={`value:${field.id}`}>
      {label}
      <div className="world-ref">
        <select
          id={id}
          className="input select"
          value={value ?? ''}
          disabled={project.readOnly}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('world.none')}</option>
          {targets.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name || t('story.untitled')}
            </option>
          ))}
          {value && !targets.some((e) => e.id === value) && <option value={value}>{t('world.deletedEntity')}</option>}
        </select>
        {value && (
          <IconButton
            size="sm"
            label={t('world.openCard')}
            icon={<ArrowUpRight size={14} />}
            onClick={() => openEntity(value)}
          />
        )}
      </div>
    </div>
  );
}

function RefListInput({
  project,
  field,
  value,
  self,
  onChange,
  label,
}: Omit<FieldInputProps, 'value'> & { value: string[]; label: ReactNode }) {
  const entities = useStore(project.store, (s) => s.entities);
  const targets = useTargets(project, field, self).filter((e) => !value.includes(e.id));
  // A card of the field's type can be made right here ("Tags as cards": a new trait while filling a card).
  const create = field.target
    ? (name: string) => {
        const entity = newEntity(project.store.getState(), field.target!, name);
        project.store.dispatch(t('world.step.newEntity'), (d) => {
          d.entities[entity.id] = entity as unknown as JsonObject;
          const owner = d.entities[self];
          if (!owner) return;
          const values = (owner.values && typeof owner.values === 'object' ? owner.values : {}) as JsonObject;
          owner.values = { ...values, [field.id]: [...value, entity.id] } as JsonObject;
        });
      }
    : undefined;
  const notes = value
    .map((id) => asEntity(entities[id]))
    .filter((e): e is NonNullable<typeof e> => !!e && !!e.description.trim())
    .map((e) => ({ id: e.id, name: e.name || t('story.untitled'), text: e.description }));
  return (
    <div className="field world-field" data-field={`value:${field.id}`}>
      {label}
      <div className="imark-chips">
        {value.map((id) => (
          <span key={id} className="chip">
            <EntityLink project={project} id={id} />
            {!project.readOnly && (
              <button
                type="button"
                className="chip-x"
                aria-label={t('world.removeRef')}
                onClick={() => onChange(value.filter((x) => x !== id))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!project.readOnly && (targets.length > 0 || create) && (
          <ChipPicker
            label={t('world.addRef')}
            options={targets.map((e) => ({ id: e.id, name: e.name || t('story.untitled'), hint: e.description }))}
            onPick={(id) => onChange([...value, id])}
            onCreate={create}
          />
        )}
      </div>
      <Notes notes={notes} />
    </div>
  );
}

/** Tags from a catalog (0.4): chips, their descriptions under them, a new tag made right from the field. */
function TagsInput({
  project,
  field,
  value,
  self,
  onChange,
  label,
}: Omit<FieldInputProps, 'value'> & { value: string[]; label: ReactNode }) {
  const types = useStore(project.store, (s) => s.types);
  const catalog = findCatalog(typesFile({ types }), field.catalog);
  if (!catalog) {
    return (
      <div className="field world-field" data-field={`value:${field.id}`}>
        {label}
        <p className="muted small">{t('world.tags.noCatalog')}</p>
      </div>
    );
  }
  const chosen = value.map((id) => catalog.tags.find((x) => x.id === id)).filter((x) => x !== undefined);
  const create = (name: string) =>
    project.store.dispatch(t('world.step.tag'), (d) => {
      const id = addTag(d, catalog.id, name);
      const owner = d.entities[self];
      if (!id || !owner) return;
      const values = (owner.values && typeof owner.values === 'object' ? owner.values : {}) as JsonObject;
      if (!value.includes(id)) owner.values = { ...values, [field.id]: [...value, id] } as JsonObject;
    });
  return (
    <div className="field world-field" data-field={`value:${field.id}`}>
      {label}
      <div className="imark-chips">
        {chosen.map((tag) => (
          <span
            key={tag.id}
            className="chip world-tag"
            title={tag.description || undefined}
            style={tag.color ? { borderColor: tag.color } : undefined}
          >
            {tag.name || t('story.untitled')}
            {!project.readOnly && (
              <button
                type="button"
                className="chip-x"
                aria-label={`${t('world.tags.remove')}: ${tag.name}`}
                onClick={() => onChange(value.filter((x) => x !== tag.id))}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {!project.readOnly && (
          <ChipPicker
            label={t('world.tags.add')}
            options={catalog.tags
              .filter((x) => !value.includes(x.id))
              .map((x) => ({ id: x.id, name: x.name || t('story.untitled'), hint: x.description }))}
            onPick={(id) => onChange([...value, id])}
            onCreate={create}
          />
        )}
      </div>
      <Notes
        notes={chosen.filter((x) => x.description.trim()).map((x) => ({ id: x.id, name: x.name, text: x.description }))}
      />
    </div>
  );
}

function Notes({ notes }: { notes: { id: string; name: string; text: string }[] }) {
  if (!notes.length) return null;
  return (
    <ul className="world-notes small">
      {notes.map((n) => (
        <li key={n.id}>
          <strong>{n.name}</strong> — <span className="muted">{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
}

/**
 * "Add…": a field to type into, with the matching options under it; Enter takes the first match, or makes a
 * new one when nothing matches and `onCreate` is given.
 */
function ChipPicker({
  label,
  options,
  onPick,
  onCreate,
}: {
  label: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  onCreate?: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !q || o.name.toLowerCase().includes(q));
  const exact = options.some((o) => o.name.toLowerCase() === q);
  const items: ({ kind: 'pick'; option: PickerOption } | { kind: 'create'; name: string })[] = [
    ...matches.map((option) => ({ kind: 'pick' as const, option })),
    ...(onCreate && q && !exact ? [{ kind: 'create' as const, name: query.trim() }] : []),
  ];
  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === 'pick') onPick(item.option.id);
    else onCreate?.(item.name);
    setQuery('');
    setActive(0);
  };
  return (
    <div className="world-picker">
      <input
        className="input imark-add"
        value={query}
        placeholder={label}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') choose(active);
          else if (e.key === 'Escape') setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && (items.length > 0 || q) && (
        <div className="world-picker-list" id={listId} role="listbox" aria-label={label}>
          {items.length === 0 && <p className="muted small world-picker-empty">{t('world.tags.empty')}</p>}
          {items.map((item, i) => (
            <button
              key={item.kind === 'pick' ? item.option.id : 'create'}
              type="button"
              role="option"
              aria-selected={i === active}
              className="world-picker-item"
              // Chosen before the field loses focus and the list closes.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              {item.kind === 'pick' ? (
                <>
                  <span>{item.option.name}</span>
                  {item.option.hint && <span className="muted small world-picker-hint">{item.option.hint}</span>}
                </>
              ) : (
                <span className="world-picker-create">
                  <Plus size={13} aria-hidden="true" /> {t('world.tags.create', { name: item.name })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TableInput({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: TableValue;
  readOnly: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const columns = field.columns ?? [];
  if (columns.length === 0) return <p className="muted small">{t('world.tableNoColumns')}</p>;
  const set = (rows: string[][]) => onChange({ rows });
  return (
    <div className="world-table-field">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {value.rows.map((row, r) => (
            <tr key={r}>
              {columns.map((c, i) => (
                <td key={i}>
                  <input
                    className="input"
                    value={row[i] ?? ''}
                    disabled={readOnly}
                    aria-label={`${c} ${r + 1}`}
                    onChange={(e) =>
                      set(value.rows.map((x, j) => (j === r ? x.map((y, k) => (k === i ? e.target.value : y)) : x)))
                    }
                  />
                </td>
              ))}
              <td>
                {!readOnly && (
                  <IconButton
                    size="sm"
                    label={t('world.removeRow')}
                    icon={<Trash size={14} />}
                    onClick={() => set(value.rows.filter((_, j) => j !== r))}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          onClick={() => set([...value.rows, columns.map(() => '')])}
        >
          {t('world.addRow')}
        </Button>
      )}
    </div>
  );
}

export { EntityLink };
