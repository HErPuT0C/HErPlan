import { ArrowDown, ArrowRight, ArrowUp, BookOpen, ImagePlus, Plus, Trash, X } from 'lucide-react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import { kindOf } from '../../canvas/kinds';
import type { GraphDoc, GraphEdge } from '../../canvas/model';
import { setNodeProps } from '../../canvas/ops';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { listEntities, newEntity, type WorldEntity } from '../../story/entities';
import { graphTitle, refKey } from '../../story/flow';
import {
  asStory,
  findNode,
  graphOf,
  type DialogueLine,
  type NodeRef,
  type StoryNode,
  type WorldKind,
} from '../../story/model';
import {
  addLine,
  addLink,
  addOption,
  moveLine,
  moveOption,
  removeLine,
  removeLink,
  removeOption,
  setExpanded,
  storyNode,
  updateLine,
  updateOption,
} from '../../story/ops';
import { Button, IconButton, SelectField, Switch, TextArea, TextField, toast } from '../components';
import { errorText } from '../errors';
import { KindIcon } from '../canvas/kindIcons';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { IMAGE_FILTERS } from '../start/filters';
import { useStory } from './context';
import { ExpressionField } from './ExpressionField';
import { NodePicker } from './NodePicker';

export interface InspectFocus {
  node: string;
  field: string;
  at: number;
}

/** Properties of the selected node or edge (or of the graph when nothing is selected). */
export function Inspector({ engine, focus }: { engine: CanvasEngine; focus: InspectFocus | null }) {
  const { project, graphId } = useStory();
  const selection = useAtom(engine.selection);
  const graph = useStore(project.store, (s) => graphOf(s, graphId));
  const panel = useRef<HTMLDivElement>(null);

  // A double click on a card's content asks for one field: focus it once it is on screen.
  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const box = panel.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(focus.field)}"]`);
      box?.scrollIntoView({ block: 'nearest' });
      box?.querySelector<HTMLElement>('textarea, input, select, button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  if (!graph) return null;
  let content: ReactNode;
  const nodeIds = [...selection.nodes];
  const edgeIds = [...selection.edges];
  if (nodeIds.length === 1 && edgeIds.length === 0) {
    const node = graph.nodes.find((n) => n.id === nodeIds[0]);
    content = node ? <NodeInspector key={node.id} node={asStory(node)} /> : null;
  } else if (edgeIds.length === 1 && nodeIds.length === 0) {
    const edge = graph.edges.find((e) => e.id === edgeIds[0]);
    content = edge ? <EdgeInspector key={edge.id} edge={edge} graph={graph} /> : null;
  } else if (nodeIds.length + edgeIds.length > 1) {
    content = <p className="muted">{t('story.inspector.many', { nodes: nodeIds.length, edges: edgeIds.length })}</p>;
  } else {
    content = <GraphInspector graph={graph} />;
  }
  return (
    <div className="inspector" ref={panel}>
      {content}
    </div>
  );
}

function Section({ title, children, field }: { title: string; children: ReactNode; field?: string }) {
  return (
    <section className="insp-section" data-field={field}>
      <h3 className="insp-heading">{title}</h3>
      {children}
    </section>
  );
}

function NodeInspector({ node }: { node: StoryNode }) {
  const { project, edit, openChapter } = useStory();
  const readOnly = project.readOnly;
  const kind = kindOf(node.kind);
  const set = (key: string, props: Partial<StoryNode>, label = t('story.step.edit')) =>
    edit(label, (g) => setNodeProps(g, [node.id], props), `${key}:${node.id}`);
  const textLabel =
    node.kind === 'choice'
      ? t('story.inspector.prompt')
      : node.kind === 'end'
        ? t('story.inspector.ending')
        : node.kind === 'chapter'
          ? t('story.inspector.description')
          : t('story.inspector.text');
  const hasText = !['start', 'condition', 'effect', 'jump', 'dialogue'].includes(node.kind);

  return (
    <>
      <header className="insp-title">
        <span className="insp-kind" style={{ background: kind.color }}>
          <KindIcon kind={node.kind} size={14} />
        </span>
        <span>{t(kind.label)}</span>
      </header>
      <TextField
        label={t('story.inspector.title')}
        value={node.title}
        disabled={readOnly}
        data-field="title"
        onChange={(e) => set('title', { title: e.target.value }, t('canvas.step.rename'))}
      />
      {node.kind === 'start' && <p className="muted small">{t('story.inspector.startHint')}</p>}
      {node.kind === 'chapter' && (
        <Button icon={<BookOpen size={16} />} onClick={() => openChapter(node.id)}>
          {t('story.chapter.open')}
        </Button>
      )}
      {hasText && (
        <TextArea
          label={textLabel}
          value={node.text ?? ''}
          rows={3}
          disabled={readOnly}
          data-field="text"
          onChange={(e) => set('text', { text: e.target.value }, t('canvas.step.text'))}
        />
      )}
      {node.kind === 'dialogue' && <DialogueSection node={node} />}
      {node.kind === 'choice' && <ChoiceSection node={node} />}
      {node.kind === 'condition' && (
        <>
          <ExpressionField
            label={t('story.condition')}
            kind="condition"
            field="expr"
            value={node.expr ?? ''}
            readOnly={readOnly}
            onChange={(expr) => set('expr', { expr }, t('story.step.condition'))}
          />
          <p className="muted small">{t('story.condition.hint')}</p>
        </>
      )}
      {(node.kind === 'effect' || node.kind === 'butterfly') && (
        <ExpressionField
          label={t('story.effects')}
          kind="effects"
          field="effects"
          value={node.effects ?? ''}
          readOnly={readOnly}
          onChange={(effects) => set('effects', { effects }, t('story.step.effects'))}
        />
      )}
      {node.kind === 'butterfly' && (
        <LinksSection node={node} title={t('story.consequences')} add={t('story.consequences.add')} />
      )}
      {node.kind === 'gun' && <LinksSection node={node} title={t('story.payoffs')} add={t('story.payoffs.add')} />}
      {node.kind === 'jump' && <JumpSection node={node} />}
      {node.kind === 'chapter' && <ChapterImage node={node} />}
      {(node.kind === 'character' || node.kind === 'location' || node.kind === 'item') && (
        <RefSection node={node} kind={node.kind} />
      )}
      {!['gun', 'butterfly', 'start', 'chapter'].includes(node.kind) && <PlotRole node={node} />}
      <TextArea
        label={t('canvas.comment')}
        value={node.comment ?? ''}
        rows={2}
        disabled={readOnly}
        data-field="comment"
        onChange={(e) => set('comment', { comment: e.target.value }, t('canvas.step.comment'))}
      />
    </>
  );
}

// ---------- dialogue ----------

function DialogueSection({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const readOnly = project.readOnly;
  const limits = useStore(project.store, (s) => s.meta.settings.dialogueLimits);
  const entities = useStore(project.store, (s) => s.entities);
  const characters = listEntities({ entities }, 'character');
  const lines = node.lines ?? [];
  const over = lines.length > limits.maxLines;
  const add = () => {
    let id: string | null = null;
    // A new line goes to the other speaker of the last two lines: dialogues alternate.
    const speaker = lines.length >= 2 ? lines[lines.length - 2].speaker : null;
    edit(t('story.step.lines'), (g) => {
      id = addLine(g, node.id, { speaker });
    });
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-line="${id}"] textarea`)?.focus());
  };
  return (
    <Section title={t('story.lines')} field="lines">
      <p className={['small', over ? 'text-warning' : 'muted'].join(' ')}>
        {t('story.lines.count', { count: lines.length, max: limits.maxLines })}
        {over && ` ${t('story.lines.over')}`}
      </p>
      {lines.map((line, i) => (
        <LineRow
          key={line.id}
          line={line}
          index={i}
          last={i === lines.length - 1}
          nodeId={node.id}
          maxChars={limits.maxLineChars}
          characters={characters}
          entities={entities}
          readOnly={readOnly}
        />
      ))}
      {!readOnly && (
        <div className="insp-actions">
          <Button size="sm" icon={<Plus size={14} />} onClick={add}>
            {t('story.lines.add')}
          </Button>
          <Switch
            label={t('story.lines.expanded')}
            checked={node.expanded === true}
            onChange={(on) => edit(t(on ? 'story.step.unfold' : 'story.step.fold'), (g) => setExpanded(g, node.id, on))}
          />
        </div>
      )}
    </Section>
  );
}

const LineRow = memo(function LineRow({
  line,
  index,
  last,
  nodeId,
  maxChars,
  characters,
  entities,
  readOnly,
}: {
  line: DialogueLine;
  index: number;
  last: boolean;
  nodeId: string;
  maxChars: number;
  characters: WorldEntity[];
  entities: ProjectData['entities'];
  readOnly: boolean;
}) {
  const { edit } = useStory();
  const chars = [...line.text].length;
  const unknownSpeaker = line.speaker && !entities[line.speaker];
  return (
    <div className="iline" data-line={line.id}>
      <div className="iline-head">
        <select
          className="input iline-speaker"
          value={line.speaker ?? ''}
          disabled={readOnly}
          aria-label={t('story.lines.speaker')}
          onChange={(e) =>
            edit(t('story.step.lines'), (g) => updateLine(g, nodeId, line.id, { speaker: e.target.value || null }))
          }
        >
          <option value="">{t('story.narrator')}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t('story.untitled')}
            </option>
          ))}
          {unknownSpeaker && <option value={line.speaker!}>{t('story.lines.deletedSpeaker')}</option>}
        </select>
        <span className={['small', chars > maxChars ? 'text-warning' : 'muted'].join(' ')}>
          {t('story.lines.chars', { count: chars, max: maxChars })}
        </span>
        {!readOnly && (
          <span className="iline-tools">
            <IconButton
              size="sm"
              label={t('story.up')}
              icon={<ArrowUp size={14} />}
              disabled={index === 0}
              onClick={() => edit(t('story.step.lines'), (g) => moveLine(g, nodeId, index, index - 1))}
            />
            <IconButton
              size="sm"
              label={t('story.down')}
              icon={<ArrowDown size={14} />}
              disabled={last}
              onClick={() => edit(t('story.step.lines'), (g) => moveLine(g, nodeId, index, index + 1))}
            />
            <IconButton
              size="sm"
              label={t('story.lines.remove')}
              icon={<Trash size={14} />}
              onClick={() => edit(t('story.step.lines'), (g) => removeLine(g, nodeId, line.id))}
            />
          </span>
        )}
      </div>
      <textarea
        className={['input', 'iline-text', chars > maxChars && 'iline-over'].filter(Boolean).join(' ')}
        value={line.text}
        rows={1}
        readOnly={readOnly}
        aria-label={t('story.lines.text', { n: index + 1 })}
        onChange={(e) =>
          edit(
            t('story.step.lines'),
            (g) => updateLine(g, nodeId, line.id, { text: e.target.value }),
            `line:${line.id}`,
          )
        }
      />
    </div>
  );
});

// ---------- choice ----------

function ChoiceSection({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const readOnly = project.readOnly;
  const options = node.options ?? [];
  return (
    <Section title={t('story.options')} field="options">
      {options.map((o, i) => (
        <div key={o.id} className="ioption" data-field={`option:${o.id}`}>
          <div className="iline-head">
            <span className="ioption-n">{i + 1}</span>
            <input
              className="input ioption-text"
              value={o.text}
              readOnly={readOnly}
              placeholder={t('story.optionPlaceholder', { n: i + 1 })}
              aria-label={t('story.options.text', { n: i + 1 })}
              onChange={(e) =>
                edit(
                  t('story.step.options'),
                  (g) => updateOption(g, node.id, o.id, { text: e.target.value }),
                  `option:${o.id}`,
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
                  onClick={() => edit(t('story.step.options'), (g) => moveOption(g, node.id, i, i - 1))}
                />
                <IconButton
                  size="sm"
                  label={t('story.down')}
                  icon={<ArrowDown size={14} />}
                  disabled={i === options.length - 1}
                  onClick={() => edit(t('story.step.options'), (g) => moveOption(g, node.id, i, i + 1))}
                />
                <IconButton
                  size="sm"
                  label={t('story.options.remove')}
                  icon={<Trash size={14} />}
                  onClick={() => edit(t('story.step.options'), (g) => removeOption(g, node.id, o.id))}
                />
              </span>
            )}
          </div>
          <ExpressionField
            label={t('story.options.condition')}
            kind="condition"
            field={`option:${o.id}:condition`}
            value={o.condition}
            readOnly={readOnly}
            onChange={(condition) =>
              edit(t('story.step.condition'), (g) => updateOption(g, node.id, o.id, { condition }), `cond:${o.id}`)
            }
          />
          <ExpressionField
            label={t('story.options.effects')}
            kind="effects"
            field={`option:${o.id}:effects`}
            value={o.effects}
            readOnly={readOnly}
            onChange={(effects) =>
              edit(t('story.step.effects'), (g) => updateOption(g, node.id, o.id, { effects }), `eff:${o.id}`)
            }
          />
        </div>
      ))}
      {!readOnly && (
        <Button
          size="sm"
          icon={<Plus size={14} />}
          onClick={() =>
            edit(t('story.step.options'), (g) => {
              addOption(g, node.id);
            })
          }
        >
          {t('story.options.add')}
        </Button>
      )}
    </Section>
  );
}

// ---------- links (butterfly consequences, gun payoffs) ----------

function LinkRow({ link, onRemove, readOnly }: { link: NodeRef; onRemove: () => void; readOnly: boolean }) {
  const { project, show } = useStory();
  const label = useStore(project.store, (s) => {
    const target = findNode(s, link);
    return target ? `${graphTitle(s, link.graph)} › ${target.title || t('story.untitled')}` : '';
  });
  return (
    <div className="ilink">
      <span className={label ? '' : 'text-warning'}>{label || t('story.card.deleted')}</span>
      {label && (
        <IconButton size="sm" label={t('story.link.go')} icon={<ArrowRight size={14} />} onClick={() => show(link)} />
      )}
      {!readOnly && <IconButton size="sm" label={t('story.link.remove')} icon={<X size={14} />} onClick={onRemove} />}
    </div>
  );
}

function LinksSection({ node, title, add }: { node: StoryNode; title: string; add: string }) {
  const { project, graphId, edit } = useStory();
  const [picking, setPicking] = useState(false);
  const links = node.links ?? [];
  return (
    <Section title={title} field="links">
      {links.map((link) => (
        <LinkRow
          key={refKey(link)}
          link={link}
          readOnly={project.readOnly}
          onRemove={() => edit(t('story.step.link'), (g) => removeLink(g, node.id, link))}
        />
      ))}
      {!project.readOnly && (
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setPicking(true)}>
          {add}
        </Button>
      )}
      {picking && (
        <NodePicker
          title={add}
          exclude={{ graph: graphId, node: node.id }}
          onPick={(ref) => edit(t('story.step.link'), (g) => addLink(g, node.id, ref))}
          onClose={() => setPicking(false)}
        />
      )}
    </Section>
  );
}

function JumpSection({ node }: { node: StoryNode }) {
  const { project, graphId, edit } = useStory();
  const [picking, setPicking] = useState(false);
  return (
    <Section title={t('story.jump.target')} field="target">
      {node.target ? (
        <LinkRow
          link={node.target}
          readOnly={project.readOnly}
          onRemove={() => edit(t('story.step.target'), (g) => setNodeProps(g, [node.id], { target: null }))}
        />
      ) : (
        <p className="muted small">{t('story.card.noTarget')}</p>
      )}
      {!project.readOnly && (
        <Button size="sm" onClick={() => setPicking(true)}>
          {t('story.jump.pick')}
        </Button>
      )}
      {picking && (
        <NodePicker
          title={t('story.jump.target')}
          exclude={{ graph: graphId, node: node.id }}
          onPick={(target) => edit(t('story.step.target'), (g) => setNodeProps(g, [node.id], { target }))}
          onClose={() => setPicking(false)}
        />
      )}
    </Section>
  );
}

function ChapterImage({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const pick = async () => {
    const source = await platform().pickFile(t('story.chapter.pickImage'), IMAGE_FILTERS);
    if (!source) return;
    try {
      const path = await platform().importFile(project.dir, source, 'assets/chapters');
      edit(t('story.step.image'), (g) => setNodeProps(g, [node.id], { image: path }));
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };
  if (project.readOnly) return null;
  return (
    <Section title={t('story.chapter.image')} field="image">
      <div className="insp-actions">
        <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => void pick()}>
          {t('story.chapter.pickImage')}
        </Button>
        {node.image && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => edit(t('story.step.image'), (g) => setNodeProps(g, [node.id], { image: null }))}
          >
            {t('story.chapter.removeImage')}
          </Button>
        )}
      </div>
    </Section>
  );
}

const NEW_ENTITY = '\u0000new';

function RefSection({ node, kind }: { node: StoryNode; kind: WorldKind }) {
  const { project, edit } = useStory();
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const entities = useStore(project.store, (s) => s.entities);
  const list = listEntities({ entities }, kind);
  const label = t(kindOf(kind).label);
  const create = () =>
    setPrompt({
      title: t('story.ref.newTitle', { kind: label }),
      label: t('story.ref.newName'),
      value: '',
      onSubmit: (name) => {
        const entity = newEntity(project.store.getState(), kind, name);
        edit(t('story.step.ref'), (g, d) => {
          d.entities[entity.id] = entity;
          const n = storyNode(g, node.id);
          if (n) {
            n.ref = entity.id;
            if (!n.title || n.title === label) n.title = entity.name;
          }
        });
      },
    });
  return (
    <div data-field="ref">
      <SelectField
        label={label}
        value={node.ref ?? ''}
        disabled={project.readOnly}
        options={[
          { value: '', label: t('story.ref.none') },
          ...list.map((e) => ({ value: e.id, label: e.name || t('story.untitled') })),
          { value: NEW_ENTITY, label: t('story.ref.new') },
        ]}
        onChange={(value) => {
          if (value === NEW_ENTITY) return create();
          const entity = list.find((e) => e.id === value);
          edit(t('story.step.ref'), (g) => {
            const n = storyNode(g, node.id);
            if (!n) return;
            n.ref = value || null;
            if (entity && (!n.title || n.title === label)) n.title = entity.name;
          });
        }}
        hint={t('story.ref.hint')}
      />
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

function PlotRole({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const set = (role: 'consequence' | 'payoff', on: boolean) =>
    edit(t('story.step.plot'), (g) => setNodeProps(g, [node.id], { plotRole: on ? role : null }));
  return (
    <Section title={t('story.plot')} field="plot">
      <Switch
        label={t('story.plot.consequence')}
        checked={node.plotRole === 'consequence'}
        disabled={project.readOnly}
        onChange={(on) => set('consequence', on)}
      />
      <Switch
        label={t('story.plot.payoff')}
        checked={node.plotRole === 'payoff'}
        disabled={project.readOnly}
        onChange={(on) => set('payoff', on)}
      />
    </Section>
  );
}

// ---------- edge and graph ----------

function EdgeInspector({ edge, graph }: { edge: GraphEdge; graph: GraphDoc }) {
  const { project, edit } = useStory();
  const from = graph.nodes.find((n) => n.id === edge.from.node);
  const to = graph.nodes.find((n) => n.id === edge.to.node);
  const set = (key: 'label' | 'condition', value: string, label: string) =>
    edit(
      label,
      (g) => {
        const e = g.edges.find((x) => x.id === edge.id);
        if (e) e[key] = value;
      },
      `${key}:${edge.id}`,
    );
  return (
    <>
      <header className="insp-title">
        <span>{t('story.edge')}</span>
      </header>
      <p className="muted small">
        {t('story.edge.fromTo', { from: from?.title || t('story.untitled'), to: to?.title || t('story.untitled') })}
      </p>
      <TextField
        label={t('story.edge.label')}
        value={edge.label ?? ''}
        disabled={project.readOnly}
        data-field="label"
        onChange={(e) => set('label', e.target.value, t('canvas.step.style'))}
      />
      <ExpressionField
        label={t('story.edge.condition')}
        kind="condition"
        field="condition"
        value={edge.condition ?? ''}
        readOnly={project.readOnly}
        onChange={(v) => set('condition', v, t('story.step.condition'))}
      />
      <p className="muted small">{t('story.edge.conditionHint')}</p>
    </>
  );
}

function GraphInspector({ graph }: { graph: GraphDoc }) {
  const { project } = useStory();
  const title = useStore(project.store, (s) => graphTitle(s, graph.id));
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  return (
    <>
      <header className="insp-title">
        <span>{title || t('module.story')}</span>
      </header>
      <p className="muted small">{t('story.inspector.nothing')}</p>
      <ul className="insp-counts">
        {[...counts].map(([kind, count]) => (
          <li key={kind}>
            <KindIcon kind={kind} size={14} />
            <span>{t(kindOf(kind).label)}</span>
            <span className="muted">{count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
