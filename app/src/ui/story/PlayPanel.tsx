import { CircleAlert, Flag, Play, RotateCcw, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAtomSelect, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import type { Value } from '../../story/expr';
import { graphTitle } from '../../story/flow';
import { refKey } from '../../story/flow';
import { listEntities } from '../../story/entities';
import { findNode, plotMarks } from '../../story/model';
import { markLabel } from '../../story/marks';
import {
  playAct,
  playActions,
  playSetItem,
  playSetVariable,
  playText,
  type LogEntry,
  type PlayState,
} from '../../story/play';
import { listVariables, registryFor, valueText } from '../../story/variables';
import { Button, IconButton, Switch } from '../components';
import { DeviceIcon, KindIcon, LandingIcon } from '../canvas/kindIcons';
import { storyIndex, useStory } from './context';
import { actionName } from './game';
import { speakerName } from './lineLook';
import { playProblemText } from './messages';
import { gameFiles } from '../../state/gameFiles';
import type { Palette } from '../../story/palette';
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
  /** Ordinary ways on (not the exits of interrupted lines): one of them alone is "Next". */
  const plain = actions.filter((a) => a.kind === 'exit' && !a.interrupt).length;
  const items = useMemo(() => listEntities(data, 'item'), [data]);
  const incoming = useAtomSelect(storyIndex, (i) => (state.pos ? i.incoming.get(refKey(state.pos)) : undefined));
  const say = (text: string) =>
    state.pos ? playText(data, state, state.pos.graph, text, t('var.yes'), t('var.no')) : text;
  const nameOfSpeaker = (id: string | null) => speakerName(entities, id);

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
                {/* 0.8: only the lines whose conditions held when the player came here. */}
                {(node.lines ?? [])
                  .filter((l) => state.shown.includes(l.id))
                  .map((l) => (
                    <p key={l.id}>
                      <strong>{nameOfSpeaker(l.speaker)}:</strong> {say(l.text)}
                    </p>
                  ))}
              </div>
            ) : (
              node.text && <p className="play-text">{say(node.text)}</p>
            )}
            {(plotMarks(node).length > 0 || (incoming?.length ?? 0) > 0) && (
              <ul className="play-plot">
                {plotMarks(node).map((m) => (
                  <li key={m.id} className={`plot-${m.device}`}>
                    <DeviceIcon device={m.device} size={14} />
                    {t(m.device === 'gun' ? 'play.plot.gun' : 'play.plot.butterfly', { title: markLabel(node, m) })}
                  </li>
                ))}
                {incoming?.map((l) => (
                  <li key={`${refKey(l.from)}-${l.mark ?? ''}`} className={`plot-${l.kind}`}>
                    <LandingIcon device={l.kind} size={14} />
                    {t(l.kind === 'gun' ? 'play.plot.payoff' : 'play.plot.consequence', { title: l.title })}
                  </li>
                ))}
              </ul>
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
                  title={a.enabled ? (a.secret ? t('play.secretHint') : undefined) : t('play.hiddenOption')}
                  onClick={() => push(playAct(data, state, a))}
                >
                  {a.secret ? t('play.secret', { text: say(a.label) }) : say(a.label) || t('story.untitled')}
                </Button>
              ) : a.kind === 'give' ? (
                <Button
                  key={`${a.port}-${a.item ?? ''}`}
                  variant={a.port === 'given' ? 'secondary' : 'ghost'}
                  className="play-option"
                  onClick={() => push(playAct(data, state, a))}
                >
                  {a.port === 'given'
                    ? t('play.give', { name: a.label || t('story.untitled') })
                    : t(a.port === 'cancel' ? 'play.giveCancel' : 'play.giveEmpty')}
                </Button>
              ) : a.interrupt ? (
                <Button
                  key={a.edge}
                  variant="ghost"
                  className="play-option"
                  onClick={() => push(playAct(data, state, a))}
                >
                  {t('play.interrupt', {
                    n: (node?.lines ?? []).findIndex((l) => l.id === a.interrupt) + 1,
                    label: a.label || t('story.untitled'),
                  })}
                </Button>
              ) : (
                <Button
                  key={a.edge}
                  variant={plain === 1 ? 'primary' : 'secondary'}
                  className="play-option"
                  onClick={() => push(playAct(data, state, a))}
                >
                  {plain === 1 ? t('play.next') : a.label || t('story.untitled')}
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

      {(items.length > 0 || state.hired.length > 0) && (
        <section className="play-vars play-items">
          <h3 className="insp-heading">{t('play.items')}</h3>
          <div className="play-item-list">
            {items.map((e) => (
              <label key={e.id} className="play-item">
                <input
                  type="checkbox"
                  checked={state.items.includes(e.id)}
                  onChange={(ev) => push(playSetItem(state, e.id, ev.target.checked))}
                />
                <span>{e.name || t('story.untitled')}</span>
              </label>
            ))}
          </div>
          {state.hired.length > 0 && (
            <p className="small muted">
              {t('play.hired', { names: state.hired.map((id) => (entities[id]?.name as string) ?? '?').join(', ') })}
            </p>
          )}
        </section>
      )}

      <section className="play-log">
        <h3 className="insp-heading">{t('play.history')}</h3>
        <ol reversed className="play-log-list">
          {[...state.log]
            .reverse()
            .slice(0, 200)
            .map((entry, i) => (
              <li key={state.log.length - i}>{logText(entry, gameFiles.get().palette)}</li>
            ))}
        </ol>
      </section>
    </div>
  );
}

function logText(e: LogEntry, palette: Palette): string {
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
    case 'action':
      return e.name ? `${actionName(palette, e.action)}: ${e.name}` : actionName(palette, e.action);
    case 'gave':
      return t('play.log.gave', { name: e.name });
    case 'enter':
      return t('play.log.enter', { title: e.title });
    case 'leave':
      return t('play.log.leave', { title: e.title });
  }
}
