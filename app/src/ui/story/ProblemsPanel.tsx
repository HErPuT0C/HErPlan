import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useAtom, useStore } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { openVariables } from '../../state/navigation';
import { countBySeverity, OPEN_THREADS, type Problem, type Severity } from '../../story/checks';
import { graphTitle } from '../../story/flow';
import { storyIndex, useStory } from './context';
import { problemText } from './messages';

type Filter = 'all' | Severity | 'threads';

const FILTERS: [Filter, MessageKey][] = [
  ['all', 'problems.all'],
  ['error', 'problems.errors'],
  ['warning', 'problems.warnings'],
  ['threads', 'problems.threads'],
  ['info', 'problems.hints'],
];

const ICONS: Record<Severity, typeof CircleAlert> = { error: CircleAlert, warning: TriangleAlert, info: Info };

/** Project checks (FR-NAR-08, FR-NAR-10), live: click a problem to go to its place. */
export function ProblemsPanel() {
  const { project, show } = useStory();
  const { problems } = useAtom(storyIndex);
  const data = useStore(project.store, (s) => s);
  const [filter, setFilter] = useState<Filter>('all');
  const counts = countBySeverity(problems);
  const threads = problems.filter((p) => OPEN_THREADS.has(p.code)).length;
  const shown = problems.filter((p) =>
    filter === 'all' ? true : filter === 'threads' ? OPEN_THREADS.has(p.code) : p.severity === filter,
  );
  const count = (f: Filter) => (f === 'all' ? problems.length : f === 'threads' ? threads : counts[f]);
  const go = (p: Problem) => {
    if (p.variable) openVariables(p.variable);
    else if (p.graph && p.node) show({ graph: p.graph, node: p.node });
    else if (p.graph && p.edge) {
      const edge = (data.graphs[p.graph] as { edges?: { id: string; from: { node: string } }[] }).edges?.find(
        (e) => e.id === p.edge,
      );
      if (edge) show({ graph: p.graph, node: edge.from.node });
    } else if (p.graph) show({ graph: p.graph, node: '' });
  };
  return (
    <div className="problems">
      <header className="play-head">
        <h2>{t('problems.title')}</h2>
      </header>
      <div className="problems-filters" role="radiogroup" aria-label={t('problems.filter')}>
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            className="chip"
            onClick={() => setFilter(f)}
          >
            {t(label)} <span className="muted">{count(f)}</span>
          </button>
        ))}
      </div>
      {problems.length === 0 && (
        <p className="problems-ok">
          <CircleCheck size={16} aria-hidden="true" /> {t('problems.none')}
        </p>
      )}
      <ul className="problems-list">
        {shown.map((p, i) => {
          const Icon = ICONS[p.severity];
          return (
            <li key={`${p.code}-${p.graph}-${p.node ?? p.edge ?? p.variable}-${i}`}>
              <button type="button" className={`problem problem-${p.severity}`} onClick={() => go(p)}>
                <Icon size={15} aria-hidden="true" />
                <span className="problem-text">{problemText(p, data)}</span>
                {p.graph && <span className="muted small">{graphTitle(data, p.graph)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
