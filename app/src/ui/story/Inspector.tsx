import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  ImagePlus,
  Plus,
  Sparkles,
  Trash,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import { kindOf } from '../../canvas/kinds';
import type { GraphDoc, GraphEdge } from '../../canvas/model';
import { setNodeProps } from '../../canvas/ops';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { openEntity } from '../../state/navigation';
import { listEntities, newEntity, type WorldEntity } from '../../story/entities';
import { graphTitle, refKey } from '../../story/flow';
import { addMark, linkMark, markLabel, removeMark, unlinkMark, updateMark } from '../../story/marks';
import {
  asStory,
  findNode,
  graphOf,
  type DialogueLine,
  type MarkAnchor,
  type NodeRef,
  type PlotDevice,
  type PlotMark,
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
  setNodeText,
  storyNode,
  updateLine,
  updateOption,
} from '../../story/ops';
import { knownNames } from '../../story/usage';
import { fullName, registryFor } from '../../story/variables';
import { Button, IconButton, Menu, SelectField, Switch, TextArea, TextField, toast } from '../components';
import { errorText } from '../errors';
import { DeviceIcon, KindIcon } from '../canvas/kindIcons';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { IMAGE_FILTERS } from '../start/filters';
import { useStory } from './context';
import { ExpressionField } from './ExpressionField';
import { MarkedTextArea, textHighlights, useTextMenu } from './MarkedText';
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
      const fields = 'textarea, input, select, button';
      (box?.matches(fields) ? box : box?.querySelector<HTMLElement>(fields))?.focus();
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
      {hasText && <NodeText node={node} label={textLabel} />}
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
      {!['gun', 'butterfly', 'start'].includes(node.kind) && <MarksSection node={node} />}
      <NoteField
        label={t('canvas.comment')}
        field="comment"
        value={node.comment ?? ''}
        rows={2}
        onChange={(comment) => set('comment', { comment }, t('canvas.step.comment'))}
      />
      <p className="muted small">{t('story.textEffects.hint')}</p>
    </>
  );
}

// ---------- dialogue ----------

function DialogueSection({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const readOnly = project.readOnly;
  const limits = useStore(project.store, (s) => s.meta.settings.dialogueLimits);
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  const characters = listEntities({ entities, types }, 'character');
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
          node={node}
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

function LineRow({
  line,
  index,
  last,
  node,
  maxChars,
  characters,
  entities,
  readOnly,
}: {
  line: DialogueLine;
  index: number;
  last: boolean;
  node: StoryNode;
  maxChars: number;
  characters: WorldEntity[];
  entities: ProjectData['entities'];
  readOnly: boolean;
}) {
  const { edit } = useStory();
  const nodeId = node.id;
  const anchor: MarkAnchor = { kind: 'line', id: line.id };
  const addDevice = useAddDevice(node.id);
  const menu = useTextMenu({ readOnly, onDevice: (device, sel) => addDevice(device, anchor, sel) });
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
            <DeviceMenu onDevice={(device) => addDevice(device, anchor)} />
            <IconButton
              size="sm"
              label={t('story.lines.remove')}
              icon={<Trash size={14} />}
              onClick={() => edit(t('story.step.lines'), (g) => removeLine(g, nodeId, line.id))}
            />
          </span>
        )}
      </div>
      <MarkedTextArea
        className={['iline-text', chars > maxChars && 'iline-over'].filter(Boolean).join(' ')}
        value={line.text}
        highlights={textHighlights(line.text, node, anchor)}
        rows={1}
        readOnly={readOnly}
        aria-label={t('story.lines.text', { n: index + 1 })}
        onContextMenu={menu.onContextMenu}
        onChange={(e) =>
          edit(
            t('story.step.lines'),
            (g) => updateLine(g, nodeId, line.id, { text: e.target.value }),
            `line:${line.id}`,
          )
        }
      />
      {menu.menu}
    </div>
  );
}

// ---------- choice ----------

function ChoiceSection({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const readOnly = project.readOnly;
  const options = node.options ?? [];
  return (
    <Section title={t('story.options')} field="options">
      {options.map((o, i) => (
        <OptionRow key={o.id} node={node} index={i} />
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

// ---------- text with effects and plot devices ----------

/** Names that are variables as seen from the graph on the canvas (effects written without braces). */
function useKnown(): (name: string) => boolean {
  const { project, graphId } = useStory();
  const data = useStore(project.store, (s) => s);
  return knownNames(data, graphId);
}

/** Lays a plot device over a node, option, line or words; the inspector then shows the new mark. */
function useAddDevice(nodeId: string) {
  const { edit, inspect } = useStory();
  return (device: PlotDevice, anchor: MarkAnchor, selection: { start: number; end: number } | null = null) => {
    let id: string | null = null;
    edit(t(device === 'gun' ? 'plot.step.gun' : 'plot.step.butterfly'), (g) => {
      const n = storyNode(g, nodeId);
      if (n) id = addMark(n, device, anchor, selection)?.id ?? null;
    });
    if (id) inspect(nodeId, `mark:${id}`);
  };
}

/** A small menu button: lay Chekhov's gun or the butterfly effect over this option or line. */
function DeviceMenu({ onDevice }: { onDevice: (device: PlotDevice) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  return (
    <>
      <IconButton
        size="sm"
        label={t('plot.add')}
        icon={<Sparkles size={14} />}
        aria-haspopup="menu"
        onClick={(e) => {
          const anchor = e.currentTarget;
          const r = anchor.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 4, anchor });
        }}
      />
      {at && (
        <Menu
          x={at.x}
          y={at.y}
          anchor={at.anchor}
          label={t('plot.add')}
          onClose={() => setAt(null)}
          entries={[
            { id: 'gun', label: t('plot.gun'), icon: <DeviceIcon device="gun" />, onSelect: () => onDevice('gun') },
            {
              id: 'butterfly',
              label: t('plot.butterfly'),
              icon: <DeviceIcon device="butterfly" />,
              onSelect: () => onDevice('butterfly'),
            },
          ]}
        />
      )}
    </>
  );
}

/** The node's own text: marked words are highlighted, and selected words can carry a plot device. */
function NodeText({ node, label }: { node: StoryNode; label: string }) {
  const { project, edit } = useStory();
  const id = useId();
  const known = useKnown();
  const addDevice = useAddDevice(node.id);
  const anchor: MarkAnchor = { kind: 'node' };
  const menu = useTextMenu({ readOnly: project.readOnly, onDevice: (d, sel) => addDevice(d, anchor, sel) });
  const value = node.text ?? '';
  return (
    <div className="field" data-field="text">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <MarkedTextArea
        id={id}
        className="mtext-tall"
        value={value}
        highlights={textHighlights(value, node, anchor, known)}
        rows={3}
        readOnly={project.readOnly}
        onContextMenu={menu.onContextMenu}
        onChange={(e) => edit(t('canvas.step.text'), (g) => setNodeText(g, node.id, e.target.value), `text:${node.id}`)}
      />
      {menu.menu}
    </div>
  );
}

/** A comment (of a node or an option): effects written in it are highlighted. */
function NoteField({
  label,
  field,
  value,
  rows,
  onChange,
}: {
  label: string;
  field: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  const { project } = useStory();
  const id = useId();
  const known = useKnown();
  const menu = useTextMenu({ readOnly: project.readOnly });
  return (
    <div className="field" data-field={field}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <MarkedTextArea
        id={id}
        value={value}
        highlights={textHighlights(value, undefined, undefined, known)}
        rows={rows}
        readOnly={project.readOnly}
        onContextMenu={menu.onContextMenu}
        onChange={(e) => onChange(e.target.value)}
      />
      {menu.menu}
    </div>
  );
}

function OptionRow({ node, index: i }: { node: StoryNode; index: number }) {
  const { project, edit } = useStory();
  const readOnly = project.readOnly;
  const options = node.options ?? [];
  const o = options[i];
  const anchor: MarkAnchor = { kind: 'option', id: o.id };
  const addDevice = useAddDevice(node.id);
  const menu = useTextMenu({ readOnly, onDevice: (d, sel) => addDevice(d, anchor, sel) });
  return (
    <div className="ioption" data-field={`option:${o.id}`}>
      <div className="iline-head">
        <span className="ioption-n">{i + 1}</span>
        <MarkedTextArea
          className="ioption-text"
          singleLine
          value={o.text}
          highlights={textHighlights(o.text, node, anchor)}
          rows={1}
          readOnly={readOnly}
          placeholder={t('story.optionPlaceholder', { n: i + 1 })}
          aria-label={t('story.options.text', { n: i + 1 })}
          onContextMenu={menu.onContextMenu}
          onChange={(e) =>
            edit(
              t('story.step.options'),
              (g) => updateOption(g, node.id, o.id, { text: e.target.value.replace(/\n/g, ' ') }),
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
            <DeviceMenu onDevice={(device) => addDevice(device, anchor)} />
            <IconButton
              size="sm"
              label={t('story.options.remove')}
              icon={<Trash size={14} />}
              onClick={() => edit(t('story.step.options'), (g) => removeOption(g, node.id, o.id))}
            />
          </span>
        )}
      </div>
      {menu.menu}
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
      <NoteField
        label={t('story.options.note')}
        field={`option:${o.id}:note`}
        value={o.note ?? ''}
        rows={1}
        onChange={(note) =>
          edit(t('story.step.options'), (g) => updateOption(g, node.id, o.id, { note }), `note:${o.id}`)
        }
      />
    </div>
  );
}

// ---------- plot devices laid over the node ----------

/** Where a mark sits, for its heading: "Line 2", "Option 1", "Whole node". */
function anchorName(node: StoryNode, m: PlotMark): string {
  if (m.anchor.kind === 'line') {
    const id = m.anchor.id;
    return t('plot.onLine', { n: (node.lines ?? []).findIndex((l) => l.id === id) + 1 });
  }
  if (m.anchor.kind === 'option') {
    const id = m.anchor.id;
    return t('plot.onOption', { n: (node.options ?? []).findIndex((o) => o.id === id) + 1 });
  }
  return m.range ? t('plot.onText') : t('plot.onNode');
}

function MarksSection({ node }: { node: StoryNode }) {
  const { project } = useStory();
  const addDevice = useAddDevice(node.id);
  const marks = node.marks ?? [];
  return (
    <Section title={t('story.plot')} field="plot">
      {marks.length === 0 && <p className="muted small">{t('plot.hint')}</p>}
      {marks.map((m) => (
        <MarkRow key={m.id} node={node} mark={m} />
      ))}
      {!project.readOnly && (
        <div className="insp-actions">
          <Button
            size="sm"
            icon={<DeviceIcon device="gun" size={14} />}
            onClick={() => addDevice('gun', { kind: 'node' })}
          >
            {t('plot.gun')}
          </Button>
          <Button
            size="sm"
            icon={<DeviceIcon device="butterfly" size={14} />}
            onClick={() => addDevice('butterfly', { kind: 'node' })}
          >
            {t('plot.butterfly')}
          </Button>
        </div>
      )}
      {node.kind !== 'chapter' && <PlotRole node={node} />}
    </Section>
  );
}

function MarkRow({ node, mark: m }: { node: StoryNode; mark: PlotMark }) {
  const { project, graphId, edit } = useStory();
  const [picking, setPicking] = useState(false);
  const readOnly = project.readOnly;
  const gun = m.device === 'gun';
  const change = (recipe: (n: StoryNode) => void, mergeKey?: string) =>
    edit(
      t('story.step.link'),
      (g) => {
        const n = storyNode(g, node.id);
        if (n) recipe(n);
      },
      mergeKey,
    );
  const add = t(gun ? 'story.payoffs.add' : 'story.consequences.add');
  return (
    <div className={`imark imark-${m.device}`} data-field={`mark:${m.id}`}>
      <div className="imark-head">
        <DeviceIcon device={m.device} size={16} />
        <span className="imark-title">
          <strong>{t(gun ? 'plot.gun' : 'plot.butterfly')}</strong>
          <span className="muted small">
            {anchorName(node, m)} · «{markLabel(node, m) || t('story.untitled')}»
          </span>
        </span>
        {!readOnly && (
          <IconButton
            size="sm"
            label={t('plot.remove')}
            icon={<Trash size={14} />}
            onClick={() => change((n) => removeMark(n, m.id))}
          />
        )}
      </div>
      <div className="imark-links">
        <span className="small muted">{t(gun ? 'story.payoffs' : 'story.consequences')}</span>
        {m.links.map((link) => (
          <LinkRow
            key={refKey(link)}
            link={link}
            readOnly={readOnly}
            onRemove={() => change((n) => unlinkMark(n, m.id, link))}
          />
        ))}
        {m.links.length === 0 && <p className="muted small">{t('plot.dragHint')}</p>}
        {!readOnly && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setPicking(true)}>
            {add}
          </Button>
        )}
      </div>
      {!gun && <MarkVariables node={node} mark={m} readOnly={readOnly} />}
      <TextArea
        label={t('plot.note')}
        value={m.note}
        rows={1}
        disabled={readOnly}
        onChange={(e) => change((n) => updateMark(n, m.id, { note: e.target.value }), `mark-note:${m.id}`)}
      />
      {picking && (
        <NodePicker
          title={add}
          exclude={{ graph: graphId, node: node.id }}
          onPick={(ref) => change((n) => linkMark(n, m.id, ref))}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** Butterfly: the variables its consequences depend on (optional), chosen from those seen here. */
function MarkVariables({ node, mark: m, readOnly }: { node: StoryNode; mark: PlotMark; readOnly: boolean }) {
  const { project, graphId, edit } = useStory();
  const data = useStore(project.store, (s) => s);
  const visible = [...registryFor(data, graphId).values()].map((e) => e.variable);
  const byId = new Map(visible.map((v) => [v.id, v]));
  const set = (variables: string[]) =>
    edit(t('plot.step.variables'), (g) => {
      const n = storyNode(g, node.id);
      if (n) updateMark(n, m.id, { variables });
    });
  const rest = visible.filter((v) => !m.variables.includes(v.id));
  return (
    <div className="imark-vars">
      <span className="small muted">{t('plot.variables')}</span>
      <div className="imark-chips">
        {m.variables.map((id) => {
          const v = byId.get(id);
          return (
            <span key={id} className={['chip', !v && 'text-warning'].filter(Boolean).join(' ')}>
              {v ? fullName(v, data) : t('plot.variableGone')}
              {!readOnly && (
                <button
                  type="button"
                  className="chip-x"
                  aria-label={t('plot.variableRemove')}
                  onClick={() => set(m.variables.filter((x) => x !== id))}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          );
        })}
        {!readOnly && rest.length > 0 && (
          <select
            className="input imark-add"
            value=""
            aria-label={t('plot.variableAdd')}
            onChange={(e) => e.target.value && set([...m.variables, e.target.value])}
          >
            <option value="">{t('plot.variableAdd')}</option>
            {rest.map((v) => (
              <option key={v.id} value={v.id}>
                {fullName(v, data)}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
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
  const types = useStore(project.store, (s) => s.types);
  const list = listEntities({ entities, types }, kind);
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
      {node.ref && entities[node.ref] && (
        <Button size="sm" variant="ghost" icon={<ArrowUpRight size={14} />} onClick={() => openEntity(node.ref!)}>
          {t('story.ref.open')}
        </Button>
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

/** The node is where a gun fires or a butterfly lands, even before anything points at it (for checks). */
function PlotRole({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const set = (role: 'consequence' | 'payoff', on: boolean) =>
    edit(t('story.step.plot'), (g) => setNodeProps(g, [node.id], { plotRole: on ? role : null }));
  return (
    <div className="imark-role">
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
    </div>
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
