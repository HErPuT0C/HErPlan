import { ArchiveRestore, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../core/useStore';
import { formatBytes, formatDate, t } from '../../i18n';
import { platform, type BackupInfo } from '../../platform';
import { closeProject, openProject, type OpenProject } from '../../state/project';
import { Button, Dialog, EmptyState, TextField, toast } from '../components';
import { errorText } from '../errors';

/** Version history (FR-SAV-05): automatic copies and manual versions; restore; new labelled version. */
export function HistoryDialog({
  project,
  open,
  onClose,
}: {
  project: OpenProject;
  open: boolean;
  onClose: () => void;
}) {
  return open ? <History project={project} onClose={onClose} /> : null;
}

function History({ project, onClose }: { project: OpenProject; onClose: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<BackupInfo | null>(null);
  const { keep, intervalMinutes } = useStore(project.store, (s) => s.meta.settings.backups);

  const reload = useCallback(() => {
    platform()
      .listBackups(project.dir)
      .then(setBackups, (e) => {
        setBackups([]);
        toast({ kind: 'error', text: errorText(e) });
      });
  }, [project.dir]);

  useEffect(reload, [reload]);

  const createVersion = async () => {
    setBusy('create');
    try {
      await project.saver?.flush();
      await platform().createBackup(project.dir, 'manual', label.trim() || null);
      setLabel('');
      toast({ kind: 'success', text: t('history.created') });
      reload();
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (backup: BackupInfo) => {
    setConfirm(null);
    setBusy(backup.name);
    try {
      await closeProject();
      await platform().restoreBackup(project.dir, backup.kind, backup.name, t('recovery.safetyLabel'));
      const reopened = await openProject(project.dir);
      if (!reopened.ok)
        throw reopened.failure.kind === 'platform' ? reopened.failure.error : new Error(reopened.failure.kind);
      toast({ kind: 'success', text: t('history.restored', { date: formatDate(backup.createdAt) }) });
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
      setBusy(null);
    }
  };

  return (
    <>
      <Dialog open onClose={onClose} title={t('history.title')} size="lg" dismissable={busy === null}>
        {!project.readOnly && (
          <form
            className="history-create"
            onSubmit={(e) => {
              e.preventDefault();
              void createVersion();
            }}
          >
            <TextField
              label={t('history.labelField')}
              placeholder={t('history.labelPlaceholder')}
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button type="submit" icon={<Save size={16} />} busy={busy === 'create'} disabled={busy !== null}>
              {t('history.create')}
            </Button>
          </form>
        )}
        <p className="muted small">
          {t('history.policy', {
            keep: keep === 'all' ? t('settings.keepAll') : t('settings.keepLast', { count: keep }),
            minutes: intervalMinutes,
          })}
        </p>
        {backups === null ? null : backups.length === 0 ? (
          <EmptyState title={t('history.empty')} text={t('history.emptyText')} />
        ) : (
          <ul className="backup-list">
            {backups.map((b) => (
              <li key={`${b.kind}/${b.name}`} className="backup-row">
                <span className="backup-date">{formatDate(b.createdAt)}</span>
                <span className={`backup-kind backup-kind-${b.kind}`}>
                  {b.kind === 'auto' ? t('history.auto') : b.label || t('history.manual')}
                </span>
                <span className="muted small">{formatBytes(b.size)}</span>
                {!project.readOnly && (
                  <Button
                    size="sm"
                    icon={<ArchiveRestore size={14} />}
                    busy={busy === b.name}
                    disabled={busy !== null}
                    onClick={() => setConfirm(b)}
                  >
                    {t('history.restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={t('history.confirmTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => confirm && void restore(confirm)}>
              {t('history.restore')}
            </Button>
          </>
        }
      >
        <p>{confirm && t('history.confirmText', { date: formatDate(confirm.createdAt) })}</p>
      </Dialog>
    </>
  );
}
