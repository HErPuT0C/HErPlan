// Editors for the values of entity fields (F4-02), one per kind of field.

import { ArrowUpRight, Plus, Trash, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openEntity } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { listEntities } from '../../story/entities';
import type { FieldDef } from '../../world/schema';
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
  const targets = useTargets(project, field, self).filter((e) => !value.includes(e.id));
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
        {!project.readOnly && targets.length > 0 && (
          <select
            className="input imark-add"
            value=""
            aria-label={t('world.addRef')}
            onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          >
            <option value="">{t('world.addRef')}</option>
            {targets.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || t('story.untitled')}
              </option>
            ))}
          </select>
        )}
      </div>
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
