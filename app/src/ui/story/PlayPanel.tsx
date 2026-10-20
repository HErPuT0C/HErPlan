import { CircleAlert, Flag, Play, RotateCcw, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import type { Value } from '../../story/expr';
import { graphTitle } from '../../story/flow';
import { findNode } from '../../story/model';
import { playAct, playActions, playSetVariable, type LogEntry, type PlayState } from '../../story/play';
import { listVariables, registryFor, valueText } from '../../story/variables';
import { Button, IconButton, Switch } from '../components';
import { KindIcon } from '../canvas/kindIcons';
import { useStory } from './context';
import { playProblemText } from './messages';
import { ValueInput } from './ValueInput';

/** States of a run, the last one current: "step back" drops the last. */
export type PlayHistory = PlayState[];

/**
 * Test playthrough (FR-NAR-07): the current node as the player sees it, the ways on, the variables
 * (editable by hand) and the history. The canvas follows the current node.
 */
export function PlayPanel({
  history,
  onChange,
  onRestart,
  onClose,
}: {
  history: PlayHistory;
  onChange: (history: PlayHistory) => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const { project } = useStory();
  const data = useStore(project.store, (s) => s);
  const [showHidden, setShowHidden] = useState(true);
  const state = history[history.length - 1];
  const node = state.pos ? findNode(data, state.pos) : undefined;
  const actions = playActions(data, state);
  const entities = data.entities;
  const push = (next: PlayState) => next !== state && onChange([...history, next]);
  const visible = useMemo(() => {
    const reg = registryFor(data, state.pos?.graph ?? null);
    return [...reg].map(([name, entry]) => ({ name, variable: entry.variable }));
  }, [data, state.pos?.graph]);
  const initial = useMemo(() => Object.fromEntries(listVariables(data).map((v) => [v.id, v.initial])), [data]);
  const shown = actions.filter((a) => a.kind !== 'option' || a.enabled || showHidden);
  const deadEnd = state.status === 'running' && actions.length === 0 && node?.kind !== 'end';
  const hasHidden = actions.some((a) => a.kind === 'option' && !a.enabled);
  const speakerName = (id: string | null) =>
    id ? ((entities[id]?.name as string | undefined) ?? t('story.lines.deletedSpeaker')) : t('story.narrator');

  return (
    <div className="play">
      <header className="play-head">
        <h2>
          <Play size={16} aria-hidden="true" /> {t('play.title')}
        </h2>
        <div className="play-tools">
          <IconButton
            size="sm"
            label={t('play.back')}
            icon={<Undo2 size={16} />}
            disabled={history.length < 2}
            onClick={() => onChange(history.slice(0, -1))}
          />
          <IconButton size="sm" label={t('play.restart')} icon={<RotateCcw size={16} />} onClick={onRestart} />
          <IconButton size="sm" label={t('play.close')} icon={<X size={16} />} onClick={onClose} />
        </div>
      </header>

      <section className="play-now" aria-live="polite">
        {node && state.pos && (
          <>
            <div className="play-where muted small">{graphTitle(data, state.pos.graph)}</div>
            <h3 className="play-node">
              <KindIcon kind={node.kind} size={16} />
              <span>{node.title || t('story.untitled')}</span>
            </h3>
            {node.kind === 'dialogue' ? (
              <div className="play-lines">
                {(node.lines ?? []).map((l) => (
                  <p key={l.id}>
                    <strong>{speakerName(l.speaker)}:</strong> {l.text}
                  </p>
                ))}
              </div>
            ) : (
              node.text && <p className="play-text">{node.text}</p>
            )}
          </>
        )}
        {state.status === 'ended' && (
          <div className="play-end">
            <Flag size={16} aria-hidden="true" /> {t('play.ended')}
            <Button size="sm" variant="primary" icon={<RotateCcw size={14} />} onClick={onRestart}>
              {t('play.again')}
            </Button>
          </div>
        )}
        {(state.problem || deadEnd) && (
          <div className="play-problem" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <span>
              {state.problem
                ? playProblemText(state.problem, data)
                : t('play.problem.deadEnd', { node: node?.title || t('story.untitled') })}
            </span>
          </div>
        )}
        {shown.length > 0 && (
          <div className="play-actions">
            {shown.map((a) =>
              a.kind === 'option' ? (
                <Button
                  key={a.id}
                  className="play-option"
                  disabled={!a.enabled}
                  title={a.enabled ? undefined : t('play.hiddenOption')}
                  onClick={() => push(playAct(data, state, a))}
                >
                  {a.label || t('story.untitled')}
                </Button>
              ) : (
                <Button
                  key={a.edge}
                  variant={actions.length === 1 ? 'primary' : 'secondary'}
                  className="play-option"
                  onClick={() => push(playAct(data, state, a))}
                >
                  {actions.length === 1 ? t('play.next') : a.label || t('story.untitled')}
                </Button>
              ),
            )}
          </div>
        )}
        {hasHidden && <Switch label={t('play.showHidden')} checked={showHidden} onChange={setShowHidden} />}
      </section>

      <section className="play-vars">
        <h3 className="insp-heading">{t('play.variables')}</h3>
        {visible.length === 0 && <p className="muted small">{t('play.noVariables')}</p>}
        {visible.map(({ name, variable }) => {
          const value = state.vars[variable.id] ?? null;
          const changed = value !== initial[variable.id];
          return (
            <div key={variable.id} className={['play-var', changed && 'play-var-changed'].filter(Boolean).join(' ')}>
              <span className="play-var-name" title={changed ? t('play.changed') : undefined}>
                {name}
              </span>
              <ValueInput
                variable={variable}
                value={value}
                entities={entities}
                label={name}
                onChange={(next: Value | null) => push(playSetVariable(state, variable, next))}
              />
            </div>
          );
        })}
      </section>

      <section className="play-log">
        <h3 className="insp-heading">{t('play.history')}</h3>
        <ol reversed className="play-log-list">
          {[...state.log]
            .reverse()
            .slice(0, 200)
            .map((entry, i) => (
              <li key={state.log.length - i}>{logText(entry)}</li>
            ))}
        </ol>
      </section>
    </div>
  );
}

function logText(e: LogEntry): string {
  const yes = t('var.yes');
  const no = t('var.no');
  const none = t('story.ref.none');
  switch (e.kind) {
    case 'arrive':
      return `→ ${e.title || t('story.untitled')}`;
    case 'condition':
      return t('play.log.condition', { result: e.result ? yes : no });
    case 'option':
      return t('play.log.option', { text: e.text });
    case 'exit':
      return t('play.log.exit', { label: e.label });
    case 'changes':
      return e.changes
        .map((c) => `${c.name}: ${valueText(c.before, yes, no, none)} → ${valueText(c.after, yes, no, none)}`)
        .join('; ');
    case 'manual':
      return t('play.log.manual', { name: e.name, value: valueText(e.value, yes, no, none) });
    case 'enter':
      return t('play.log.enter', { title: e.title });
    case 'leave':
      return t('play.log.leave', { title: e.title });
  }
}
