// "Types and fields" (F4-01…F4-05): the type tree with subtypes, the fields of each type, property sets
// shared by many types, and ready-made sets. Changes apply at once and can be undone.

import { ArrowDown, ArrowUp, Layers, Plus, Shapes, Trash } from 'lucide-react';
import { useState } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { listEntities } from '../../story/entities';
import { applyPreset, PRESETS } from '../../world/presets';
import {
  addField,
  addSet,
  addType,
  attachSet,
  canSetParent,
  deleteSet,
  deleteType,
  FIELD_KINDS,
  isBuiltIn,
  moveField,
  newField,
  removeField,
  renameSet,
  typeChain,
  typesFile,
  typesUsingSet,
  typeTree,
  updateField,
  updateType,
  type FieldDef,
  type FieldKind,
  type FieldOwner,
  type TypesFile,
} from '../../world/schema';
import { Button, Checkbox, Dialog, IconButton } from '../components';
import { FIELD_KIND_NAMES, typeName } from './typeNames';

type Selected = { kind: 'type' | 'set'; id: string };

const csv = (list: readonly string[] | undefined) => (list ?? []).join(', ');
const fromCsv = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function SchemaDialog({
  project,
  initialType,
  onClose,
}: {
  project: OpenProject;
  initialType?: string;
  onClose: () => void;
}) {
  const { store, readOnly } = project;
  const types = useStore(store, (s) => s.types);
  const schema = typesFile({ types });
  const [selected, setSelected] = useState<Selected>({ kind: 'type', id: initialType ?? 'character' });
  const change = (label: string, recipe: (d: ProjectData) => void, merge?: string) =>
    !readOnly && store.dispatch(label, recipe, merge ? { mergeKey: `schema:${merge}` } : {});

  const current =
    selected.kind === 'type'
      ? schema.types.find((x) => x.id === selected.id)
      : schema.propertySets.find((x) => x.id === selected.id);
  const shown: Selected = current ? selected : { kind: 'type', id: 'character' };

  const newType = (parent: string | null) => {
    let id = '';
    change(t('schema.step.type'), (d) => {
      id = addType(d, parent ? t('schema.newSubtype') : t('schema.newType'), parent);
    });
    if (id) setSelected({ kind: 'type', id });
  };
  const newSet = () => {
    let id = '';
    change(t('schema.step.set'), (d) => {
      id = addSet(d, t('schema.newSet'));
    });
    if (id) setSelected({ kind: 'set', id });
  };

  return (
    <Dialog open onClose={onClose} title={t('schema.title')} size="lg">
      <div className="schema">
        <nav className="schema-list" aria-label={t('schema.title')}>
          <h3 className="insp-heading">{t('schema.types')}</h3>
          {typeTree(schema).map(({ type, depth }) => (
            <button
              key={type.id}
              type="button"
              className="schema-item"
              aria-current={shown.kind === 'type' && shown.id === type.id ? 'true' : undefined}
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => setSelected({ kind: 'type', id: type.id })}
            >
              <Shapes size={14} aria-hidden="true" />
              {typeName(type)}
            </button>
          ))}
          {!readOnly && (
            <div className="insp-actions">
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => newType(null)}>
                {t('schema.addType')}
              </Button>
              {shown.kind === 'type' && (
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => newType(shown.id)}>
                  {t('schema.addSubtype')}
                </Button>
              )}
            </div>
          )}
          <h3 className="insp-heading">{t('schema.sets')}</h3>
          {schema.propertySets.length === 0 && <p className="muted small">{t('schema.noSets')}</p>}
          {schema.propertySets.map((s) => (
            <button
              key={s.id}
              type="button"
              className="schema-item"
              aria-current={shown.kind === 'set' && shown.id === s.id ? 'true' : undefined}
              onClick={() => setSelected({ kind: 'set', id: s.id })}
            >
              <Layers size={14} aria-hidden="true" />
              {s.name || t('story.untitled')}
            </button>
          ))}
          {!readOnly && (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={newSet}>
              {t('schema.addSet')}
            </Button>
          )}
        </nav>
        <div className="schema-editor">
          {shown.kind === 'type' ? (
            <TypeEditor
              project={project}
              schema={schema}
              id={shown.id}
              change={change}
              onDeleted={(next) => setSelected({ kind: 'type', id: next })}
              onSet={(id) => setSelected({ kind: 'set', id })}
            />
          ) : (
            <SetEditor
              project={project}
              schema={schema}
              id={shown.id}
              change={change}
              onDeleted={() => setSelected({ kind: 'type', id: 'character' })}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}

type Change = (label: string, recipe: (d: ProjectData) => void, merge?: string) => void;

function TypeEditor({
  project,
  schema,
  id,
  change,
  onDeleted,
  onSet,
}: {
  project: OpenProject;
  schema: TypesFile;
  id: string;
  change: Change;
  onDeleted: (next: string) => void;
  onSet: (id: string) => void;
}) {
  const { readOnly } = project;
  const entities = useStore(project.store, (s) => s.entities);
  const type = schema.types.find((x) => x.id === id)!;
  const builtIn = isBuiltIn(id);
  const above = typeChain(schema, id).slice(1);
  const count = Object.values(entities).filter((e) => e.type === id).length;
  const remove = () => {
    if (count && !window.confirm(t('schema.deleteTypeUsed', { count }))) return;
    change(t('schema.step.deleteType'), (d) => deleteType(d, id));
    onDeleted(type.parent ?? 'character');
  };
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`type-name-${id}`}>
          {t('schema.typeName')}
        </label>
        <input
          id={`type-name-${id}`}
          className="input"
          value={type.name}
          placeholder={typeName({ ...type, name: '' })}
          disabled={readOnly}
          onChange={(e) =>
            change(t('schema.step.type'), (d) => updateType(d, id, { name: e.target.value }), `type:${id}:name`)
          }
        />
      </div>
      {!builtIn && (
        <div className="field">
          <label className="field-label" htmlFor={`type-parent-${id}`}>
            {t('schema.parent')}
          </label>
          <select
            id={`type-parent-${id}`}
            className="input select"
            value={type.parent ?? ''}
            disabled={readOnly}
            onChange={(e) =>
              change(t('schema.step.type'), (d) => updateType(d, id, { parent: e.target.value || null }))
            }
          >
            <option value="">{t('schema.noParent')}</option>
            {typeTree(schema)
              .filter(({ type: x }) => canSetParent(schema, id, x.id))
              .map(({ type: x, depth }) => (
                <option key={x.id} value={x.id}>
                  {' '.repeat(depth)}
                  {typeName(x)}
                </option>
              ))}
          </select>
        </div>
      )}
      {above.length > 0 && (
        <p className="muted small">{t('schema.inherits', { types: above.map((x) => typeName(x)).join(' › ') })}</p>
      )}
      <section className="insp-section">
        <h3 className="insp-heading">{t('schema.typeSets')}</h3>
        {schema.propertySets.length === 0 && <p className="muted small">{t('schema.noSets')}</p>}
        {schema.propertySets.map((s) => (
          <div key={s.id} className="schema-set-row">
            <Checkbox
              label={s.name || t('story.untitled')}
              checked={type.propertySets.includes(s.id)}
              disabled={readOnly}
              onChange={(on) => change(t('schema.step.attach'), (d) => attachSet(d, id, s.id, on))}
            />
            <button type="button" className="entity-link small" onClick={() => onSet(s.id)}>
              {t('schema.fieldsCount', { count: s.fields.length })}
            </button>
          </div>
        ))}
        {!readOnly && (
          <div className="insp-actions">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => change(t('schema.step.preset'), (d) => void applyPreset(d, p, id))}
              >
                {t(p.name)}
              </Button>
            ))}
          </div>
        )}
        <p className="muted small">{t('schema.presetHint')}</p>
      </section>
      <FieldList project={project} owner={{ kind: 'type', id }} fields={type.fields} schema={schema} change={change} />
      <p className="muted small">
        {t('schema.typeCount', { count: listEntities({ entities, types: project.store.getState().types }, id).length })}
      </p>
      {!builtIn && !readOnly && (
        <Button size="sm" variant="danger" icon={<Trash size={14} />} onClick={remove}>
          {t('schema.deleteType')}
        </Button>
      )}
    </>
  );
}

function SetEditor({
  project,
  schema,
  id,
  change,
  onDeleted,
}: {
  project: OpenProject;
  schema: TypesFile;
  id: string;
  change: Change;
  onDeleted: () => void;
}) {
  const set = schema.propertySets.find((x) => x.id === id)!;
  const users = typesUsingSet(schema, id);
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`set-name-${id}`}>
          {t('schema.setName')}
        </label>
        <input
          id={`set-name-${id}`}
          className="input"
          value={set.name}
          disabled={project.readOnly}
          onChange={(e) => change(t('schema.step.set'), (d) => renameSet(d, id, e.target.value), `set:${id}:name`)}
        />
      </div>
      <p className="muted small">
        {users.length
          ? t('schema.setUsedBy', { types: users.map((x) => typeName(x)).join(', ') })
          : t('schema.setUnused')}
      </p>
      <FieldList project={project} owner={{ kind: 'set', id }} fields={set.fields} schema={schema} change={change} />
      {!project.readOnly && (
        <Button
          size="sm"
          variant="danger"
          icon={<Trash size={14} />}
          onClick={() => {
            if (users.length && !window.confirm(t('schema.deleteSetUsed', { count: users.length }))) return;
            change(t('schema.step.deleteSet'), (d) => deleteSet(d, id));
            onDeleted();
          }}
        >
          {t('schema.deleteSet')}
        </Button>
      )}
    </>
  );
}

function FieldList({
  project,
  owner,
  fields,
  schema,
  change,
}: {
  project: OpenProject;
  owner: FieldOwner;
  fields: FieldDef[];
  schema: TypesFile;
  change: Change;
}) {
  const { readOnly } = project;
  const [kind, setKind] = useState<FieldKind>('text');
  const set = (f: FieldDef, patch: Partial<FieldDef>, merge: string) =>
    change(t('schema.step.field'), (d) => updateField(d, owner, f.id, patch), `field:${f.id}:${merge}`);
  return (
    <section className="insp-section">
      <h3 className="insp-heading">{t('schema.fields')}</h3>
      {fields.length === 0 && <p className="muted small">{t('schema.noFields')}</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="schema-field" data-field={`field:${f.id}`}>
          <div className="schema-field-row">
            <input
              className="input"
              value={f.label}
              placeholder={t('schema.fieldLabel')}
              aria-label={t('schema.fieldLabel')}
              disabled={readOnly}
              onChange={(e) => set(f, { label: e.target.value }, 'label')}
            />
            <select
              className="input select"
              value={f.type}
              aria-label={t('schema.fieldKind')}
              disabled={readOnly}
              onChange={(e) => set(f, { type: e.target.value as FieldKind }, 'type')}
            >
              {FIELD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(FIELD_KIND_NAMES[k])}
                </option>
              ))}
            </select>
            {!readOnly && (
              <span className="iline-tools">
                <IconButton
                  size="sm"
                  label={t('story.up')}
                  icon={<ArrowUp size={14} />}
                  disabled={i === 0}
                  onClick={() => change(t('schema.step.field'), (d) => moveField(d, owner, i, i - 1))}
                />
                <IconButton
                  size="sm"
                  label={t('story.down')}
                  icon={<ArrowDown size={14} />}
                  disabled={i === fields.length - 1}
                  onClick={() => change(t('schema.step.field'), (d) => moveField(d, owner, i, i + 1))}
                />
                <IconButton
                  size="sm"
                  label={t('schema.removeField')}
                  icon={<Trash size={14} />}
                  onClick={() => change(t('schema.step.removeField'), (d) => removeField(d, owner, f.id))}
                />
              </span>
            )}
          </div>
          {f.type === 'enum' && (
            <ListInput
              value={f.options}
              label={t('schema.options')}
              disabled={readOnly}
              onChange={(options) => set(f, { options }, 'options')}
            />
          )}
          {f.type === 'table' && (
            <ListInput
              value={f.columns}
              label={t('schema.columns')}
              disabled={readOnly}
              onChange={(columns) => set(f, { columns }, 'columns')}
            />
          )}
          {(f.type === 'ref' || f.type === 'refList') && (
            <select
              className="input select"
              value={f.target ?? ''}
              aria-label={t('schema.target')}
              disabled={readOnly}
              onChange={(e) => set(f, { target: e.target.value || null }, 'target')}
            >
              <option value="">{t('schema.anyEntity')}</option>
              {typeTree(schema).map(({ type, depth }) => (
                <option key={type.id} value={type.id}>
                  {' '.repeat(depth)}
                  {typeName(type)}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="insp-actions">
          <select
            className="input select"
            value={kind}
            aria-label={t('schema.fieldKind')}
            onChange={(e) => setKind(e.target.value as FieldKind)}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(FIELD_KIND_NAMES[k])}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() =>
              change(t('schema.step.field'), (d) => addField(d, owner, newField(kind, t(FIELD_KIND_NAMES[kind]))))
            }
          >
            {t('schema.addField')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** A list typed as "a, b, c"; the draft is kept while typing so a trailing comma is not lost. */
function ListInput({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string[] | undefined;
  label: string;
  disabled: boolean;
  onChange: (list: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input"
      value={draft ?? csv(value)}
      placeholder={label}
      aria-label={label}
      disabled={disabled}
      onFocus={() => setDraft(csv(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(fromCsv(e.target.value));
      }}
    />
  );
}
