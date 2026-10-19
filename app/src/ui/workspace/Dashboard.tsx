import { History } from 'lucide-react';
import { useStore } from '../../core/useStore';
import { formatDate, t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { MODULE_KINDS, type ModuleKind } from '../../state/workspace';
import { EmptyState } from '../components';
import { Cover } from '../project/Cover';
import { MODULES } from './modules';

/** Project dashboard (FR-PRJ-03): modules, recent objects, project facts. */
export function Dashboard({
  project,
  onOpen,
  view,
}: {
  project: OpenProject;
  onOpen: (kind: ModuleKind) => void;
  view: 'cards' | 'list';
}) {
  const meta = useStore(project.store, (s) => s.meta);
  return (
    <div className="dashboard">
      <section className="dash-hero">
        <Cover dir={project.dir} cover={meta.cover} name={meta.name} size={96} />
        <div>
          <h2 className="dash-name">{meta.name}</h2>
          <p className="muted">{meta.description || t('dashboard.noDescription')}</p>
          <p className="muted small">
            {t('dashboard.created', { date: meta.createdAt ? formatDate(meta.createdAt, false) : '—' })}
          </p>
        </div>
      </section>

      <section aria-labelledby="dash-modules">
        <h3 id="dash-modules" className="section-title">
          {t('dashboard.modules')}
        </h3>
        <ul className={view === 'cards' ? 'module-grid' : 'module-list'}>
          {MODULE_KINDS.map((kind) => {
            const m = MODULES[kind];
            const Icon = m.icon;
            return (
              <li key={kind}>
                <button type="button" className="module-card" onClick={() => onOpen(kind)}>
                  <Icon
                    size={view === 'cards' ? 28 : 20}
                    strokeWidth={1.6}
                    className="module-icon"
                    aria-hidden="true"
                  />
                  <span className="module-text">
                    <span className="module-name">{t(m.title)}</span>
                    <span className="module-desc">{t(m.description)}</span>
                  </span>
                  {m.release && (
                    <span className="module-badge">
                      {t(m.partial ? 'module.fullIn' : 'module.comingIn', { version: m.release })}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="dash-recent">
        <h3 id="dash-recent" className="section-title">
          {t('dashboard.recent')}
        </h3>
        <EmptyState
          icon={<History size={32} strokeWidth={1.5} />}
          title={t('dashboard.recentEmpty')}
          text={t('dashboard.recentEmptyText')}
        />
      </section>
    </div>
  );
}
