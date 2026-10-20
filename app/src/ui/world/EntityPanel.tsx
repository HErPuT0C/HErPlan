// The card of one entity (F4-04): picture, name, type, the fields of its type with values, relations seen
// from this side, the variables it owns, and where it is used. Every change is saved at once and can be
// undone; there are no Save or Cancel buttons.

import { ArrowRight, Copy, Files, MoreHorizontal, Plus, Trash, Variable as VariableIcon, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { JsonObject, ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openEntity, openVariables, revealInStory } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { asEntity, listEntities, type WorldEntity } from '../../story/entities';
import { renameEverywhere } from '../../story/usage';
import { fullName, listVariables, nameProblem, newVariable, VAR_TYPES, type VarType } from '../../story/variables';
import {
  addRelation,
  copyValues,
  deleteEntity,
  duplicateEntity,
  editRelation,
  entityUses,
  relationsOf,
  removeRelation,
  type EntityUse,
  type RelationView,
} from '../../world/entityOps';
import {
  effectiveFields,
  inverseLabel,
  parsePairs,
  rememberPair,
  typesFile,
  typeTree,
  type EffectiveField,
  type TypesFile,
} from '../../world/schema';
import type { FieldValue } from '../../world/values';
import { Button, Dialog, IconButton, Menu, toast, type MenuEntry } from '../components';
import { changeVariable, VAR_TYPE_NAMES } from '../story/VariablesPanel';
import { ValueInput } from '../story/ValueInput';
import { useDraft } from '../useDraft';
import { EntityLink, FieldInput } from './FieldInput';
import { ImageField } from './ImageField';
import { typeName } from './typeNames';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="insp-section">
      <h3 className="insp-heading">{title}</h3>
      {children}
    </section>
  );
}

/** Changes one entity file in one undo step; typing into the same field merges into one step. */
function useEntityEdit(project: OpenProject, id: string) {
  return (label: string, recipe: (e: JsonObject, d: ProjectData) => void, merge?: string) =>
    !project.readOnly &&
    project.store.dispatch(
      label,
      (d) => {
        const e = d.entities[id];
        if (e) recipe(e, d);
      },
      merge ? { mergeKey: `entity:${id}:${merge}` } : {},
    );
}

export function EntityPanel({
  project,
  entity,
  onClose,
}: {
  project: OpenProject;
  entity: WorldEntity;
  onClose: () => void;
}) {
  const { store, readOnly } = project;
  const types = useStore(store, (s) => s.types);
  const schema = typesFile({ types });
  const edit = useEntityEdit(project, entity.id);
  const name = useDraft(entity.name);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copyFrom, setCopyFrom] = useState(false);

  const rename = (value: string) =>
    edit(
      t('world.step.edit'),
      (e, d) => {
        if (value === e.name) return;
        // Variables of this entity are written "Name.variable": keep expressions in step with the name.
        for (const v of listVariables(d).filter((x) => x.owner?.id === entity.id)) {
          const before = fullName(v, d);
          const after = fullName(v, { ...d, entities: { ...d.entities, [entity.id]: { ...e, name: value } } });
          renameEverywhere(d, before, after, v);
        }
        e.name = value;
      },
      'name',
    );
  const setValue = (fieldId: string, value: FieldValue) =>
    edit(
      t('world.step.edit'),
      (e) => {
        const values = (e.values && typeof e.values === 'object' ? e.values : {}) as JsonObject;
        e.values = { ...values, [fieldId]: value } as JsonObject;
      },
      `value:${fieldId}`,
    );

  const remove = () => {
    const uses = entityUses(store.getState(), entity.id).length;
    if (uses && !window.confirm(t('world.deleteUsed', { name: entity.name, count: uses }))) return;
    store.dispatch(t('world.step.delete'), (d) => deleteEntity(d, entity.id));
    onClose();
  };
  const entries: MenuEntry[] = [
    {
      id: 'duplicate',
      label: t('world.duplicate'),
      icon: <Files size={16} />,
      disabled: readOnly,
      onSelect: () => {
        let id: string | null = null;
        store.dispatch(t('world.step.duplicate'), (d) => {
          id = duplicateEntity(d, entity.id, t('world.copyName', { name: entity.name }));
        });
        if (id) openEntity(id);
      },
    },
    {
      id: 'copy',
      label: t('world.copyFrom'),
      icon: <Copy size={16} />,
      disabled: readOnly,
      onSelect: () => setCopyFrom(true),
    },
    { id: 'sep', separator: true },
    {
      id: 'delete',
      label: t('world.delete'),
      icon: <Trash size={16} />,
      danger: true,
      disabled: readOnly,
      onSelect: remove,
    },
  ];

  // Fields grouped by where they come from: the type (and the types above it) or a property set.
  const groups: { key: string; title: string; fields: EffectiveField[] }[] = [];
  for (const f of effectiveFields(schema, entity.type)) {
    const key = `${f.from.kind}:${f.from.id}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      const title =
        f.from.kind === 'type'
          ? typeName(schema.types.find((x) => x.id === f.from.id))
          : (schema.propertySets.find((s) => s.id === f.from.id)?.name ?? '');
      groups.push((group = { key, title, fields: [] }));
    }
    group.fields.push(f);
  }

  return (
    <aside className="world-panel" aria-label={t('world.card')} data-entity-panel={entity.id}>
      <header className="world-panel-head">
        <ImageField
          project={project}
          large
          value={entity.image}
          label={t('world.picture')}
          onChange={(image) => edit(t('world.step.image'), (e) => void (e.image = image))}
        />
        <div className="world-panel-title">
          <input
            className="input world-name"
            value={name.value}
            disabled={readOnly}
            aria-label={t('world.name')}
            onFocus={name.onFocus}
            onBlur={name.onBlur}
            onChange={(e) => {
              name.setValue(e.target.value);
              if (e.target.value.trim()) rename(e.target.value.trim());
            }}
          />
          <select
            className="input select"
            value={entity.type}
            disabled={readOnly}
            aria-label={t('world.type')}
            onChange={(e) => edit(t('world.step.type'), (x) => void (x.type = e.target.value))}
          >
            {typeTree(schema).map(({ type, depth }) => (
              <option key={type.id} value={type.id}>
                {' '.repeat(depth)}
                {typeName(type)}
              </option>
            ))}
          </select>
        </div>
        <div className="world-panel-tools">
          <IconButton
            size="sm"
            label={t('world.more')}
            icon={<MoreHorizontal size={16} />}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left - 160, y: r.bottom + 4 });
            }}
          />
          <IconButton size="sm" label={t('world.closeCard')} icon={<X size={16} />} onClick={onClose} />
        </div>
        {menu && <Menu entries={entries} x={menu.x} y={menu.y} label={t('world.more')} onClose={() => setMenu(null)} />}
      </header>
      <div className="world-panel-body">
        <div className="field">
          <label className="field-label" htmlFor={`desc-${entity.id}`}>
            {t('world.description')}
          </label>
          <textarea
            id={`desc-${entity.id}`}
            className="input textarea world-long"
            value={entity.description}
            rows={2}
            disabled={readOnly}
            onChange={(e) => edit(t('world.step.edit'), (x) => void (x.description = e.target.value), 'description')}
          />
        </div>
        {groups.map((g) => (
          <Section key={g.key} title={g.title}>
            {g.fields.map(({ field }) => (
              <FieldInput
                key={field.id}
                project={project}
                field={field}
                value={entity.values[field.id]}
                self={entity.id}
                onChange={(v) => setValue(field.id, v)}
              />
            ))}
          </Section>
        ))}
        {groups.length === 0 && <p className="muted small">{t('world.noFields')}</p>}
        <Relations project={project} entity={entity} schema={schema} />
        <OwnedVariables project={project} entity={entity} />
        <Uses project={project} id={entity.id} />
      </div>
      {copyFrom && (
        <EntityPicker
          project={project}
          title={t('world.copyFrom')}
          exclude={entity.id}
          onPick={(from) => {
            let count = 0;
            store.dispatch(t('world.step.copyValues'), (d) => {
              count = copyValues(d, from, entity.id);
            });
            toast({ kind: 'success', text: t('world.copied', { count }) });
          }}
          onClose={() => setCopyFrom(false)}
        />
      )}
    </aside>
  );
}

// ---------- relations (F4-06) ----------

function Relations({ project, entity, schema }: { project: OpenProject; entity: WorldEntity; schema: TypesFile }) {
  const { store, readOnly } = project;
  const entities = useStore(store, (s) => s.entities);
  const views = relationsOf({ entities }, entity.id);
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [inverse, setInverse] = useState('');
  const [inverseTouched, setInverseTouched] = useState(false);
  const defaults = parsePairs(t('world.relation.pairs'));
  const known = [...new Set([...schema.relationLabels, ...defaults].map((p) => p.label))];
  const others = listEntities({ entities }).filter((e) => e.id !== entity.id);

  const add = () => {
    if (!to || !label.trim()) return;
    store.dispatch(t('world.step.relation'), (d) => {
      addRelation(d, entity.id, to, label, inverse || label);
      rememberPair(d, label, inverse || label);
    });
    setTo('');
    setLabel('');
    setInverse('');
    setInverseTouched(false);
  };
  const change = (v: RelationView, patch: { label?: string; inverse?: string; description?: string }, merge: string) =>
    store.dispatch(
      t('world.step.relation'),
      (d) => editRelation(d, { owner: v.owner, outgoing: v.outgoing, id: v.relation.id }, patch),
      { mergeKey: `relation:${v.relation.id}:${merge}` },
    );

  return (
    <Section title={t('world.relations')}>
      {views.length === 0 && <p className="muted small">{t('world.noRelations')}</p>}
      {views.map((v) => (
        <div key={v.relation.id} className="world-relation">
          <div className="world-relation-head">
            <input
              className="input world-relation-label"
              value={v.label}
              disabled={readOnly}
              aria-label={t('world.relation.label')}
              placeholder={t('world.relation.label')}
              onChange={(e) => change(v, { label: e.target.value }, v.outgoing ? 'label' : 'inverse')}
            />
            <ArrowRight size={14} aria-hidden="true" className="muted" />
            <EntityLink project={project} id={v.other} />
            {!readOnly && (
              <IconButton
                size="sm"
                label={t('world.relation.remove')}
                icon={<Trash size={14} />}
                onClick={() =>
                  store.dispatch(t('world.step.relation'), (d) => removeRelation(d, v.owner, v.relation.id))
                }
              />
            )}
          </div>
          <label className="world-relation-inverse small muted">
            {t('world.relation.inverse', { name: (entities[v.other]?.name as string | undefined) ?? '' })}
            <input
              className="input"
              value={v.inverse}
              disabled={readOnly}
              onChange={(e) => change(v, { inverse: e.target.value }, v.outgoing ? 'inverse' : 'label')}
            />
          </label>
          <textarea
            className="input world-relation-desc"
            rows={1}
            value={v.relation.description}
            disabled={readOnly}
            placeholder={t('world.relation.description')}
            aria-label={t('world.relation.description')}
            onChange={(e) => change(v, { description: e.target.value }, 'description')}
          />
        </div>
      ))}
      {!readOnly && others.length > 0 && (
        <div className="world-relation-add">
          <select
            className="input select"
            value={to}
            aria-label={t('world.relation.to')}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">{t('world.relation.to')}</option>
            {others.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || t('story.untitled')}
              </option>
            ))}
          </select>
          <input
            className="input"
            list={`labels-${entity.id}`}
            value={label}
            placeholder={t('world.relation.label')}
            aria-label={t('world.relation.label')}
            onChange={(e) => {
              setLabel(e.target.value);
              if (!inverseTouched) setInverse(inverseLabel(schema, defaults, e.target.value) ?? '');
            }}
          />
          <datalist id={`labels-${entity.id}`}>
            {known.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <input
            className="input"
            list={`labels-${entity.id}`}
            value={inverse}
            placeholder={t('world.relation.inversePlaceholder')}
            aria-label={t('world.relation.inversePlaceholder')}
            onChange={(e) => {
              setInverse(e.target.value);
              setInverseTouched(true);
            }}
          />
          <Button size="sm" icon={<Plus size={14} />} disabled={!to || !label.trim()} onClick={add}>
            {t('world.relation.add')}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---------- variables of the entity (F4-10) ----------

function OwnedVariables({ project, entity }: { project: OpenProject; entity: WorldEntity }) {
  const { store, readOnly } = project;
  const data = useStore(store, (s) => s);
  const owned = listVariables(data).filter((v) => v.owner?.id === entity.id);
  const [name, setName] = useState('');
  const [type, setType] = useState<VarType>('int');
  const owner = { kind: 'entity' as const, id: entity.id };
  const problem = name.trim() ? nameProblem(data, name, 'project', owner) : null;
  const create = () => {
    if (!name.trim() || problem) return;
    const v = { ...newVariable(name, type), owner };
    store.dispatch(t('var.step.create'), (d) => {
      const file = d.variables as { variables?: unknown[] };
      (file.variables ??= []).push(v);
    });
    setName('');
  };
  return (
    <Section title={t('world.variables')}>
      {owned.length === 0 && <p className="muted small">{t('world.noVariables')}</p>}
      {owned.map((v) => (
        <div key={v.id} className="world-var">
          <button
            type="button"
            className="entity-link"
            title={t('world.openVariable')}
            onClick={() => openVariables(v.id)}
          >
            <VariableIcon size={13} aria-hidden="true" /> {fullName(v, data)}
          </button>
          <span className="muted small">{t(VAR_TYPE_NAMES[v.type])}</span>
          <ValueInput
            variable={v}
            value={v.initial}
            entities={data.entities}
            disabled={readOnly}
            label={t('var.initial')}
            onChange={(initial) =>
              store.dispatch(t('var.step.edit'), (d) => changeVariable(d, v.id, { initial }), {
                mergeKey: `var:${v.id}:initial`,
              })
            }
          />
        </div>
      ))}
      {!readOnly && (
        <div className="world-var-add">
          <input
            className="input"
            value={name}
            placeholder={t('world.variableName')}
            aria-label={t('world.variableName')}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <select
            className="input select"
            value={type}
            aria-label={t('var.type')}
            onChange={(e) => setType(e.target.value as VarType)}
          >
            {VAR_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(VAR_TYPE_NAMES[x])}
              </option>
            ))}
          </select>
          <Button size="sm" icon={<Plus size={14} />} disabled={!name.trim() || !!problem} onClick={create}>
            {t('world.addVariable')}
          </Button>
        </div>
      )}
      {problem && (
        <p className="small text-warning">{t(problem === 'taken' ? 'var.name.taken' : 'var.name.invalid')}</p>
      )}
    </Section>
  );
}

// ---------- where used (F4-09) ----------

function usageText(u: EntityUse): string {
  switch (u.kind) {
    case 'node':
      return t('world.use.node', { title: u.title || t('story.untitled') });
    case 'speaker':
      return t('world.use.speaker', { title: u.title || t('story.untitled'), count: u.count });
    case 'variable':
      return t('world.use.variable', { name: u.name });
    case 'value':
      return t('world.use.value', { name: u.name });
    case 'field':
      return t('world.use.field', { name: u.name || t('story.untitled'), field: u.field });
  }
}

function Uses({ project, id }: { project: OpenProject; id: string }) {
  const data = useStore(project.store, (s) => s);
  const uses = entityUses(data, id);
  const go = (u: EntityUse) => {
    if (u.kind === 'node' || u.kind === 'speaker') revealInStory({ graph: u.graph, node: u.node, highlight: [u.node] });
    else if (u.kind === 'variable' || u.kind === 'value') openVariables(u.variable);
    else openEntity(u.entity);
  };
  return (
    <Section title={t('world.uses')}>
      {uses.length === 0 && <p className="muted small">{t('world.notUsed')}</p>}
      {uses.map((u, i) => (
        <button key={i} type="button" className="var-use world-use" onClick={() => go(u)}>
          <span className="var-use-what">{usageText(u)}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      ))}
    </Section>
  );
}

// ---------- picking another entity ----------

export function EntityPicker({
  project,
  title,
  exclude,
  onPick,
  onClose,
}: {
  project: OpenProject;
  title: string;
  exclude?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  const schema = typesFile({ types });
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = listEntities({ entities }).filter((e) => e.id !== exclude && (!q || e.name.toLowerCase().includes(q)));
  return (
    <Dialog open onClose={onClose} title={title}>
      <input
        className="input asset-picker-search"
        autoFocus
        value={query}
        placeholder={t('world.search')}
        aria-label={t('world.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="node-picker" role="listbox" aria-label={title}>
        {list.map((e) => (
          <button
            key={e.id}
            type="button"
            role="option"
            aria-selected="false"
            className="node-picker-item"
            onClick={() => {
              onPick(e.id);
              onClose();
            }}
          >
            <span>{e.name || t('story.untitled')}</span>
            <span className="muted small">{typeName(schema.types.find((x) => x.id === e.type))}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export const entityOf = (data: ProjectData, id: string | null) => (id ? asEntity(data.entities[id]) : null);
