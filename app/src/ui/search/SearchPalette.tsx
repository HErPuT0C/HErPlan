// Ctrl+K (F6-06): one field that finds anything in the project as it is typed — cards, chapters, documents,
// tasks, story nodes, files, variables, tags. Names before descriptions; Enter or a click opens the object,
// "To the map" puts a chapter, a document, a card or a file onto the project map.

import { MapPinPlus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { addToMap, refLabel } from '../../map/model';
import { excerpt, search, type SearchHit } from '../../search';
import { openMap } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { Dialog, IconButton } from '../components';
import { KIND_NAMES, KindIcon, Marked, mapRefOf, openItem, useSearchIndex, whereText } from './searchUi';
import './search.css';

export function SearchPalette({ project, onClose }: { project: OpenProject; onClose: () => void }) {
  const data = useStore(project.store, (s) => s);
  const index = useSearchIndex(project);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => search(index, query, 60), [index, query]);
  const current = Math.min(active, Math.max(0, hits.length - 1));

  const open = (hit: SearchHit) => {
    onClose();
    openItem(hit.item);
  };
  const toMap = (hit: SearchHit) => {
    const ref = mapRefOf(hit.item);
    if (!ref || project.readOnly) return;
    let node = '';
    project.store.dispatch(t('search.step.toMap'), (d) => {
      node = addToMap(d, ref, refLabel(d, ref) ?? hit.item.name, t('module.map'));
    });
    onClose();
    if (node) openMap(node);
  };
  const go = (i: number) => {
    setActive(i);
    list.current?.querySelector(`[data-hit="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <Dialog open onClose={onClose} title={t('search.title')} size="lg" className="search-dialog">
      <div className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          className="input search-input"
          autoFocus
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="search-results"
          aria-activedescendant={hits.length ? `search-hit-${current}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              go(Math.min(current + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              go(Math.max(current - 1, 0));
            } else if (e.key === 'Enter' && hits[current]) {
              e.preventDefault();
              open(hits[current]);
            }
          }}
        />
      </div>
      <div id="search-results" ref={list} className="search-results" role="listbox" aria-label={t('search.results')}>
        {query.trim() && hits.length === 0 && <p className="muted small search-none">{t('search.none')}</p>}
        {!query.trim() && <p className="muted small search-none">{t('search.hint')}</p>}
        {hits.map((hit, i) => {
          const where = whereText(data, hit.item);
          const ref = mapRefOf(hit.item);
          return (
            <div
              key={`${hit.item.kind}:${hit.item.id}`}
              id={`search-hit-${i}`}
              data-hit={i}
              role="option"
              aria-selected={i === current}
              className={['search-hit', i === current && 'search-hit-active'].filter(Boolean).join(' ')}
              // Only a moving mouse picks a row: results appearing under a resting pointer keep the first one.
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => open(hit)}
            >
              <KindIcon item={hit.item} />
              <div className="search-hit-body">
                <div className="search-hit-name">
                  <Marked text={hit.item.name || t('story.untitled')} query={hit.rank < 3 ? query : ''} />
                </div>
                {hit.rank === 3 && (
                  <div className="search-hit-text small">
                    <Marked text={excerpt(hit.item.text, hit.at, query.trim().length)} query={query} />
                  </div>
                )}
              </div>
              <span className="muted small search-hit-where">
                {t(KIND_NAMES[hit.item.kind])}
                {where ? ` · ${where}` : ''}
              </span>
              {ref && !project.readOnly && (
                <IconButton
                  size="sm"
                  label={t('search.toMap')}
                  icon={<MapPinPlus size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    toMap(hit);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
