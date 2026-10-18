import { FileArchive, FolderInput, FolderOpen, FolderSearch, Plus, Settings, Trash } from 'lucide-react';
import { useState } from 'react';
import { useAtom } from '../../core/useStore';
import { formatDate, t } from '../../i18n';
import { platform } from '../../platform';
import { openProject, type OpenResult } from '../../state/project';
import { settings, updateSettings, withoutRecent, type RecentProject } from '../../state/settings';
import { Logo } from '../brand/Logo';
import { Button, EmptyState, IconButton, MenuButton, toast, useContextMenu } from '../components';
import { errorText } from '../errors';
import { Cover } from '../project/Cover';
import { RecoveryDialog, type RecoveryRequest } from '../project/RecoveryDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useAsync } from '../useAsync';
import { CreateProjectDialog } from './CreateProjectDialog';
import { zipFilters } from './filters';
import { ImportDialog, type ImportSource } from './ImportDialog';
import { LanguageSwitch } from './LanguageSwitch';
import { versionText } from '../version';
import './start.css';

/** First screen (FR-PRJ-01): create, open or import a project, or continue a recent one. */
export function StartScreen() {
  const { recentProjects } = useAtom(settings);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState<ImportSource | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleResult = (result: OpenResult) => {
    if (result.ok) {
      if (result.project.issues.length > 0) {
        toast({
          kind: 'warning',
          text: t('recovery.someDamaged', { count: result.project.issues.length }),
          action: {
            label: t('recovery.details'),
            run: () => setRecovery({ dir: result.project.dir, issues: result.project.issues, blocking: false }),
          },
        });
      }
      if (result.project.readOnly) toast({ kind: 'warning', text: t('open.readOnly') }, 0);
      return;
    }
    const { failure, dir } = result;
    if (failure.kind === 'project-json-damaged') setRecovery({ dir, issues: failure.issues, blocking: true });
    else if (failure.kind === 'platform') toast({ kind: 'error', text: errorText(failure.error) });
    else if (failure.kind === 'no-migration')
      toast({ kind: 'error', text: t('open.noMigration', { version: failure.from }) });
    else toast({ kind: 'error', text: t('open.notHerplan') });
  };

  const open = async (dir: string) => handleResult(await openProject(dir));

  const openFolder = async () => {
    const dir = await platform().pickFolder(t('start.openTitle'));
    if (dir) await open(dir);
  };

  const pickImport = async (kind: ImportSource['kind']) => {
    const path =
      kind === 'zip'
        ? await platform().pickFile(t('import.pickZip'), zipFilters())
        : await platform().pickFolder(t('import.pickFolder'));
    if (path) setImporting({ kind, path });
  };

  return (
    <div className="start">
      <header className="start-top">
        <Logo size={36} />
        <div className="start-top-actions">
          <LanguageSwitch />
          <IconButton label={t('settings.title')} icon={<Settings size={18} />} onClick={() => setSettingsOpen(true)} />
        </div>
      </header>

      <main className="start-main">
        <section className="start-actions" aria-labelledby="start-actions-title">
          <h1 id="start-actions-title" className="start-title">
            {t('start.title')}
          </h1>
          <p className="muted">{t('start.subtitle')}</p>
          <div className="start-buttons">
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              {t('start.create')}
            </Button>
            <Button icon={<FolderOpen size={18} />} onClick={openFolder}>
              {t('start.open')}
            </Button>
            <MenuButton
              label={t('start.import')}
              icon={<FolderInput size={18} />}
              entries={[
                {
                  id: 'zip',
                  label: t('import.fromZipMenu'),
                  icon: <FileArchive size={16} />,
                  onSelect: () => void pickImport('zip'),
                },
                {
                  id: 'folder',
                  label: t('import.fromFolderMenu'),
                  icon: <FolderOpen size={16} />,
                  onSelect: () => void pickImport('folder'),
                },
              ]}
            />
          </div>
        </section>

        <section className="start-recent" aria-labelledby="start-recent-title">
          <h2 id="start-recent-title" className="section-title">
            {t('start.recent')}
          </h2>
          {recentProjects.length === 0 ? (
            <EmptyState
              icon={<FolderSearch size={40} strokeWidth={1.5} />}
              title={t('start.recentEmpty')}
              text={t('start.recentEmptyText')}
            />
          ) : (
            <ul className="recent-grid">
              {recentProjects.map((r) => (
                <RecentCard key={r.path} recent={r} onOpen={() => open(r.path)} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="start-footer muted small">{versionText()}</footer>

      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
      <ImportDialog source={importing} onClose={() => setImporting(null)} />
      <RecoveryDialog request={recovery} onClose={() => setRecovery(null)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function RecentCard({ recent, onOpen }: { recent: RecentProject; onOpen: () => Promise<void> }) {
  const status = useAsync(() => platform().pathStatus(recent.path), [recent.path], null);
  const missing = status === 'missing' || status === 'file';
  const [busy, setBusy] = useState(false);
  const remove = () => updateSettings((s) => withoutRecent(s, recent.path));
  const { onContextMenu, menu } = useContextMenu(recent.name, () => [
    {
      id: 'open',
      label: t('start.recentOpen'),
      icon: <FolderOpen size={16} />,
      disabled: missing,
      onSelect: () => void onOpen(),
    },
    {
      id: 'reveal',
      label: t('common.revealInExplorer'),
      icon: <FolderSearch size={16} />,
      disabled: missing,
      onSelect: () => void platform().revealInExplorer(recent.path),
    },
    { id: 'sep', separator: true },
    { id: 'remove', label: t('start.recentRemove'), icon: <Trash size={16} />, onSelect: remove },
  ]);

  return (
    <li
      className={['recent-card', missing && 'recent-missing'].filter(Boolean).join(' ')}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="recent-open"
        disabled={busy}
        aria-describedby={missing ? `missing-${recent.id || recent.path}` : undefined}
        onClick={async () => {
          if (missing) {
            toast({
              kind: 'warning',
              text: t('start.recentMissing', { path: recent.path }),
              action: { label: t('start.recentRemove'), run: remove },
            });
            return;
          }
          setBusy(true);
          try {
            await onOpen();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Cover dir={recent.path} cover={missing ? null : recent.cover} name={recent.name} size={64} />
        <span className="recent-text">
          <span className="recent-name">{recent.name}</span>
          <span className="recent-path" title={recent.path}>
            {recent.path}
          </span>
          {missing ? (
            <span id={`missing-${recent.id || recent.path}`} className="recent-meta recent-meta-warn">
              {t('start.folderMissing')}
            </span>
          ) : (
            <span className="recent-meta">{t('start.openedAt', { date: formatDate(recent.openedAt) })}</span>
          )}
        </span>
      </button>
      {menu}
    </li>
  );
}
