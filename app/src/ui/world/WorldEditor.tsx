// The world database (F4): entities of every type as cards grouped by type and subtype, or as a table;
// sorting by any field or by hand (drag), filters, search, and the card of the selected entity on the right.

import { ArrowDownAZ, ArrowUpAZ, Filter, LayoutGrid, Plus, Settings2, Shapes, Table2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { JsonObject } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { entityRequest } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { asEntity, listEntities, newEntity, type WorldEntity } from '../../story/entities';
import { reorderEntities } from '../../world/entityOps';
import { effectiveFields, typesFile, typeTree, type FieldDef, type TypesFile } from '../../world/schema';
import { coerceValue, compareValues, isEmptyValue, valueText, type ValueTextContext } from '../../world/values';
import { Button, EmptyState, IconButton } from '../components';
import { useAsync } from '../useAsync';
import { EntityPanel } from './EntityPanel';
import { SchemaDialog } from './SchemaDialog';
import { typeName } from './typeNames';
import './world.css';

type View = 'cards' | 'table';
type Op = 'contains' | 'eq' | 'gt' | 'lt' | 'yes' | 'no' | 'empty' | 'filled';

interface Rule {
  id: number;
  field: string;
  op: Op;
  value: string;
}

/** Sorting: by hand (the `order` of entities), by name, or by a field. */
interface Sort {
  by: string;
  dir: 1 | -1;
}

const VIEW_KEY = 'herplan.world.view';

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

const NAME: FieldDef = { id: 'name', label: '', type: 'text' };
const DESCRIPTION: FieldDef = { id: 'description', label: '', type: 'richtext' };

function fieldValue(e: WorldEntity, f: FieldDef): ReturnType<typeof coerceValue> {
  if (f.id === 'name') return e.name;
  if (f.id === 'description') return e.description;
  return coerceValue(f, e.values[f.id]);
}

function opsFor(f: FieldDef): Op[] {
  switch (f.type) {
    case 'number':
    case 'percent':
      return ['eq', 'gt', 'lt', 'empty', 'filled'];
    case 'bool':
      return ['yes', 'no'];
    case 'enum':
    case 'ref':
      return ['eq', 'empty', 'filled'];
    case 'refList':
      return ['contains', 'empty', 'filled'];
    case 'text':
    case 'richtext':
      return ['contains', 'eq', 'empty', 'filled'];
    default:
      return ['empty', 'filled'];
  }
}

function matches(e: WorldEntity, f: FieldDef, rule: Rule, ctx: ValueTextContext): boolean {
  const v = fieldValue(e, f);
  const want = rule.value.trim().toLowerCase();
  switch (rule.op) {
    case 'empty':
      return isEmptyValue(v);
    case 'filled':
      return !isEmptyValue(v);
    case 'yes':
      return v === true;
    case 'no':
      return v !== true;
    case 'gt':
      return typeof v === 'number' && v > Number(rule.value);
    case 'lt':
      return typeof v === 'number' && v < Number(rule.value);
    case 'eq':
      if (typeof v === 'number') return rule.value.trim() !== '' && v === Number(rule.value);
      if (f.type === 'ref' || f.type === 'enum') return v === rule.value;
      return valueText(f, v, ctx).toLowerCase() === want;
    case 'contains':
      if (f.type === 'refList') return Array.isArray(v) && v.includes(rule.value);
      return valueText(f, v, ctx).toLowerCase().includes(want);
  }
}

export function WorldEditor({ project }: { project: OpenProject }) {
  const { store, readOnly } = project;
  const entities = useStore(store, (s) => s.entities);
  const types = useStore(store, (s) => s.types);
  const schema = useMemo(() => typesFile({ types }), [types]);
  const [typeId, setTypeId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [view, setViewState] = useState<View>(savedView);
  const [sort, setSort] = useState<Sort>({ by: 'manual', dir: 1 });
  const [rules, setRules] = useState<Rule[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // A view remembered or not: nothing else depends on it.
    }
  };

  // Ctrl+click on a link to an entity anywhere: show its card here. A request is used once.
  const request = useAtom(entityRequest);
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      entityRequest.set(null);
      setSelected(request.id);
      setTypeId((current) => {
        const e = asEntity(store.getState().entities[request.id]);
        return current === 'all' || !e || listEntities(store.getState(), current).some((x) => x.id === e.id)
          ? current
          : 'all';
      });
      requestAnimationFrame(() =>
        document.querySelector(`[data-entity="${CSS.escape(request.id)}"]`)?.scrollIntoView({ block: 'nearest' }),
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [request, store]);

  const ctx: ValueTextContext = useMemo(
    () => ({
      entityName: (id) => (entities[id]?.name as string | undefined) ?? null,
      yes: t('var.yes'),
      no: t('var.no'),
    }),
    [entities],
  );
  const fields = useMemo(
    () => (typeId === 'all' ? [] : effectiveFields(schema, typeId).map((f) => f.field)),
    [schema, typeId],
  );
  const allFields = [{ ...NAME, label: t('world.name') }, { ...DESCRIPTION, label: t('world.description') }, ...fields];
  const fieldById = (id: string) => allFields.find((f) => f.id === id);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = listEntities({ entities, types }, typeId === 'all' ? undefined : typeId);
    if (q) {
      list = list.filter((e) => {
        if (e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)) return true;
        return effectiveFields(schema, e.type).some(({ field }) =>
          valueText(field, coerceValue(field, e.values[field.id]), ctx).toLowerCase().includes(q),
        );
      });
    }
    for (const rule of rules) {
      const f = allFields.find((x) => x.id === rule.field);
      if (f) list = list.filter((e) => matches(e, f, rule, ctx));
    }
    if (sort.by !== 'manual') {
      const f = allFields.find((x) => x.id === sort.by);
      if (f) list = [...list].sort((a, b) => sort.dir * compareValues(f, fieldValue(a, f), fieldValue(b, f), ctx));
    }
    return list;
    // allFields is rebuilt from `fields` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, types, typeId, query, rules, sort, schema, ctx, fields]);

  const add = () => {
    const type = typeId === 'all' ? 'character' : typeId;
    const entity = newEntity(store.getState(), type, t('world.newName'));
    store.dispatch(t('world.step.add'), (d) => {
      d.entities[entity.id] = entity as unknown as JsonObject;
    });
    setSelected(entity.id);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.world-panel .world-name')?.select());
  };

  /** Manual order: `ids` moved so that `moved` sits before `before` (or at the end of its group). */
  const move = (moved: string, before: string | null, group: string[]) => {
    const inGroup = group.filter((id) => id !== moved);
    const at = before ? inGroup.indexOf(before) : inGroup.length;
    inGroup.splice(at < 0 ? inGroup.length : at, 0, moved);
    const all = listEntities({ entities }).map((e) => e.id);
    const slots = all.filter((id) => group.includes(id));
    const queue = [...inGroup];
    const order = all.map((id) => (slots.includes(id) ? queue.shift()! : id));
    store.dispatch(t('world.step.order'), (d) => reorderEntities(d, order));
  };

  const current = selected ? asEntity(entities[selected]) : null;
  const manual = sort.by === 'manual';

  return (
    <div className="world">
      <nav className="world-types" aria-label={t('world.types')}>
        <button
          type="button"
          className="schema-item"
          aria-current={typeId === 'all' ? 'true' : undefined}
          onClick={() => setTypeId('all')}
        >
          <Shapes size={14} aria-hidden="true" />
          {t('world.all')}
          <span className="muted">{Object.keys(entities).length}</span>
        </button>
        {typeTree(schema).map(({ type, depth }) => (
          <button
            key={type.id}
            type="button"
            className="schema-item"
            aria-current={typeId === type.id ? 'true' : undefined}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => {
              setTypeId(type.id);
              setRules([]);
              if (sort.by !== 'manual' && sort.by !== 'name') setSort({ by: 'manual', dir: 1 });
            }}
          >
            {typeName(type)}
            <span className="muted">{listEntities({ entities, types }, type.id).length}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={() => setSchemaOpen(true)}>
          {t('world.schema')}
        </Button>
      </nav>

      <div className="world-main">
        <header className="world-bar">
          <input
            className="input world-search"
            type="search"
            value={query}
            placeholder={t('world.search')}
            aria-label={t('world.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="world-seg" role="radiogroup" aria-label={t('world.view')}>
            <IconButton
              size="sm"
              label={t('world.view.cards')}
              icon={<LayoutGrid size={16} />}
              pressed={view === 'cards'}
              onClick={() => setView('cards')}
            />
            <IconButton
              size="sm"
              label={t('world.view.table')}
              icon={<Table2 size={16} />}
              pressed={view === 'table'}
              onClick={() => setView('table')}
            />
          </div>
          <select
            className="input select world-sort"
            value={sort.by}
            aria-label={t('world.sort')}
            onChange={(e) => setSort({ by: e.target.value, dir: sort.dir })}
          >
            <option value="manual">{t('world.sort.manual')}</option>
            {allFields
              .filter((f) => f.type !== 'table' && f.type !== 'image')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label || t('schema.untitledField')}
                </option>
              ))}
          </select>
          {!manual && (
            <IconButton
              size="sm"
              label={t(sort.dir === 1 ? 'world.sort.asc' : 'world.sort.desc')}
              icon={sort.dir === 1 ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
              onClick={() => setSort({ ...sort, dir: sort.dir === 1 ? -1 : 1 })}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Filter size={14} />}
            onClick={() => setRules([...rules, { id: Date.now(), field: 'name', op: 'contains', value: '' }])}
          >
            {t('world.filter')}
          </Button>
          {!readOnly && (
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={add}>
              {t('world.add', {
                type: typeName(schema.types.find((x) => x.id === (typeId === 'all' ? 'character' : typeId))),
              })}
            </Button>
          )}
        </header>
        {rules.length > 0 && (
          <div className="world-rules">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                fields={allFields}
                project={project}
                onChange={(next) => setRules(rules.map((r) => (r.id === rule.id ? next : r)))}
                onRemove={() => setRules(rules.filter((r) => r.id !== rule.id))}
                fieldById={fieldById}
              />
            ))}
          </div>
        )}
        <div className="world-content">
          {shown.length === 0 ? (
            <EmptyState
              title={Object.keys(entities).length ? t('world.nothingFound') : t('world.empty')}
              text={Object.keys(entities).length ? t('world.nothingFoundHint') : t('world.emptyHint')}
            />
          ) : view === 'cards' ? (
            <CardsView
              project={project}
              schema={schema}
              list={shown}
              selected={selected}
              manual={manual && !readOnly}
              ctx={ctx}
              onSelect={setSelected}
              onMove={move}
            />
          ) : (
            <TableView
              project={project}
              schema={schema}
              list={shown}
              fields={fields}
              selected={selected}
              sort={sort}
              manual={manual && !readOnly}
              ctx={ctx}
              onSort={(by) => setSort(sort.by === by ? { by, dir: sort.dir === 1 ? -1 : 1 } : { by, dir: 1 })}
              onSelect={setSelected}
              onMove={(moved, before) =>
                move(
                  moved,
                  before,
                  shown.map((e) => e.id),
                )
              }
            />
          )}
        </div>
      </div>

      {current && <EntityPanel key={current.id} project={project} entity={current} onClose={() => setSelected(null)} />}
      {schemaOpen && (
        <SchemaDialog
          project={project}
          initialType={typeId === 'all' ? undefined : typeId}
          onClose={() => setSchemaOpen(false)}
        />
      )}
    </div>
  );
}

const OP_NAMES = {
  contains: 'world.op.contains',
  eq: 'world.op.eq',
  gt: 'world.op.gt',
  lt: 'world.op.lt',
  yes: 'world.op.yes',
  no: 'world.op.no',
  empty: 'world.op.empty',
  filled: 'world.op.filled',
} as const;

function RuleRow({
  rule,
  fields,
  project,
  onChange,
  onRemove,
  fieldById,
}: {
  rule: Rule;
  fields: FieldDef[];
  project: OpenProject;
  onChange: (rule: Rule) => void;
  onRemove: () => void;
  fieldById: (id: string) => FieldDef | undefined;
}) {
  const entities = useStore(project.store, (s) => s.entities);
  const f = fieldById(rule.field) ?? fields[0];
  const ops = opsFor(f);
  const op = ops.includes(rule.op) ? rule.op : ops[0];
  const needsValue = ['contains', 'eq', 'gt', 'lt'].includes(op);
  return (
    <div className="world-rule">
      <select
        className="input select"
        value={f.id}
        aria-label={t('world.filter.field')}
        onChange={(e) => {
          const next = fieldById(e.target.value) ?? f;
          onChange({ ...rule, field: next.id, op: opsFor(next)[0], value: '' });
        }}
      >
        {fields.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label || t('schema.untitledField')}
          </option>
        ))}
      </select>
      <select
        className="input select"
        value={op}
        aria-label={t('world.filter.op')}
        onChange={(e) => onChange({ ...rule, op: e.target.value as Op })}
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {t(OP_NAMES[o])}
          </option>
        ))}
      </select>
      {needsValue &&
        (f.type === 'enum' ? (
          <select
            className="input select"
            value={rule.value}
            aria-label={t('world.filter.value')}
            onChange={(e) => onChange({ ...rule, op, value: e.target.value })}
          >
            <option value="" />
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : f.type === 'ref' || f.type === 'refList' ? (
          <select
            className="input select"
            value={rule.value}
            aria-label={t('world.filter.value')}
            onChange={(e) => onChange({ ...rule, op, value: e.target.value })}
          >
            <option value="" />
            {listEntities({ entities }).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || t('story.untitled')}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input"
            value={rule.value}
            type={f.type === 'number' || f.type === 'percent' ? 'number' : 'text'}
            aria-label={t('world.filter.value')}
            onChange={(e) => onChange({ ...rule, op, value: e.target.value })}
          />
        ))}
      <IconButton size="sm" label={t('world.filter.remove')} icon={<X size={14} />} onClick={onRemove} />
    </div>
  );
}

function Picture({ project, path, size }: { project: OpenProject; path: string | null; size: number }) {
  const url = useAsync(
    () => (path ? platform().assetUrl(project.dir, path) : Promise.resolve('')),
    [project.dir, path],
    '',
  );
  return (
    <span className="world-pic" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </span>
  );
}

/** Drag and drop to reorder by hand; `over` marks where the dragged card would go. */
function useReorder(onMove: (moved: string, before: string | null) => void) {
  const dragged = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return {
    over,
    props: (id: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        dragged.current = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-herplan-entity', id);
      },
      onDragOver: (e: DragEvent) => {
        if (!dragged.current) return;
        e.preventDefault();
        setOver(id);
      },
      onDragEnd: () => {
        dragged.current = null;
        setOver(null);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const moved = dragged.current;
        dragged.current = null;
        setOver(null);
        if (moved && moved !== id) onMove(moved, id);
      },
    }),
  };
}

function CardsView({
  project,
  schema,
  list,
  selected,
  manual,
  ctx,
  onSelect,
  onMove,
}: {
  project: OpenProject;
  schema: TypesFile;
  list: WorldEntity[];
  selected: string | null;
  manual: boolean;
  ctx: ValueTextContext;
  onSelect: (id: string) => void;
  onMove: (moved: string, before: string | null, group: string[]) => void;
}) {
  // Groups follow the type tree: a type, then its subtypes.
  const groups = typeTree(schema)
    .map(({ type, depth }) => ({ type, depth, items: list.filter((e) => e.type === type.id) }))
    .filter((g) => g.items.length > 0);
  const known = new Set(schema.types.map((x) => x.id));
  const orphans = list.filter((e) => !known.has(e.type));
  return (
    <>
      {groups.map((g) => (
        <CardGroup
          key={g.type.id}
          title={typeChainTitle(schema, g.type.id)}
          project={project}
          schema={schema}
          items={g.items}
          selected={selected}
          manual={manual}
          ctx={ctx}
          onSelect={onSelect}
          onMove={(moved, before) =>
            onMove(
              moved,
              before,
              g.items.map((e) => e.id),
            )
          }
        />
      ))}
      {orphans.length > 0 && (
        <CardGroup
          title={t('world.type.unknown')}
          project={project}
          schema={schema}
          items={orphans}
          selected={selected}
          manual={manual}
          ctx={ctx}
          onSelect={onSelect}
          onMove={(moved, before) =>
            onMove(
              moved,
              before,
              orphans.map((e) => e.id),
            )
          }
        />
      )}
    </>
  );
}

function typeChainTitle(schema: TypesFile, id: string): string {
  const chain: string[] = [];
  let current = schema.types.find((x) => x.id === id);
  while (current) {
    chain.unshift(typeName(current));
    const parent = current.parent;
    current = parent ? schema.types.find((x) => x.id === parent) : undefined;
  }
  return chain.join(' › ');
}

function CardGroup({
  title,
  project,
  schema,
  items,
  selected,
  manual,
  ctx,
  onSelect,
  onMove,
}: {
  title: string;
  project: OpenProject;
  schema: TypesFile;
  items: WorldEntity[];
  selected: string | null;
  manual: boolean;
  ctx: ValueTextContext;
  onSelect: (id: string) => void;
  onMove: (moved: string, before: string | null) => void;
}) {
  const reorder = useReorder(onMove);
  return (
    <section className="world-group" aria-label={title}>
      <h2 className="world-group-title">
        {title} <span className="muted">{items.length}</span>
      </h2>
      <div className="world-cards">
        {items.map((e) => {
          const values = effectiveFields(schema, e.type)
            .map(({ field }) => ({ field, v: coerceValue(field, e.values[field.id]) }))
            .filter(
              ({ field, v }) =>
                !isEmptyValue(v) && field.type !== 'table' && field.type !== 'image' && field.type !== 'richtext',
            )
            .slice(0, 3);
          return (
            <article
              key={e.id}
              className={[
                'world-card',
                selected === e.id && 'world-card-selected',
                reorder.over === e.id && 'world-card-over',
              ]
                .filter(Boolean)
                .join(' ')}
              data-entity={e.id}
              tabIndex={0}
              aria-label={e.name || t('story.untitled')}
              onClick={() => onSelect(e.id)}
              onKeyDown={(k) => k.key === 'Enter' && onSelect(e.id)}
              {...(manual ? reorder.props(e.id) : {})}
            >
              <Picture project={project} path={e.image} size={56} />
              <div className="world-card-body">
                <strong className="world-card-name">{e.name || t('story.untitled')}</strong>
                {e.description && <span className="world-card-desc muted small">{e.description}</span>}
                {values.map(({ field, v }) => (
                  <span key={field.id} className="world-card-value small">
                    <span className="muted">{field.label}:</span>{' '}
                    {field.type === 'color' ? (
                      <span className="world-swatch" style={{ background: String(v) }} />
                    ) : (
                      valueText(field, v, ctx)
                    )}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TableView({
  project,
  schema,
  list,
  fields,
  selected,
  sort,
  manual,
  ctx,
  onSort,
  onSelect,
  onMove,
}: {
  project: OpenProject;
  schema: TypesFile;
  list: WorldEntity[];
  fields: FieldDef[];
  selected: string | null;
  sort: Sort;
  manual: boolean;
  ctx: ValueTextContext;
  onSort: (by: string) => void;
  onSelect: (id: string) => void;
  onMove: (moved: string, before: string | null) => void;
}) {
  const reorder = useReorder(onMove);
  const header = (id: string, label: string) => (
    <th key={id} aria-sort={sort.by === id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="world-th" onClick={() => onSort(id)}>
        {label}
      </button>
    </th>
  );
  return (
    <div className="world-table-wrap">
      <table className="world-table">
        <thead>
          <tr>
            <th aria-label={t('world.picture')} />
            {header('name', t('world.name'))}
            <th>{t('world.type')}</th>
            {fields.filter((f) => f.type !== 'table').map((f) => header(f.id, f.label || t('schema.untitledField')))}
            {header('description', t('world.description'))}
          </tr>
        </thead>
        <tbody>
          {list.map((e) => (
            <tr
              key={e.id}
              data-entity={e.id}
              className={[selected === e.id && 'world-row-selected', reorder.over === e.id && 'world-row-over']
                .filter(Boolean)
                .join(' ')}
              tabIndex={0}
              onClick={() => onSelect(e.id)}
              onKeyDown={(k) => k.key === 'Enter' && onSelect(e.id)}
              {...(manual ? reorder.props(e.id) : {})}
            >
              <td>
                <Picture project={project} path={e.image} size={28} />
              </td>
              <td>
                <strong>{e.name || t('story.untitled')}</strong>
              </td>
              <td className="muted">{typeName(schema.types.find((x) => x.id === e.type))}</td>
              {fields
                .filter((f) => f.type !== 'table')
                .map((f) => {
                  const v = coerceValue(f, e.values[f.id]);
                  return (
                    <td key={f.id}>
                      {f.type === 'color' && v ? (
                        <span className="world-swatch" style={{ background: String(v) }} />
                      ) : (
                        valueText(f, v, ctx)
                      )}
                    </td>
                  );
                })}
              <td className="world-td-desc muted">{e.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
