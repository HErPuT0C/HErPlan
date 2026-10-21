// Picks an object of the project to link a task to (F6-04): cards, chapters, documents, story nodes, files —
// found with the project-wide search.

import { useMemo, useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { search, type SearchItem, type SearchKind } from '../../search';
import type { OpenProject } from '../../state/project';
import type { TaskLink, TaskLinkKind } from '../../tasks/model';
import { Dialog } from '../components';
import { KIND_NAMES, KindIcon, Marked, useSearchIndex, whereText } from '../search/searchUi';
import '../search/search.css';

const KINDS: SearchKind[] = ['entity', 'chapter', 'document', 'node', 'asset'];
const linkKind = (kind: SearchKind): TaskLinkKind => (kind === 'chapter' ? 'graph' : (kind as TaskLinkKind));

export function ObjectPicker({
  project,
  linked,
  onPick,
  onClose,
}: {
  project: OpenProject;
  /** Already linked: not offered again. */
  linked: readonly TaskLink[];
  onPick: (link: TaskLink) => void;
  onClose: () => void;
}) {
  const data = useStore(project.store, (s) => s);
  const index = useSearchIndex(project);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<SearchKind | null>(null);
  const taken = new Set(linked.map((l) => `${l.kind}:${l.id}`));
  const items: SearchItem[] = useMemo(() => {
    const allowed = index.filter((x) => (only ? x.kind === only : KINDS.includes(x.kind)));
    return query.trim() ? search(allowed, query, 80).map((h) => h.item) : allowed.slice(0, 80);
  }, [index, query, only]);
  const shown = items.filter((x) => !taken.has(`${linkKind(x.kind)}:${x.id}`));
  const pick = (x: SearchItem) => {
    onPick({ kind: linkKind(x.kind), id: x.id });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} title={t('tasks.link.title')}>
      <input
        className="input"
        autoFocus
        value={query}
        placeholder={t('search.placeholder')}
        aria-label={t('tasks.link.search')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0])}
      />
      <div className="search-kinds" role="radiogroup" aria-label={t('docs.insert.kinds')}>
        <button type="button" className="chip" role="radio" aria-checked={!only} onClick={() => setOnly(null)}>
          {t('docs.insert.all')}
        </button>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            role="radio"
            aria-checked={only === k}
            onClick={() => setOnly(k)}
          >
            <KindIcon item={{ kind: k, id: '' }} size={13} /> {t(KIND_NAMES[k])}
          </button>
        ))}
      </div>
      <div className="search-results" role="listbox" aria-label={t('tasks.link.title')}>
        {shown.length === 0 && <p className="muted small search-none">{t('search.none')}</p>}
        {shown.map((x) => {
          const where = whereText(data, x);
          return (
            <button
              key={`${x.kind}:${x.id}`}
              type="button"
              role="option"
              aria-selected="false"
              className="search-hit"
              onClick={() => pick(x)}
            >
              <KindIcon item={x} />
              <span className="search-hit-body search-hit-name">
                <Marked text={x.name || t('story.untitled')} query={query} />
              </span>
              <span className="muted small search-hit-where">
                {t(KIND_NAMES[x.kind])}
                {where ? ` · ${where}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
