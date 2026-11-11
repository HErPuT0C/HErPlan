// Search over the lines (0.8, item 22 of "Dialogues"): words of lines and options, who speaks, and where a
// variable, an item or a character is used. Found nodes of the canvas are lit; a click leads to the line.

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import { searchKey } from '../../canvas/ops';
import { useStore } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { listEntities } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import {
  isEmptyQuery,
  SEARCH_LIMIT,
  searchLines,
  type LineHit,
  type UseReason,
  type UseTarget,
} from '../../story/lineSearch';
import { graphOf } from '../../story/model';
import { listVariables } from '../../story/variables';
import { IconButton } from '../components';
import { useStory } from './context';

const REASONS: Record<UseReason, MessageKey> = {
  speaker: 'search.reason.speaker',
  to: 'search.reason.to',
  condition: 'search.reason.condition',
  effects: 'search.reason.effects',
  text: 'search.reason.text',
  action: 'search.reason.action',
  store: 'search.reason.store',
  keep: 'search.reason.keep',
};

/** The words found, marked in the text. */
function Marked({ text, words }: { text: string; words: string }) {
  const q = searchKey(words.trim());
  if (!q) return <>{text}</>;
  const at = searchKey(text).indexOf(q);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

const encode = (u: UseTarget | null) => (u ? `${u.kind}:${u.id}` : '');
const decode = (v: string): UseTarget | null => {
  const [kind, id] = v.split(':');
  return id && (kind === 'variable' || kind === 'entity') ? { kind, id } : null;
};

export function LineSearchPanel({ engine, onClose }: { engine: CanvasEngine; onClose: () => void }) {
  const { project, graphId, show } = useStory();
  const data = useStore(project.store, (s) => s);
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [uses, setUses] = useState('');
  const [everywhere, setEverywhere] = useState(true);

  const query = { text, speaker: speaker || null, uses: decode(uses), graph: everywhere ? null : graphId };
  const hits = useMemo(
    () => searchLines(data, query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, text, speaker, uses, everywhere, graphId],
  );

  // The nodes found on this canvas are lit; the light goes out with the panel.
  const lit = hits
    .filter((h) => h.graph === graphId)
    .map((h) => h.node)
    .join(',');
  useEffect(() => {
    engine.setHighlight(new Set(lit ? lit.split(',') : []), null);
  }, [engine, lit]);
  useEffect(() => () => engine.setHighlight(new Set(), null), [engine]);

  const characters = listEntities(data, 'character');
  const items = listEntities(data, 'item');
  const others = listEntities(data).filter(
    (e) => !characters.some((c) => c.id === e.id) && !items.some((i) => i.id === e.id),
  );
  const variables = listVariables(data);
  const groups = new Map<string, LineHit[]>();
  for (const h of hits) {
    const key = `${h.graph}/${h.node}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const name = (id: string | null) =>
    id ? ((data.entities[id]?.name as string | undefined) ?? t('story.lines.deletedSpeaker')) : t('story.narrator');
  const open = (h: LineHit) =>
    show({ graph: h.graph, node: h.node }, h.part ? `${h.part.kind}:${h.part.id}` : undefined);

  return (
    <div className="problems line-search">
      <header className="play-head">
        <h2>{t('search.lines.title')}</h2>
        <IconButton size="sm" label={t('common.close')} icon={<X size={16} />} onClick={onClose} />
      </header>
      <input
        className="input"
        type="search"
        value={text}
        autoFocus
        placeholder={t('search.lines.placeholder')}
        aria-label={t('search.lines.words')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="line-search-filters">
        <select
          className="input"
          value={speaker}
          aria-label={t('search.lines.speaker')}
          onChange={(e) => setSpeaker(e.target.value)}
        >
          <option value="">{t('search.lines.anySpeaker')}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t('story.untitled')}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={uses}
          aria-label={t('search.lines.uses')}
          onChange={(e) => setUses(e.target.value)}
        >
          <option value="">{t('search.lines.usesNothing')}</option>
          {variables.length > 0 && (
            <optgroup label={t('search.lines.variables')}>
              {variables.map((v) => (
                <option key={v.id} value={encode({ kind: 'variable', id: v.id })}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
          {items.length > 0 && (
            <optgroup label={t('search.lines.items')}>
              {items.map((e) => (
                <option key={e.id} value={encode({ kind: 'entity', id: e.id })}>
                  {e.name || t('story.untitled')}
                </option>
              ))}
            </optgroup>
          )}
          {characters.length > 0 && (
            <optgroup label={t('search.lines.characters')}>
              {characters.map((e) => (
                <option key={e.id} value={encode({ kind: 'entity', id: e.id })}>
                  {e.name || t('story.untitled')}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={t('search.lines.cards')}>
              {others.map((e) => (
                <option key={e.id} value={encode({ kind: 'entity', id: e.id })}>
                  {e.name || t('story.untitled')}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <label className="line-search-scope small">
          <input type="checkbox" checked={!everywhere} onChange={(e) => setEverywhere(!e.target.checked)} />
          <span>{t('search.lines.here')}</span>
        </label>
      </div>
      {isEmptyQuery(query) ? (
        <p className="muted small">{t('search.lines.hint')}</p>
      ) : (
        <p className="muted small" role="status">
          {hits.length >= SEARCH_LIMIT
            ? t('search.lines.many', { count: SEARCH_LIMIT })
            : t('search.lines.count', { count: hits.length })}
        </p>
      )}
      <ul className="line-search-list">
        {[...groups].map(([key, list]) => {
          const first = list[0];
          const g = graphOf(data, first.graph);
          const node = g?.nodes.find((n) => n.id === first.node);
          return (
            <li key={key}>
              <div className="line-search-node small">
                <strong>{node?.title || t('story.untitled')}</strong>
                {first.graph !== graphId && <span className="muted"> · {graphTitle(data, first.graph)}</span>}
              </div>
              {list.map((h, i) => (
                <button
                  key={h.part?.id ?? `node-${i}`}
                  type="button"
                  className="line-search-hit"
                  onClick={() => open(h)}
                >
                  {h.part?.kind === 'line' && <span className="line-search-who">{name(h.speaker)}:</span>}
                  {h.part?.kind === 'option' && <span className="line-search-who">›</span>}
                  <span className="line-search-text">
                    {h.part ? <Marked text={h.text || '…'} words={text} /> : t('search.lines.node')}
                  </span>
                  {h.reasons.length > 0 && (
                    <span className="muted small line-search-why">
                      {h.reasons.map((r) => t(REASONS[r])).join(', ')}
                    </span>
                  )}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
