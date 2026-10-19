// Story node cards up close (ADR-002 near zoom): what each kind shows under its header. Editing of
// structured content (lines, options, expressions, links) happens in the inspector; a double click on that
// content opens it there.

import { ChevronDown, ChevronUp, Crosshair, Diamond, Zap } from 'lucide-react';
import { useContext, type ReactNode } from 'react';
import { registerCard, type CardBodyProps, type CardLook } from '../canvas/cardRegistry';
import { Editable } from '../canvas/NodeLayer';
import { ButterflyIcon, KindIcon } from '../canvas/kindIcons';
import type { GraphNode } from '../../canvas/model';
import { useAtomSelect, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { asEntity } from '../../story/entities';
import { graphTitle, refKey } from '../../story/flow';
import { CHOICE_ROW_H, asStory, findNode, graphOf, type NodeRef } from '../../story/model';
import { setExpanded } from '../../story/ops';
import { CHOICE_PROMPT_H, FOLDED_LINES } from '../../story/kinds';
import { useAsync } from '../useAsync';
import { StoryContext, storyIndex, useStory } from './context';

const NARRATOR_COLOR = 'var(--text-muted)';

/** Content that opens the inspector on double click (the engine leaves `data-canvas-text` alone). */
function Inspectable({
  node,
  field,
  className,
  children,
}: {
  node: GraphNode;
  field: string;
  className: string;
  children: ReactNode;
}) {
  const { inspect } = useStory();
  return (
    <div className={className} data-canvas-text="" onDoubleClick={() => inspect(node.id, field)}>
      {children}
    </div>
  );
}

function TextBody({ node, readOnly, onText }: CardBodyProps) {
  return (
    <Editable
      className="cnode-body"
      value={node.text ?? ''}
      placeholder={t('canvas.textPlaceholder')}
      multiline
      readOnly={readOnly}
      onCommit={(v) => onText(node.id, v)}
    />
  );
}

function Code({ source, placeholder }: { source: string | undefined; placeholder: string }) {
  return source?.trim() ? <code className="ccode">{source}</code> : <span className="cnode-empty">{placeholder}</span>;
}

function DialogueBody({ node }: CardBodyProps) {
  const { project } = useStory();
  const entities = useStore(project.store, (s) => s.entities);
  const limit = useStore(project.store, (s) => s.meta.settings.dialogueLimits.maxLineChars);
  const n = asStory(node);
  const lines = n.lines ?? [];
  const shown = n.expanded ? lines : lines.slice(0, FOLDED_LINES);
  const more = lines.length - shown.length;
  return (
    <Inspectable node={node} field="lines" className="cnode-body cdialogue">
      {lines.length === 0 && <span className="cnode-empty">{t('story.card.noLines')}</span>}
      {shown.map((line) => {
        const speaker = line.speaker ? (entities[line.speaker]?.name as string | undefined) : undefined;
        return (
          <div
            key={line.id}
            className={['cline', [...line.text].length > limit && 'cline-long'].filter(Boolean).join(' ')}
          >
            <span className="cline-speaker" style={{ color: speaker ? undefined : NARRATOR_COLOR }}>
              {speaker ?? t('story.narrator')}
            </span>
            <span className="cline-text">{line.text || '…'}</span>
          </div>
        );
      })}
      {more > 0 && <div className="cline cline-more">{t('story.card.moreLines', { count: more })}</div>}
    </Inspectable>
  );
}

function DialogueExtra({ node, readOnly }: { node: GraphNode; readOnly: boolean }) {
  const { project, graphId } = useStory();
  const max = useStore(project.store, (s) => s.meta.settings.dialogueLimits.maxLines);
  const n = asStory(node);
  const count = n.lines?.length ?? 0;
  const toggle = () =>
    project.store.dispatch(t(n.expanded ? 'story.step.fold' : 'story.step.unfold'), (d) => {
      const g = graphOf(d, graphId);
      if (g) setExpanded(g, node.id, !n.expanded);
    });
  return (
    <>
      <span
        className={['cbadge', count > max && 'cbadge-warn'].filter(Boolean).join(' ')}
        title={t('story.card.lineCount', { count, max })}
      >
        {count}
      </span>
      {count > FOLDED_LINES && !readOnly && (
        <button
          type="button"
          className="cnode-btn"
          data-canvas-ignore=""
          aria-label={t(n.expanded ? 'story.card.fold' : 'story.card.unfold')}
          title={t(n.expanded ? 'story.card.fold' : 'story.card.unfold')}
          onClick={toggle}
        >
          {n.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </>
  );
}

function ChoiceBody({ node, readOnly, onText }: CardBodyProps) {
  const n = asStory(node);
  const options = n.options ?? [];
  return (
    <div className="cchoice">
      <div className="cchoice-prompt" style={{ height: CHOICE_PROMPT_H }}>
        <Editable
          className="cnode-body"
          value={node.text ?? ''}
          placeholder={t('story.card.prompt')}
          readOnly={readOnly}
          onCommit={(v) => onText(node.id, v)}
        />
      </div>
      {options.length === 0 && (
        <Inspectable node={node} field="options" className="coption cnode-empty">
          {t('story.card.noOptions')}
        </Inspectable>
      )}
      {options.map((o, i) => (
        <Inspectable key={o.id} node={node} field={`option:${o.id}`} className="coption">
          <span className="coption-n" style={{ height: CHOICE_ROW_H }}>
            {i + 1}
          </span>
          <span className={['coption-text', !o.text && 'cnode-empty'].filter(Boolean).join(' ')}>
            {o.text || t('story.optionPlaceholder', { n: i + 1 })}
          </span>
          {o.condition.trim() && (
            <span className="coption-mark" title={t('story.card.showIf', { condition: o.condition })}>
              <Diamond size={12} />
            </span>
          )}
          {o.effects.trim() && (
            <span className="coption-mark" title={t('story.card.effects', { effects: o.effects })}>
              <Zap size={12} />
            </span>
          )}
        </Inspectable>
      ))}
    </div>
  );
}

function ConditionBody({ node }: CardBodyProps) {
  return (
    <Inspectable node={node} field="expr" className="cnode-body">
      <Code source={asStory(node).expr} placeholder={t('story.card.noCondition')} />
    </Inspectable>
  );
}

function EffectBody({ node }: CardBodyProps) {
  return (
    <Inspectable node={node} field="effects" className="cnode-body">
      <Code source={asStory(node).effects} placeholder={t('story.card.noEffects')} />
    </Inspectable>
  );
}

/** Titles of linked nodes ("→ Рыцарь у ворот · Глава 3"), clickable. */
function LinkList({ links, empty }: { links: NodeRef[]; empty: string }) {
  const { project, show } = useStory();
  const data = project.store.getState();
  if (links.length === 0) return <div className="clinks cnode-empty">{empty}</div>;
  return (
    <div className="clinks">
      {links.slice(0, 3).map((l) => {
        const target = findNode(data, l);
        return (
          <button
            key={refKey(l)}
            type="button"
            className="clink"
            data-canvas-ignore=""
            onClick={() => show(l)}
            title={target ? `${graphTitle(data, l.graph)} › ${target.title}` : t('story.card.deleted')}
          >
            {'→ '}
            {target ? target.title || t('story.untitled') : t('story.card.deleted')}
          </button>
        );
      })}
      {links.length > 3 && <span className="muted">{t('story.card.moreLinks', { count: links.length - 3 })}</span>}
    </div>
  );
}

function ButterflyBody(props: CardBodyProps) {
  const n = asStory(props.node);
  // Re-render when linked titles change.
  useStore(useStory().project.store, (s) => s.graphs);
  return (
    <div className="cplot">
      <TextBody {...props} />
      {n.effects?.trim() && (
        <Inspectable node={props.node} field="effects" className="cplot-effects">
          <Code source={n.effects} placeholder="" />
        </Inspectable>
      )}
      <LinkList links={n.links ?? []} empty={t('story.card.noConsequences')} />
    </div>
  );
}

function GunBody(props: CardBodyProps) {
  useStore(useStory().project.store, (s) => s.graphs);
  return (
    <div className="cplot">
      <TextBody {...props} />
      <LinkList links={asStory(props.node).links ?? []} empty={t('story.card.notFired')} />
    </div>
  );
}

function JumpBody({ node }: CardBodyProps) {
  const { project } = useStory();
  const target = asStory(node).target;
  const label = useStore(project.store, (s) => {
    const n = findNode(s, target);
    return n && target ? `${graphTitle(s, target.graph)} › ${n.title || t('story.untitled')}` : '';
  });
  return (
    <Inspectable node={node} field="target" className="cnode-body cjump">
      {label ? `→ ${label}` : <span className="cnode-empty">{t('story.card.noTarget')}</span>}
    </Inspectable>
  );
}

function AssetImage({ path, className }: { path: string | null | undefined; className: string }) {
  const { project } = useStory();
  const url = useAsync(
    () => (path ? platform().assetUrl(project.dir, path) : Promise.resolve('')),
    [project.dir, path],
    '',
  );
  return url ? <img className={className} src={url} alt="" draggable={false} /> : null;
}

function ChapterBody(props: CardBodyProps) {
  const n = asStory(props.node);
  const { project } = useStory();
  const count = useStore(project.store, (s) => (n.graph ? (graphOf(s, n.graph)?.nodes.length ?? 0) : 0));
  return (
    <div className="cchapter">
      <AssetImage path={n.image} className="cchapter-image" />
      <TextBody {...props} />
      <div className="cchapter-meta muted">{t('story.card.chapterNodes', { count })}</div>
    </div>
  );
}

function RefBody(props: CardBodyProps) {
  const { project } = useStory();
  const n = asStory(props.node);
  const raw = useStore(project.store, (s) => (n.ref ? s.entities[n.ref] : undefined));
  const entity = asEntity(raw);
  return (
    <div className="cref">
      <Inspectable node={props.node} field="ref" className="cref-entity">
        {entity?.image ? (
          <AssetImage path={entity.image} className="cref-image" />
        ) : (
          <span className="cref-placeholder">
            <KindIcon kind={props.node.kind} size={18} />
          </span>
        )}
        <span className={['cref-name', !entity && 'cnode-empty'].filter(Boolean).join(' ')}>
          {entity ? entity.name : t('story.card.unbound')}
        </span>
      </Inspectable>
      <TextBody {...props} />
    </div>
  );
}

const EMPTY = () => <div className="cnode-body" />;

/** Plot links pointing at this node and its worst problem, in the header of every story card. */
function Marks({ node }: { node: GraphNode }) {
  const story = useContext(StoryContext);
  const key = story ? refKey({ graph: story.graphId, node: node.id }) : '';
  const incoming = useAtomSelect(storyIndex, (i) => i.incoming.get(key));
  const worst = useAtomSelect(storyIndex, (i) => i.worst.get(key));
  if (!story) return null;
  return (
    <>
      {incoming?.map((link) => (
        <button
          key={refKey(link.from)}
          type="button"
          className="cnode-btn"
          data-canvas-ignore=""
          title={t(link.kind === 'gun' ? 'story.card.payoffOf' : 'story.card.consequenceOf', { title: link.title })}
          aria-label={t(link.kind === 'gun' ? 'story.card.payoffOf' : 'story.card.consequenceOf', {
            title: link.title,
          })}
          onClick={() => story.show(link.from)}
        >
          {link.kind === 'gun' ? <Crosshair size={13} /> : <ButterflyIcon size={13} />}
        </button>
      ))}
      {worst && worst !== 'info' && (
        <span
          className={`cproblem cproblem-${worst}`}
          title={t('story.card.hasProblems')}
          aria-label={t('story.card.hasProblems')}
        />
      )}
    </>
  );
}

function withMarks(extra?: CardLook['headerExtra']): CardLook['headerExtra'] {
  return function Header(props) {
    const Extra = extra;
    return (
      <>
        {Extra && <Extra {...props} />}
        <Marks node={props.node} />
      </>
    );
  };
}

const icon = (kind: string) =>
  function Icon({ size }: { size?: number }) {
    return <KindIcon kind={kind} size={size} />;
  };

const LOOKS: Record<string, Omit<CardLook, 'icon' | 'headerExtra'> & { extra?: CardLook['headerExtra'] }> = {
  start: { body: EMPTY },
  scene: { body: TextBody },
  dialogue: { body: DialogueBody, extra: DialogueExtra },
  choice: { body: ChoiceBody },
  end: { body: TextBody },
  jump: { body: JumpBody },
  chapter: { body: ChapterBody, titleEditable: false },
  condition: { body: ConditionBody },
  effect: { body: EffectBody },
  butterfly: { body: ButterflyBody },
  gun: { body: GunBody },
  character: { body: RefBody },
  location: { body: RefBody },
  item: { body: RefBody },
};

for (const [kind, look] of Object.entries(LOOKS)) {
  registerCard(kind, { ...look, icon: icon(kind), headerExtra: withMarks(look.extra) });
}
// Generic nodes in story graphs get the marks too (outside the story editor they render nothing).
registerCard('node', { headerExtra: withMarks() });
