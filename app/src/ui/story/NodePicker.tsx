import { useMemo, useState } from 'react';
import type { GraphDoc } from '../../canvas/model';
import { searchKey } from '../../canvas/ops';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { graphPath, graphTitle } from '../../story/flow';
import { allGraphs, type NodeRef } from '../../story/model';
import { Button, Dialog } from '../components';
import { KindIcon } from '../canvas/kindIcons';
import { useStory } from './context';

/** At most this many nodes are listed; the filter narrows the rest. */
const LIMIT = 300;

/**
 * Picks a node anywhere in the story (consequences, payoffs and jump targets may sit in other chapters):
 * nodes grouped by chapter, filtered by title or text as you type.
 */
export function NodePicker({
  title,
  exclude,
  onPick,
  onClose,
}: {
  title: string;
  /** The node being edited: it cannot point at itself. */
  exclude?: NodeRef;
  onPick: (ref: NodeRef) => void;
  onClose: () => void;
}) {
  const { project, graphId } = useStory();
  const graphs = useStore(project.store, (s) => s.graphs);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const data = project.store.getState();
    void graphs;
    const q = searchKey(query.trim());
    const story = allGraphs(data).filter((g) => g.kind === 'story' || g.kind === 'chapter');
    // The current graph first, then the others in breadcrumb order.
    const order = (g: GraphDoc) =>
      g.id === graphId
        ? ''
        : graphPath(data, g.id)
            .map((id) => graphTitle(data, id))
            .join(' › ');
    const out: { graph: GraphDoc; title: string; nodes: GraphDoc['nodes'] }[] = [];
    let left = LIMIT;
    for (const g of story.sort((a, b) => order(a).localeCompare(order(b)))) {
      if (left <= 0) break;
      const nodes = g.nodes
        .filter(
          (n) =>
            n.kind !== 'sticker' &&
            !(exclude && exclude.graph === g.id && exclude.node === n.id) &&
            (!q || searchKey(`${n.title}\n${n.text ?? ''}`).includes(q)),
        )
        .slice(0, left);
      left -= nodes.length;
      if (nodes.length) out.push({ graph: g, title: graphTitle(data, g.id), nodes });
    }
    return out;
  }, [project, graphs, query, graphId, exclude]);

  return (
    <Dialog
      open
      size="md"
      onClose={onClose}
      title={title}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      }
    >
      <input
        className="input node-picker-search"
        autoFocus
        value={query}
        placeholder={t('story.picker.search')}
        aria-label={t('story.picker.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="node-picker" role="listbox" aria-label={title}>
        {groups.length === 0 && <p className="muted">{t('story.picker.nothing')}</p>}
        {groups.map(({ graph, title: graphName, nodes }) => (
          <div key={graph.id} role="group" aria-label={graphName}>
            <div className="node-picker-graph">{graphName}</div>
            {nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={false}
                className="node-picker-item"
                onClick={() => {
                  onPick({ graph: graph.id, node: n.id });
                  onClose();
                }}
              >
                <KindIcon kind={n.kind} size={14} />
                <span>{n.title || t('story.untitled')}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
