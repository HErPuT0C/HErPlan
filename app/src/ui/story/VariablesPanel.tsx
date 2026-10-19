import { ChevronDown, ChevronRight, Eye, PenLine, Plus, Trash, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { searchKey } from '../../canvas/ops';
import { newId } from '../../core/ids';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { closeVariables, revealInStory, variablesPanel } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { listEntities } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import { allGraphs, findNode } from '../../story/model';
import { nodesUsing, renameEverywhere, variableUsage, type Usage } from '../../story/usage';
import {
  coerce,
  fullName,
  listVariables,
  nameProblem,
  newVariable,
  VAR_TYPES,
  type Label,
  type Variable,
  type VarScope,
  type VarType,
} from '../../story/variables';
import { Button, IconButton, SelectField, TabPanel, Tabs, TextArea, TextField } from '../components';
import { ValueInput } from './ValueInput';

export const VAR_TYPE_NAMES: Record<VarType, MessageKey> = {
  bool: 'var.type.bool',
  int: 'var.type.int',
  float: 'var.type.float',
  string: 'var.type.string',
  enum: 'var.type.enum',
  entity: 'var.type.entity',
};

const NAME_PROBLEMS: Record<'empty' | 'invalid' | 'taken', MessageKey> = {
  empty: 'var.name.empty',
  invalid: 'var.name.invalid',
  taken: 'var.name.taken',
};

type FileShape = { variables?: Variable[]; labels?: Label[] };
const file = (d: ProjectData) => d.variables as FileShape;
const NO_LABELS: Label[] = [];

/** Changes one variable in a store recipe; a new name or owner is carried into every expression first. */
function changeVariable(d: ProjectData, id: string, patch: Partial<Variable>): void {
  const list = (file(d).variables ??= []);
  const v = list.find((x) => x.id === id);
  if (!v) return;
  const before = listVariables(d).find((x) => x.id === id)!;
  const next = { ...before, ...patch } as Variable;
  const oldName = fullName(before, d);
  const newName = fullName(next, d);
  if (oldName !== newName) renameEverywhere(d, oldName, newName, before);
  Object.assign(v, patch);
  if (patch.type || patch.values) {
    v.initial = coerce(v.initial, v.type, v.values ?? []);
    if (v.type === 'enum') v.values ??= [];
  }
}

/** The single registry of variables and labels (FR-NAR-04), over whichever editor is open. */
export function VariablesPanel({ project }: { project: OpenProject }) {
  const { open, focus } = useAtom(variablesPanel);
  const [tab, setTab] = useState<'variables' | 'labels'>('variables');
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('select')) {
      e.stopPropagation();
      closeVariables();
    }
  };
  return (
    <aside ref={panel} className="drawer" aria-label={t('var.title')} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="drawer-head">
        <h2>{t('var.title')}</h2>
        <IconButton label={t('common.close')} icon={<X size={16} />} onClick={closeVariables} />
      </header>
      <Tabs
        items={[
          { value: 'variables', label: t('var.tab.variables') },
          { value: 'labels', label: t('var.tab.labels') },
        ]}
        value={tab}
        onChange={setTab}
        label={t('var.title')}
        idPrefix="vars"
      />
      <TabPanel idPrefix="vars" value={tab}>
        {tab === 'variables' ? <VariableList project={project} focus={focus} /> : <LabelList project={project} />}
      </TabPanel>
    </aside>
  );
}

function VariableList({ project, focus }: { project: OpenProject; focus: string | null }) {
  const { store, readOnly } = project;
  const data = useStore(store, (s) => s);
  const [name, setName] = useState('');
  const [type, setType] = useState<VarType>('int');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(focus);
  const variables = listVariables(data);
  const usage = useMemo(() => variableUsage(data), [data]);
  const problem = name.trim() ? nameProblem(data, name, 'project', null) : null;

  const create = () => {
    if (!name.trim() || problem) return;
    const v = newVariable(name, type);
    store.dispatch(t('var.step.create'), (d) => {
      (file(d).variables ??= []).push(v);
    });
    setName('');
    setExpanded(v.id);
  };

  const q = searchKey(query.trim());
  const shown = variables.filter((v) => !q || searchKey(fullName(v, data)).includes(q));
  const groups = new Map<string, Variable[]>();
  for (const v of shown) {
    const key = v.owner
      ? t('var.group.owner', { name: (data.entities[v.owner.id]?.name as string) ?? '?' })
      : v.scope === 'project'
        ? t('var.group.project')
        : t('var.group.chapter', { name: graphTitle(data, v.scope.id) });
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }

  return (
    <div className="vars">
      {!readOnly && (
        <form
          className="vars-create"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <TextField
            label={t('var.new')}
            value={name}
            placeholder={t('var.newPlaceholder')}
            error={problem ? t(NAME_PROBLEMS[problem]) : null}
            onChange={(e) => setName(e.target.value)}
          />
          <SelectField
            label={t('var.type')}
            value={type}
            options={VAR_TYPES.map((v) => ({ value: v, label: t(VAR_TYPE_NAMES[v]) }))}
            onChange={setType}
          />
          <Button type="submit" variant="primary" icon={<Plus size={16} />} disabled={!name.trim() || !!problem}>
            {t('var.add')}
          </Button>
        </form>
      )}
      {variables.length > 6 && (
        <input
          className="input vars-search"
          value={query}
          placeholder={t('var.search')}
          aria-label={t('var.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {variables.length === 0 && <p className="muted">{t('var.empty')}</p>}
      {[...groups].map(([group, list]) => (
        <section key={group} className="vars-group">
          <h3 className="insp-heading">{group}</h3>
          {list.map((v) => (
            <VariableRow
              key={v.id}
              project={project}
              variable={v}
              usage={usage.get(v.id) ?? []}
              open={expanded === v.id}
              onToggle={() => setExpanded((x) => (x === v.id ? null : v.id))}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function VariableRow({
  project,
  variable: v,
  usage,
  open,
  onToggle,
}: {
  project: OpenProject;
  variable: Variable;
  usage: Usage[];
  open: boolean;
  onToggle: () => void;
}) {
  const { store, readOnly } = project;
  const data = store.getState();
  const entities = useStore(store, (s) => s.entities);
  const writes = usage.filter((u) => u.writes).length;
  const reads = usage.filter((u) => u.reads).length;
  const edit = (label: string, patch: Partial<Variable>, merge?: string) =>
    !readOnly &&
    store.dispatch(label, (d) => changeVariable(d, v.id, patch), merge ? { mergeKey: `var:${v.id}:${merge}` } : {});
  return (
    <div className={['var-row', open && 'var-row-open'].filter(Boolean).join(' ')}>
      <button type="button" className="var-row-head" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="var-name">{fullName(v, data)}</span>
        <span className="var-type">{t(VAR_TYPE_NAMES[v.type])}</span>
        <span className="var-usage muted small" title={t('var.usageTitle', { writes, reads })}>
          {usage.length ? (
            <>
              <PenLine size={12} aria-hidden="true" />
              {writes}
              <Eye size={12} aria-hidden="true" />
              {reads}
            </>
          ) : (
            t('var.unused')
          )}
        </span>
      </button>
      {open && (
        <div className="var-details">
          <VariableEditor project={project} variable={v} edit={edit} entities={entities} />
          <WhereUsed project={project} usage={usage} />
          {!readOnly && (
            <Button
              size="sm"
              variant="danger"
              icon={<Trash size={14} />}
              onClick={() => {
                if (usage.length && !window.confirm(t('var.deleteUsed', { count: usage.length }))) return;
                store.dispatch(t('var.step.delete'), (d) => {
                  const f = file(d);
                  f.variables = (f.variables ?? []).filter((x) => x.id !== v.id);
                });
              }}
            >
              {t('var.delete')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function VariableEditor({
  project,
  variable: v,
  edit,
  entities,
}: {
  project: OpenProject;
  variable: Variable;
  edit: (label: string, patch: Partial<Variable>, merge?: string) => void;
  entities: ProjectData['entities'];
}) {
  const { store, readOnly } = project;
  const data = store.getState();
  const [draftName, setDraftName] = useState(v.name);
  const problem = draftName.trim() === v.name ? null : nameProblem(data, draftName, v.scope, v.owner, v.id);
  const chapters = allGraphs(data).filter((g) => g.kind === 'chapter');
  const scopeValue = v.scope === 'project' ? '' : v.scope.id;
  return (
    <>
      <TextField
        label={t('var.name')}
        value={draftName}
        disabled={readOnly}
        error={problem ? t(NAME_PROBLEMS[problem]) : null}
        hint={t('var.nameHint')}
        onChange={(e) => {
          setDraftName(e.target.value);
          const next = e.target.value.trim();
          if (next && next !== v.name && !nameProblem(data, next, v.scope, v.owner, v.id)) {
            edit(t('var.step.rename'), { name: next }, 'name');
          }
        }}
      />
      <div className="field-row">
        <SelectField
          label={t('var.type')}
          value={v.type}
          disabled={readOnly}
          options={VAR_TYPES.map((x) => ({ value: x, label: t(VAR_TYPE_NAMES[x]) }))}
          onChange={(type) => edit(t('var.step.edit'), { type })}
        />
        <div className="field">
          <span className="field-label">{t('var.initial')}</span>
          <ValueInput
            variable={v}
            value={v.initial}
            entities={entities}
            disabled={readOnly}
            label={t('var.initial')}
            onChange={(initial) => edit(t('var.step.edit'), { initial }, 'initial')}
          />
        </div>
      </div>
      {v.type === 'enum' && (
        <TextField
          label={t('var.values')}
          defaultValue={(v.values ?? []).join(', ')}
          disabled={readOnly}
          hint={t('var.valuesHint')}
          onChange={(e) =>
            edit(
              t('var.step.edit'),
              {
                values: [
                  ...new Set(
                    e.target.value
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  ),
                ],
              },
              'values',
            )
          }
        />
      )}
      <div className="field-row">
        <SelectField
          label={t('var.scope')}
          value={scopeValue}
          disabled={readOnly}
          options={[
            { value: '', label: t('var.scope.project') },
            ...chapters.map((g) => ({ value: g.id, label: graphTitle(data, g.id) })),
          ]}
          onChange={(id) => edit(t('var.step.edit'), { scope: (id ? { kind: 'graph', id } : 'project') as VarScope })}
        />
        <SelectField
          label={t('var.owner')}
          value={v.owner?.id ?? ''}
          disabled={readOnly}
          options={[
            { value: '', label: t('var.owner.none') },
            ...listEntities({ entities }).map((e) => ({ value: e.id, label: e.name || t('story.untitled') })),
          ]}
          onChange={(id) => edit(t('var.step.edit'), { owner: id ? { kind: 'entity', id } : null })}
        />
      </div>
      <TextArea
        label={t('var.description')}
        value={v.description}
        rows={2}
        disabled={readOnly}
        onChange={(e) => edit(t('var.step.edit'), { description: e.target.value }, 'description')}
      />
    </>
  );
}

/** Where the variable changes and where it is read (FR-NAR-06), with a way to each place. */
function WhereUsed({ project, usage }: { project: OpenProject; usage: Usage[] }) {
  const data = project.store.getState();
  if (usage.length === 0) return <p className="muted small">{t('var.notUsed')}</p>;
  const place = (u: Usage) => {
    const node = u.site.node ? findNode(data, { graph: u.site.graph, node: u.site.node }) : undefined;
    const g = data.graphs[u.site.graph] as unknown as Parameters<typeof nodesUsing>[0];
    const edge = u.site.edge ? g.edges.find((e) => e.id === u.site.edge) : undefined;
    const from = edge && findNode(data, { graph: u.site.graph, node: edge.from.node });
    const what = node?.title || (edge ? t('var.usedOnEdge', { from: from?.title ?? '' }) : '') || t('story.untitled');
    return { what, where: graphTitle(data, u.site.graph), node: u.site.node ?? edge?.from.node };
  };
  const go = (u: Usage) => {
    const g = data.graphs[u.site.graph] as unknown as Parameters<typeof nodesUsing>[0];
    const p = place(u);
    closeVariables();
    revealInStory({
      graph: u.site.graph,
      node: p.node,
      edge: u.site.edge,
      highlight: [...nodesUsing(g, usage)],
    });
  };
  const list = (title: MessageKey, items: Usage[], icon: ReactNode) =>
    items.length > 0 && (
      <div className="var-uses">
        <h4 className="small muted">{t(title, { count: items.length })}</h4>
        {items.map((u, i) => {
          const p = place(u);
          return (
            <button
              key={`${u.site.graph}-${u.site.node ?? u.site.edge}-${u.site.option ?? ''}-${i}`}
              type="button"
              className="var-use"
              onClick={() => go(u)}
            >
              {icon}
              <span className="var-use-what">{p.what}</span>
              <span className="muted small">{p.where}</span>
              <code className="var-use-src">{u.site.source}</code>
            </button>
          );
        })}
      </div>
    );
  return (
    <>
      {list(
        'var.changes',
        usage.filter((u) => u.writes),
        <PenLine size={13} aria-hidden="true" />,
      )}
      {list(
        'var.reads',
        usage.filter((u) => u.reads && !u.writes),
        <Eye size={13} aria-hidden="true" />,
      )}
    </>
  );
}

function LabelList({ project }: { project: OpenProject }) {
  const { store, readOnly } = project;
  const labels = useStore(store, (s) => file(s).labels ?? NO_LABELS);
  const [name, setName] = useState('');
  const change = (id: string, patch: Partial<Label>, merge: string) =>
    store.dispatch(
      t('var.step.label'),
      (d) => {
        const l = (file(d).labels ?? []).find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      },
      { mergeKey: `label:${id}:${merge}` },
    );
  return (
    <div className="vars">
      <p className="muted small">{t('var.labelsHint')}</p>
      {!readOnly && (
        <form
          className="vars-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const label: Label = { id: newId(), name: name.trim(), color: '#7656c9' };
            store.dispatch(t('var.step.label'), (d) => {
              (file(d).labels ??= []).push(label);
            });
            setName('');
          }}
        >
          <TextField label={t('var.newLabel')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" icon={<Plus size={16} />} disabled={!name.trim()}>
            {t('var.add')}
          </Button>
        </form>
      )}
      {labels.map((l) => (
        <div key={l.id} className="label-row">
          <input
            type="color"
            className="label-color"
            value={l.color}
            disabled={readOnly}
            aria-label={t('var.labelColor', { name: l.name })}
            onChange={(e) => change(l.id, { color: e.target.value }, 'color')}
          />
          <input
            className="input"
            value={l.name}
            disabled={readOnly}
            aria-label={t('var.labelName')}
            onChange={(e) => change(l.id, { name: e.target.value }, 'name')}
          />
          {!readOnly && (
            <IconButton
              size="sm"
              label={t('var.deleteLabel')}
              icon={<Trash size={14} />}
              onClick={() =>
                store.dispatch(t('var.step.label'), (d) => {
                  const f = file(d);
                  f.labels = (f.labels ?? []).filter((x) => x.id !== l.id);
                })
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}
