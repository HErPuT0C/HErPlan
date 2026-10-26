import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import type { GraphDoc, GraphNode } from '../../canvas/model';
import { findNodes } from '../../canvas/ops';
import type { ProjectData } from '../../core/project/types';
import type { Store } from '../../core/store';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { IconButton } from '../components';

/** Search in the graph (FR-CNV-08): matches are outlined, Enter and Shift+Enter jump between them. */
export function SearchBar({
  engine,
  store,
  graphId,
  nodeText,
  onOpen,
  onClose,
}: {
  engine: CanvasEngine;
  store: Store<ProjectData>;
  graphId: string;
  /** More text to find a node by (the map: the name and contents of the object a card shows). */
  nodeText?: (node: GraphNode, data: ProjectData) => string;
  /** Opens what the found node stands for (Ctrl+Enter); true when it did. */
  onOpen?: (id: string) => boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(0);
  const graph = useStore(store, (s) => s.graphs[graphId] as unknown as GraphDoc | undefined);
  // The objects behind the map's cards change apart from the graph (a card renamed in the database).
  const data = useStore(store, (s) => (nodeText ? s : null));
  const results = useMemo(
    () => (graph ? findNodes(graph, query, nodeText && data ? (n) => nodeText(n, data) : undefined) : []),
    [graph, query, nodeText, data],
  );
  const current = results.length ? results[Math.min(position, results.length - 1)] : null;

  useEffect(() => {
    engine.setHighlight(new Set(results), current);
  }, [engine, results, current]);

  // Jump only when the focused match changes, not when the graph is edited during a search.
  useEffect(() => {
    if (current) engine.reveal(current);
  }, [engine, current]);

  useEffect(() => () => engine.setHighlight(new Set(), null), [engine]);

  const step = (delta: number) => results.length && setPosition((p) => (p + delta + results.length) % results.length);

  return (
    <div className="canvas-search" data-canvas-ignore role="search">
      <input
        className="input"
        autoFocus
        value={query}
        placeholder={t('canvas.searchPlaceholder')}
        aria-label={t('canvas.search')}
        onChange={(e) => {
          setQuery(e.target.value);
          setPosition(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onOpen && current) onOpen(current);
          else if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
        }}
      />
      <span className="canvas-search-count muted small" aria-live="polite">
        {query.trim()
          ? t('canvas.searchCount', {
              current: results.length ? Math.min(position, results.length - 1) + 1 : 0,
              total: results.length,
            })
          : ''}
      </span>
      <IconButton
        size="sm"
        label={t('canvas.searchPrev')}
        icon={<ChevronUp size={16} />}
        onClick={() => step(-1)}
        disabled={!results.length}
      />
      <IconButton
        size="sm"
        label={t('canvas.searchNext')}
        icon={<ChevronDown size={16} />}
        onClick={() => step(1)}
        disabled={!results.length}
      />
      {onOpen && (
        <IconButton
          size="sm"
          label={t('canvas.searchOpen')}
          icon={<ExternalLink size={16} />}
          onClick={() => current && onOpen(current)}
          disabled={!current}
        />
      )}
      <IconButton size="sm" label={t('common.close')} icon={<X size={16} />} onClick={onClose} />
    </div>
  );
}
