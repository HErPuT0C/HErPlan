// "Types and fields" (F4-01…F4-05): the type tree with subtypes, the fields of each type, property sets
// shared by many types, and ready-made sets; since 0.4 catalogs of tags and the blocks each card shows.
// Changes apply at once and can be undone.

import { ArrowDown, ArrowLeftRight, ArrowUp, BookMarked, Layers, Link2, Plus, Shapes, Trash } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openEntity } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { listEntities } from '../../story/entities';
import { applyPreset, PRESETS } from '../../world/presets';
import {
  addCatalog,
  addField,
  addTag,
  CARD_SECTIONS,
  deleteCatalog,
  deleteTag,
  moveTag,
  renameCatalog,
  setSection,
  showsSection,
  updateTag,
  type CardSection,
  addSet,
  addType,
  attachSet,
  canSetParent,
  forgetPair,
  parsePairs,
  rememberPair,
  deleteSet,
  deleteType,
  FIELD_KINDS,
  isBuiltIn,
  moveField,
  newField,
  ownFields,
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
import { MentionText } from './MentionText';

type Selected = { kind: 'type' | 'set' | 'relations' | 'catalog'; id: string };

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
    selected.kind === 'relations'
      ? true
      : selected.kind === 'type'
        ? schema.types.find((x) => x.id === selected.id)
        : selected.kind === 'catalog'
          ? schema.catalogs.find((x) => x.id === selected.id)
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
  const newCatalog = () => {
    let id = '';
    change(t('schema.step.catalog'), (d) => {
      id = addCatalog(d, t('schema.newCatalog'));
    });
    if (id) setSelected({ kind: 'catalog', id });
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
          <h3 className="insp-heading">{t('schema.relations')}</h3>
          <button
            type="button"
            className="schema-item"
            aria-current={shown.kind === 'relations' ? 'true' : undefined}
            onClick={() => setSelected({ kind: 'relations', id: '' })}
          >
            <Link2 size={14} aria-hidden="true" />
            {t('schema.relationLabels')}
          </button>
          <h3 className="insp-heading">{t('schema.catalogs')}</h3>
          {schema.catalogs.length === 0 && <p className="muted small">{t('schema.noCatalogs')}</p>}
          {schema.catalogs.map((c) => (
            <button
              key={c.id}
              type="button"
              className="schema-item"
              aria-current={shown.kind === 'catalog' && shown.id === c.id ? 'true' : undefined}
              onClick={() => setSelected({ kind: 'catalog', id: c.id })}
            >
              <BookMarked size={14} aria-hidden="true" />
              {c.name || t('story.untitled')}
            </button>
          ))}
          {!readOnly && (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={newCatalog}>
              {t('schema.addCatalog')}
            </Button>
          )}
        </nav>
        <div className="schema-editor">
          {shown.kind === 'relations' ? (
            <RelationLabels project={project} schema={schema} change={change} />
          ) : shown.kind === 'catalog' ? (
            <CatalogEditor
              project={project}
              schema={schema}
              id={shown.id}
              change={change}
              onDeleted={() => setSelected({ kind: 'type', id: 'character' })}
            />
          ) : shown.kind === 'type' ? (
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

export type Change = (label: string, recipe: (d: ProjectData) => void, merge?: string) => void;

const SECTION_NAMES = {
  picture: 'schema.section.picture',
  description: 'schema.section.description',
  relations: 'schema.section.relations',
  variables: 'schema.section.variables',
  uses: 'schema.section.uses',
} as const satisfies Record<CardSection, string>;

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
      <section className="insp-section" data-card-blocks>
        <h3 className="insp-heading">{t('schema.card')}</h3>
        {CARD_SECTIONS.map((section) => (
          <Checkbox
            key={section}
            label={t(SECTION_NAMES[section])}
            checked={showsSection(schema, id, section)}
            disabled={readOnly}
            onChange={(on) => change(t('schema.step.card'), (d) => setSection(d, id, section, on))}
          />
        ))}
        <p className="muted small">{t('schema.cardHint')}</p>
      </section>
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
  return (
    <section className="insp-section">
      <h3 className="insp-heading">{t('schema.fields')}</h3>
      {fields.length === 0 && <p className="muted small">{t('schema.noFields')}</p>}
      {fields.map((f, i) => (
        <FieldEditor
          key={f.id}
          field={f}
          schema={schema}
          readOnly={readOnly}
          onPatch={(patch, merge) =>
            change(t('schema.step.field'), (d) => updateField(d, owner, f.id, patch), `field:${f.id}:${merge}`)
          }
          onNewCatalog={() =>
            change(t('schema.step.catalog'), (d) => {
              const catalog = addCatalog(d, f.label || t('schema.newCatalog'));
              updateField(d, owner, f.id, { catalog });
            })
          }
          tools={
            !readOnly && (
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
            )
          }
        />
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

/**
 * One field's settings: its name and kind, and what the kind needs (values of a list, columns of a table, the
 * type a link points at, the catalog of tags). Used by "Types and fields" and by the card itself (0.5).
 */
export function FieldEditor({
  field: f,
  schema,
  readOnly,
  onPatch,
  onNewCatalog,
  tools,
}: {
  field: FieldDef;
  schema: TypesFile;
  readOnly: boolean;
  onPatch: (patch: Partial<FieldDef>, merge: string) => void;
  onNewCatalog: () => void;
  tools?: ReactNode;
}) {
  return (
    <div className="schema-field" data-field={`field:${f.id}`}>
      <div className="schema-field-row">
        <input
          className="input"
          value={f.label}
          placeholder={t('schema.fieldLabel')}
          aria-label={t('schema.fieldLabel')}
          disabled={readOnly}
          onChange={(e) => onPatch({ label: e.target.value }, 'label')}
        />
        <select
          className="input select"
          value={f.type}
          aria-label={t('schema.fieldKind')}
          disabled={readOnly}
          onChange={(e) => onPatch({ type: e.target.value as FieldKind }, 'type')}
        >
          {FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(FIELD_KIND_NAMES[k])}
            </option>
          ))}
        </select>
        {tools}
      </div>
      {f.type === 'enum' && (
        <ListInput
          value={f.options}
          label={t('schema.options')}
          disabled={readOnly}
          onChange={(options) => onPatch({ options }, 'options')}
        />
      )}
      {f.type === 'table' && (
        <ListInput
          value={f.columns}
          label={t('schema.columns')}
          disabled={readOnly}
          onChange={(columns) => onPatch({ columns }, 'columns')}
        />
      )}
      {(f.type === 'ref' || f.type === 'refList') && (
        <select
          className="input select"
          value={f.target ?? ''}
          aria-label={t('schema.target')}
          disabled={readOnly}
          onChange={(e) => onPatch({ target: e.target.value || null }, 'target')}
        >
          <option value="">{t('schema.anyEntity')}</option>
          {typeTree(schema).map(({ type, depth }) => (
            <option key={type.id} value={type.id}>
              {' '.repeat(depth)}
              {typeName(type)}
            </option>
          ))}
        </select>
      )}
      {f.type === 'tags' && (
        <select
          className="input select"
          value={f.catalog ?? ''}
          aria-label={t('schema.catalog')}
          disabled={readOnly}
          onChange={(e) =>
            e.target.value === NEW_CATALOG ? onNewCatalog() : onPatch({ catalog: e.target.value || null }, 'catalog')
          }
        >
          <option value="">{t('schema.noCatalog')}</option>
          {schema.catalogs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t('story.untitled')}
            </option>
          ))}
          <option value={NEW_CATALOG}>{t('schema.createCatalog')}</option>
        </select>
      )}
    </div>
  );
}

const NEW_CATALOG = '\u0000new';

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

/** Pairs of relation labels (жена ↔ муж): the project's own, which can be added and removed, and the built-in ones. */
function RelationLabels({ project, schema, change }: { project: OpenProject; schema: TypesFile; change: Change }) {
  const [label, setLabel] = useState('');
  const [inverse, setInverse] = useState('');
  // Each pair is kept both ways; it is listed once.
  const once = (pairs: { label: string; inverse: string }[]) =>
    pairs.filter((p, i) => !pairs.slice(0, i).some((q) => q.label === p.inverse && q.inverse === p.label));
  const own = once(schema.relationLabels);
  const builtIn = once(parsePairs(t('world.relation.pairs')));
  const add = () => {
    if (!label.trim()) return;
    change(t('schema.step.pair'), (d) => rememberPair(d, label, inverse.trim() || label));
    setLabel('');
    setInverse('');
  };
  return (
    <>
      <p className="muted small">{t('schema.relationsHint')}</p>
      <section className="insp-section">
        <h3 className="insp-heading">{t('schema.ownPairs')}</h3>
        {own.length === 0 && <p className="muted small">{t('schema.noPairs')}</p>}
        {own.map((p) => (
          <div key={`${p.label}|${p.inverse}`} className="schema-set-row">
            <span>
              {p.label} <ArrowLeftRight size={12} aria-hidden="true" className="muted" /> {p.inverse}
            </span>
            {!project.readOnly && (
              <IconButton
                size="sm"
                label={t('schema.removePair')}
                icon={<Trash size={14} />}
                onClick={() => change(t('schema.step.pair'), (d) => forgetPair(d, p.label, p.inverse))}
              />
            )}
          </div>
        ))}
        {!project.readOnly && (
          <div className="world-relation-add">
            <input
              className="input"
              value={label}
              placeholder={t('schema.pairLabel')}
              aria-label={t('schema.pairLabel')}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className="input"
              value={inverse}
              placeholder={t('schema.pairInverse')}
              aria-label={t('schema.pairInverse')}
              onChange={(e) => setInverse(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button size="sm" icon={<Plus size={14} />} disabled={!label.trim()} onClick={add}>
              {t('schema.addPair')}
            </Button>
          </div>
        )}
      </section>
      <section className="insp-section">
        <h3 className="insp-heading">{t('schema.builtInPairs')}</h3>
        <p className="muted small">
          {builtIn.map((p) => (p.label === p.inverse ? p.label : `${p.label} ↔ ${p.inverse}`)).join(', ')}
        </p>
      </section>
    </>
  );
}

/**
 * A catalog of tags (0.4): the tags with descriptions, the fields that use it, the cards that carry each tag.
 * Shown in "Types and fields" and, since 0.5, in the database itself.
 */
export function CatalogEditor({
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
  const { readOnly } = project;
  const entities = useStore(project.store, (s) => s.entities);
  const catalog = schema.catalogs.find((x) => x.id === id)!;
  const [name, setName] = useState('');
  const fields = [
    ...schema.types.flatMap((x) => x.fields.map((f) => ({ f, owner: typeName(x) }))),
    ...schema.propertySets.flatMap((x) => x.fields.map((f) => ({ f, owner: x.name }))),
    ...listEntities({ entities }).flatMap((e) =>
      ownFields(e).map((f) => ({ f, owner: e.name || t('story.untitled') })),
    ),
  ].filter(({ f }) => f.type === 'tags' && f.catalog === id);
  const carriers = (tag: string) =>
    listEntities({ entities }).filter((e) => Object.values(e.values).some((v) => Array.isArray(v) && v.includes(tag)));
  const add = () => {
    if (!name.trim()) return;
    change(t('schema.step.tag'), (d) => void addTag(d, id, name));
    setName('');
  };
  const edit = (tag: string, patch: Parameters<typeof updateTag>[3], merge: string) =>
    change(t('schema.step.tag'), (d) => updateTag(d, id, tag, patch), `tag:${tag}:${merge}`);
  return (
    <>
      <p className="muted small">{t('schema.catalogHint')}</p>
      <div className="field">
        <label className="field-label" htmlFor={`catalog-name-${id}`}>
          {t('schema.catalogName')}
        </label>
        <input
          id={`catalog-name-${id}`}
          className="input"
          value={catalog.name}
          disabled={readOnly}
          onChange={(e) =>
            change(t('schema.step.catalog'), (d) => renameCatalog(d, id, e.target.value), `catalog:${id}:name`)
          }
        />
      </div>
      <p className="muted small">
        {fields.length
          ? t('schema.catalogUsedBy', {
              fields: fields.map(({ f, owner }) => `${owner} › ${f.label || t('schema.untitledField')}`).join(', '),
            })
          : t('schema.catalogUnused')}
      </p>
      <section className="insp-section">
        <h3 className="insp-heading">{t('schema.tags')}</h3>
        {catalog.tags.length === 0 && <p className="muted small">{t('schema.noTags')}</p>}
        {catalog.tags.map((tag, i) => {
          const cards = carriers(tag.id);
          const count = cards.length;
          return (
            <div key={tag.id} className="schema-field schema-tag" data-tag={tag.id}>
              <div className="schema-field-row">
                <input
                  className="input"
                  value={tag.name}
                  placeholder={t('schema.tagName')}
                  aria-label={t('schema.tagName')}
                  disabled={readOnly}
                  onChange={(e) => edit(tag.id, { name: e.target.value }, 'name')}
                />
                <span className="muted small schema-tag-uses">{t('schema.tagUses', { count })}</span>
                {!readOnly && (
                  <span className="iline-tools">
                    <IconButton
                      size="sm"
                      label={t('story.up')}
                      icon={<ArrowUp size={14} />}
                      disabled={i === 0}
                      onClick={() => change(t('schema.step.tag'), (d) => moveTag(d, id, i, i - 1))}
                    />
                    <IconButton
                      size="sm"
                      label={t('story.down')}
                      icon={<ArrowDown size={14} />}
                      disabled={i === catalog.tags.length - 1}
                      onClick={() => change(t('schema.step.tag'), (d) => moveTag(d, id, i, i + 1))}
                    />
                    <IconButton
                      size="sm"
                      label={t('schema.removeTag')}
                      icon={<Trash size={14} />}
                      onClick={() => {
                        if (count && !window.confirm(t('schema.removeTagUsed', { count }))) return;
                        change(t('schema.step.deleteTag'), (d) => deleteTag(d, id, tag.id));
                      }}
                    />
                  </span>
                )}
              </div>
              <MentionText
                project={project}
                className="schema-tag-description"
                value={tag.description}
                self={{ kind: 'tag', id: tag.id, catalog: id, name: tag.name }}
                placeholder={t('schema.tagDescription')}
                label={t('schema.tagDescription')}
                onChange={(text) => edit(tag.id, { description: text }, 'description')}
              />
              {cards.length > 0 && (
                <div className="schema-tag-cards small">
                  {cards.map((e) => (
                    <button key={e.id} type="button" className="entity-link" onClick={() => openEntity(e.id)}>
                      {e.name || t('story.untitled')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <div className="insp-actions">
            <input
              className="input"
              value={name}
              placeholder={t('schema.tagName')}
              aria-label={t('schema.addTag')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button size="sm" icon={<Plus size={14} />} disabled={!name.trim()} onClick={add}>
              {t('schema.addTag')}
            </Button>
          </div>
        )}
      </section>
      {!readOnly && (
        <Button
          size="sm"
          variant="danger"
          icon={<Trash size={14} />}
          onClick={() => {
            if (fields.length && !window.confirm(t('schema.deleteCatalogUsed', { count: fields.length }))) return;
            change(t('schema.step.deleteCatalog'), (d) => deleteCatalog(d, id));
            onDeleted();
          }}
        >
          {t('schema.deleteCatalog')}
        </Button>
      )}
    </>
  );
}
