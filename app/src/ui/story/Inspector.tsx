import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ClipboardCopy,
  EyeOff,
  FileText,
  ImagePlus,
  ListChecks,
  Maximize2,
  MessagesSquare,
  Play,
  Plus,
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
import { getLocale, t, type MessageKey } from '../../i18n';
import { platform } from '../../platform';
import { openEntity } from '../../state/navigation';
import { listEntities, newEntity } from '../../story/entities';
import { graphTitle, refKey } from '../../story/flow';
import {
  allSources,
  deviceOf,
  linkMark,
  linkSource,
  markLabel,
  removeMark,
  rolesOf,
  setRole,
  unlinkAllTo,
  unlinkMark,
  updateMark,
  type PlotSource,
} from '../../story/marks';
import {
  asStory,
  findNode,
  graphOf,
  plotMarks,
  type MarkAnchor,
  type NodeRef,
  type PlotMark,
  type PlotRole as Role,
  type StoryNode,
  type WorldKind,
} from '../../story/model';
import {
  addLine,
  addLink,
  addOption,
  editActions,
  removeLink,
  setExpanded,
  setNodeFields,
  setNodeText,
  storyNode,
} from '../../story/ops';
import { fullName, registryFor } from '../../story/variables';
import { graphKey, keyOf } from '../../story/gameKey';
import { visibleLength, visibleText } from '../../story/game';
import { NARRATOR, paletteSpeaker } from '../../story/palette';
import { speakerName } from './lineLook';
import { gameFiles } from '../../state/gameFiles';
import { graphTransfer, nodeTransfer } from '../../story/transfer';
import { listVariables } from '../../story/variables';
import {
  Button,
  IconButton,
  Menu,
  SelectField,
  Switch,
  TextArea,
  TextField,
  toast,
  type MenuEntry,
} from '../components';
import { errorText } from '../errors';
import { DeviceIcon, KindIcon, LandingIcon } from '../canvas/kindIcons';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { IMAGE_FILTERS } from '../start/filters';
import { useStory } from './context';
import { ExpressionField } from './ExpressionField';
import { NoteField, useKnown } from './NoteField';
import { ActionsEditor, GameKeyField, NumberBlank } from './game';
import { MarkedTextArea, textHighlights, useTextMenu } from './MarkedText';
import { NodePicker } from './NodePicker';
import { useAddDevice } from './plotTools';
import { TransferBadge } from './TransferBadge';
import { TypingPreview } from './TypingPreview';

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
  const { project, graphId, edit, openChapter, task } = useStory();
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
  const hasText = !['start', 'condition', 'effect', 'jump', 'dialogue', 'give'].includes(node.kind);
  const { status } = useAtom(gameFiles);
  // The name is a plain value (a selector must not make a new object on every call); the status follows it.
  const named = useStore(project.store, (s) => !!graphKey(graphOf(s, graphId)));
  const transfer = named ? nodeTransfer(node, status[graphId]) : null;

  return (
    <>
      <header className="insp-title">
        <span className="insp-kind" style={{ background: kind.color }}>
          <KindIcon kind={node.kind} size={14} />
        </span>
        <span>{t(kind.label)}</span>
        {transfer && <TransferBadge state={transfer.state} problems={transfer.problems.map((p) => p.text)} />}
      </header>
      <TextField
        label={t(node.kind === 'give' ? 'give.title' : 'story.inspector.title')}
        hint={node.kind === 'give' ? t('give.titleHint') : undefined}
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
      {node.kind === 'barks' && (
        <>
          <Button icon={<MessagesSquare size={16} />} onClick={() => openChapter(node.id)}>
            {t('barks.open')}
          </Button>
          <p className="muted small">{t('barks.hint')}</p>
        </>
      )}
      {node.kind === 'dialogue' && node.when !== undefined && (
        <TextField
          label={t('barks.when')}
          hint={t('barks.whenHint')}
          value={node.when}
          disabled={readOnly}
          data-field="when"
          onChange={(e) => set('when', { when: e.target.value })}
        />
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
      {node.kind === 'give' && <GiveSection node={node} />}
      {(node.kind === 'effect' || node.kind === 'butterfly' || node.kind === 'give') && (
        <ExpressionField
          label={t(node.kind === 'give' ? 'give.effects' : 'story.effects')}
          kind="effects"
          field="effects"
          value={node.effects ?? ''}
          readOnly={readOnly}
          onChange={(effects) => set('effects', { effects }, t('story.step.effects'))}
        />
      )}
      {(node.kind === 'effect' || node.kind === 'give') && <NodeActions node={node} />}
      {node.kind === 'butterfly' && (
        <LinksSection node={node} title={t('story.consequences')} add={t('story.consequences.add')} />
      )}
      {node.kind === 'gun' && <LinksSection node={node} title={t('story.payoffs')} add={t('story.payoffs.add')} />}
      {node.kind === 'jump' && <JumpSection node={node} />}
      {node.kind === 'chapter' && <ChapterImage node={node} />}
      {(node.kind === 'character' || node.kind === 'location' || node.kind === 'item') && (
        <RefSection node={node} kind={node.kind} />
      )}
      {!['gun', 'butterfly', 'start', 'barks'].includes(node.kind) && node.when === undefined && (
        <MarksSection node={node} />
      )}
      <NoteField
        label={t('canvas.comment')}
        field="comment"
        value={node.comment ?? ''}
        rows={2}
        onChange={(comment) => set('comment', { comment }, t('canvas.step.comment'))}
      />
      <p className="muted small">{t('story.textEffects.hint')}</p>
      {['dialogue', 'choice', 'give'].includes(node.kind) && (
        <button type="button" className="entity-link small" onClick={() => task({ node: node.id })}>
          <ClipboardCopy size={12} /> {t('task.node')}
        </button>
      )}
    </>
  );
}

/** Game actions of an effect or give node (0.8). */
function NodeActions({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const data = useStore(project.store, (s) => s);
  return (
    <Section title={t('action.title')} field="actions">
      <ActionsEditor
        actions={node.actions}
        data={data}
        disabled={project.readOnly}
        onChange={(actions) =>
          edit(t('action.step'), (g) => {
            const n = storyNode(g, node.id);
            if (n) editActions(n, (list) => list.splice(0, list.length, ...actions));
          })
        }
      />
    </Section>
  );
}

/** "Give an item" (0.8): where the game writes what was given. */
function GiveSection({ node }: { node: StoryNode }) {
  const { project, edit } = useStory();
  const variables = useStore(project.store, (s) => s.variables);
  const all = listVariables({ variables } as ProjectData);
  const pick = (key: 'store' | 'keep', label: string, hint: string, list: typeof all) => {
    const value = node[key] ?? '';
    return (
      <SelectField
        label={label}
        hint={hint}
        value={value}
        disabled={project.readOnly}
        options={[
          { value: '', label: t('give.none') },
          ...list.map((v) => ({ value: v.id, label: v.name })),
          ...(value && !list.some((v) => v.id === value) ? [{ value, label: t('plot.variableGone') }] : []),
        ]}
        onChange={(id) => edit(t('story.step.edit'), (g) => setNodeFields(g, node.id, { [key]: id || null }))}
      />
    );
  };
  return (
    <div data-field="give">
      {pick(
        'store',
        t('give.store'),
        t('give.storeHint'),
        all.filter((v) => v.type === 'entity' || v.type === 'string'),
      )}
      {pick(
        'keep',
        t('give.keep'),
        t('give.keepHint'),
        all.filter((v) => v.type === 'list'),
      )}
      <p className="muted small">{t('give.exits')}</p>
    </div>
  );
}

// ---------- dialogue ----------

function DialogueSection({ node }: { node: StoryNode }) {
  const { project, edit, openLine } = useStory();
  const readOnly = project.readOnly;
  const limits = useStore(project.store, (s) => s.meta.settings.dialogueLimits);
  const entities = useStore(project.store, (s) => s.entities);
  const { palette } = useAtom(gameFiles);
  const lines = node.lines ?? [];
  const over = lines.length > limits.maxLines;
  const [previewing, setPreviewing] = useState(false);
  const add = () => {
    let id: string | null = null;
    // A new line goes to the other speaker of the last two lines: dialogues alternate.
    const speaker = lines.length >= 2 ? lines[lines.length - 2].speaker : null;
    edit(t('story.step.lines'), (g) => {
      id = addLine(g, node.id, { speaker });
    });
    // It is written in the window of a line (0.8.3).
    if (id) openLine(node.id, id);
  };
  return (
    <Section title={t('story.lines')} field="lines">
      <p className={['small', over ? 'text-warning' : 'muted'].join(' ')}>
        {t('story.lines.count', { count: lines.length, max: limits.maxLines })}
        {over && ` ${t('story.lines.over')}`}
      </p>
      {/* 0.8.3, the owner's wish: a line is edited only in its window; here, the list to open it from. */}
      <ol className="ilines">
        {lines.map((line, i) => {
          const card = line.speaker && line.speaker !== NARRATOR ? entities[line.speaker] : undefined;
          const color = card ? paletteSpeaker(palette, keyOf(card))?.color : undefined;
          const long = visibleLength(line.text) > limits.maxLineChars;
          return (
            <li key={line.id}>
              <button
                type="button"
                className={['iline-open', !line.speaker && 'iline-nobody', long && 'iline-over']
                  .filter(Boolean)
                  .join(' ')}
                data-line={line.id}
                aria-label={t('lines.open', { n: i + 1 })}
                style={color ? { borderLeftColor: color } : undefined}
                onClick={() => openLine(node.id, line.id)}
              >
                <span
                  className={['iline-open-who', !line.speaker && 'iline-open-nobody'].filter(Boolean).join(' ')}
                  style={color ? { color } : undefined}
                >
                  {speakerName(entities, line.speaker)}
                </span>
                <span className="iline-open-text">{visibleText(line.text) || '…'}</span>
                <Maximize2 size={13} aria-hidden="true" className="iline-open-icon" />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small">{t('lines.hint')}</p>
      {!readOnly && (
        <div className="insp-actions">
          <Button size="sm" icon={<Plus size={14} />} onClick={add}>
            {t('story.lines.add')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Play size={14} />}
            disabled={!lines.some((l) => l.text.trim())}
            onClick={() => setPreviewing(true)}
          >
            {t('preview.lines')}
          </Button>
          <Switch
            label={t('story.lines.expanded')}
            checked={node.expanded === true}
            onChange={(on) => edit(t(on ? 'story.step.unfold' : 'story.step.fold'), (g) => setExpanded(g, node.id, on))}
          />
        </div>
      )}
      {readOnly && lines.some((l) => l.text.trim()) && (
        <Button size="sm" variant="ghost" icon={<Play size={14} />} onClick={() => setPreviewing(true)}>
          {t('preview.lines')}
        </Button>
      )}
      {previewing && <TypingPreview node={node} start={0} entities={entities} onClose={() => setPreviewing(false)} />}
    </Section>
  );
}

// ---------- choice ----------

function ChoiceSection({ node }: { node: StoryNode }) {
  const { project, edit, openLine } = useStory();
  const entities = useStore(project.store, (s) => s.entities);
  const readOnly = project.readOnly;
  const options = node.options ?? [];
  return (
    <Section title={t('story.options')} field="options">
      <div className="iline-times">
        <NumberBlank
          label={t('choice.timer')}
          value={node.timer}
          placeholder={t('choice.timerBlank')}
          disabled={readOnly}
          onChange={(timer) =>
            edit(t('story.step.options'), (g) => setNodeFields(g, node.id, { timer }), `timer:${node.id}`)
          }
        />
        <Switch
          label={t('choice.checkpoint')}
          checked={node.checkpoint === true}
          disabled={readOnly}
          onChange={(on) => edit(t('story.step.options'), (g) => setNodeFields(g, node.id, { checkpoint: on }))}
        />
      </div>
      {options.some((o) => o.secret) && !node.timer && (
        <p className="text-warning small">{t('choice.secretNoTimer')}</p>
      )}
      {/* 0.8.5, the owner's wish: an option is edited as a line, in the window of a line; here, the list. */}
      <ol className="ilines">
        {options.map((o, i) => {
          const who = o.speaker === undefined ? null : o.speaker;
          return (
            <li key={o.id}>
              <button
                type="button"
                className="iline-open"
                data-option={o.id}
                aria-label={t('options.open', { n: i + 1 })}
                onClick={() => openLine(node.id, o.id, 'option')}
              >
                <span className="iline-open-who">{i + 1}.</span>
                {who !== null && o.speaker !== undefined && (
                  <span className="iline-open-who muted">{speakerName(entities, who)}</span>
                )}
                <span className="iline-open-text">{visibleText(o.text) || '…'}</span>
                {o.secret && <EyeOff size={13} aria-label={t('choice.secret')} />}
                {o.once && <span className="small muted">1×</span>}
                <Maximize2 size={13} aria-hidden="true" className="iline-open-icon" />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small">{t('options.hint')}</p>
      {!readOnly && (
        <Button
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => {
            let id: string | null = null;
            edit(t('story.step.options'), (g) => {
              id = addOption(g, node.id);
            });
            // It is written in the window, as a line is (0.8.5).
            if (id) openLine(node.id, id, 'option');
          }}
        >
          {t('story.options.add')}
        </Button>
      )}
    </Section>
  );
}

// ---------- text with effects and plot devices ----------

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
  const marks = plotMarks(node);
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

const ROLES: { role: Role; label: MessageKey; empty: MessageKey }[] = [
  { role: 'consequence', label: 'story.plot.consequence', empty: 'story.plot.noButterflies' },
  { role: 'payoff', label: 'story.plot.payoff', empty: 'story.plot.noGuns' },
];

/**
 * Where guns fire and butterflies land. A switch is on when a device already points here (or the node is
 * marked as waiting for one); turning it on links a device chosen from the project, turning it off removes
 * those links. A node can be both.
 */
function PlotRole({ node }: { node: StoryNode }) {
  const { project, graphId, edit, show } = useStory();
  const data = useStore(project.store, (s) => s);
  const [menu, setMenu] = useState<{ role: Role; x: number; y: number } | null>(null);
  const here = { graph: graphId, node: node.id };
  const lands = (src: PlotSource) => src.links.some((l) => l.graph === here.graph && l.node === here.node);
  const roles = rolesOf(node);
  const label = (src: PlotSource) => `${src.title || t('story.untitled')} · ${graphTitle(data, src.at.graph)}`;

  const turn = (role: Role, on: boolean, at: { x: number; y: number }) => {
    if (on) return setMenu({ role, ...at });
    edit(t('story.step.plot'), (g, d) => {
      const n = storyNode(g, node.id);
      if (n) setRole(n, role, false);
      unlinkAllTo(d, here, deviceOf(role));
    });
  };
  const entries = (role: Role): MenuEntry[] => {
    const sources = allSources(data, deviceOf(role)).filter((s) => !lands(s) && s.at.node !== node.id);
    return [
      ...sources.map((src, i) => ({
        id: `src-${i}`,
        label: label(src),
        icon: <DeviceIcon device={src.device} />,
        onSelect: () => edit(t('story.step.link'), (_g, d) => linkSource(d, src, here)),
      })),
      ...(sources.length ? [{ id: 'sep', separator: true as const }] : []),
      {
        id: 'wait',
        label: t(sources.length ? 'story.plot.waiting' : ROLES.find((r) => r.role === role)!.empty),
        onSelect: () =>
          edit(t('story.step.plot'), (g) => {
            const n = storyNode(g, node.id);
            if (n) setRole(n, role, true);
          }),
      },
    ];
  };

  return (
    <div className="imark-role">
      {ROLES.map(({ role, label: text }) => {
        const linked = allSources(data, deviceOf(role)).filter(lands);
        return (
          <div key={role} className="imark-role-row">
            <Switch
              label={t(text)}
              checked={linked.length > 0 || roles.includes(role)}
              disabled={project.readOnly}
              onChange={(on) => {
                const box = document
                  .querySelector(`[data-role-switch="${role}"]`)
                  ?.closest('label')
                  ?.getBoundingClientRect();
                turn(role, on, { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 });
              }}
              data-role-switch={role}
            />
            {linked.map((src, i) => (
              <div key={i} className="imark-role-source small">
                <LandingIcon device={src.device} size={13} />
                <button type="button" className="entity-link" onClick={() => openSource(src)}>
                  {label(src)}
                </button>
              </div>
            ))}
          </div>
        );
      })}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          label={t(ROLES.find((r) => r.role === menu.role)!.label)}
          entries={entries(menu.role)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );

  function openSource(src: PlotSource) {
    // The device where it sits: a mark in its node's inspector, an old device node itself.
    show(src.at, src.mark ? `mark:${src.mark.id}` : undefined);
  }
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
  const { project, edit, task, check, script } = useStory();
  const title = useStore(project.store, (s) => graphTitle(s, graph.id));
  const { status, paletteFound, paletteOk, statusOk } = useAtom(gameFiles);
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const key = graphKey(graph);
  const info = status[graph.id];
  const state = graphTransfer(graph, info);
  return (
    <>
      <header className="insp-title">
        <span>{title || t('module.story')}</span>
        {state && <TransferBadge state={state} problems={info?.problems.map((p) => p.text) ?? []} />}
      </header>
      <p className="muted small">{t('story.inspector.nothing')}</p>
      <Section title={t('game.title')} field="game">
        <GameKeyField
          value={key}
          title={title || graph.name}
          among="graphs"
          id={graph.id}
          data={() => project.store.getState()}
          disabled={project.readOnly}
          onChange={(next) =>
            edit(
              t('gameKey.step'),
              (g) => {
                if (next) (g as { key?: string }).key = next;
                else delete (g as { key?: string }).key;
              },
              `key:${graph.id}`,
            )
          }
        />
        <p className="muted small">{t('game.graphHint')}</p>
        {info && (
          <p className="small">
            {t('game.transferred', { date: new Date(info.at).toLocaleString(getLocale()), lines: info.lines ?? '—' })}
          </p>
        )}
        <div className="insp-actions">
          <Button size="sm" icon={<ListChecks size={14} />} onClick={check}>
            {t('check.dialogue')}
          </Button>
          <Button size="sm" icon={<ClipboardCopy size={14} />} disabled={!key} onClick={() => task({})}>
            {t('task.button')}
          </Button>
          <Button size="sm" icon={<FileText size={14} />} onClick={script}>
            {t('script.export')}
          </Button>
        </div>
        <p className={['small', paletteOk && statusOk ? 'muted' : 'text-warning'].join(' ')}>
          {!paletteOk
            ? t('palette.broken')
            : !statusOk
              ? t('game.importBroken')
              : paletteFound
                ? t('palette.found')
                : t('palette.missing')}
        </p>
      </Section>
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
