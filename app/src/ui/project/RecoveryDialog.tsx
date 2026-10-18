import { useState } from 'react';
import { useAsync } from '../useAsync';
import type { LoadIssue } from '../../core/project/load';
import { formatBytes, formatDate, t, type MessageKey } from '../../i18n';
import { platform, type BackupInfo } from '../../platform';
import { closeProject, openOrThrow } from '../../state/project';
import { Button, Dialog, EmptyState } from '../components';
import { errorText } from '../errors';

const ISSUE_TEXT: Record<LoadIssue['kind'], MessageKey> = {
  empty: 'recovery.issue.empty',
  unreadable: 'recovery.issue.unreadable',
  'not-utf8': 'recovery.issue.not-utf8',
  'invalid-json': 'recovery.issue.invalid-json',
  'not-an-object': 'recovery.issue.not-an-object',
};

export interface RecoveryRequest {
  dir: string;
  issues: LoadIssue[];
  /** The project could not be opened at all (project.json is damaged). */
  blocking: boolean;
}

/** Damaged files found while opening (FR-SAV-03): what is wrong, and a copy to restore from. */
export function RecoveryDialog({ request, onClose }: { request: RecoveryRequest | null; onClose: () => void }) {
  return request ? <Recovery key={request.dir} request={request} onClose={onClose} /> : null;
}

function Recovery({ request, onClose }: { request: RecoveryRequest; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backups = useAsync<BackupInfo[] | null>(() => platform().listBackups(request.dir), [request.dir], null);

  const restore = async (backup: BackupInfo) => {
    setBusy(backup.name);
    setError(null);
    try {
      await closeProject();
      await platform().restoreBackup(request.dir, backup.kind, backup.name, t('recovery.safetyLabel'));
      await openOrThrow(request.dir);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      dismissable={busy === null}
      title={request.blocking ? t('recovery.titleBlocking') : t('recovery.title')}
      footer={
        <Button onClick={onClose} disabled={busy !== null}>
          {request.blocking ? t('common.close') : t('recovery.continue')}
        </Button>
      }
    >
      <p className="muted">{request.blocking ? t('recovery.introBlocking') : t('recovery.intro')}</p>
      <ul className="issue-list">
        {request.issues.map((issue) => (
          <li key={issue.path}>
            <code>{issue.path}</code>
            {' — '}
            {t(ISSUE_TEXT[issue.kind])}
          </li>
        ))}
      </ul>
      <h3 className="section-title">{t('recovery.backups')}</h3>
      {backups === null ? null : backups.length === 0 ? (
        <EmptyState title={t('recovery.noBackups')} text={t('recovery.noBackupsText')} />
      ) : (
        <ul className="backup-list">
          {backups.map((b) => (
            <li key={`${b.kind}/${b.name}`} className="backup-row">
              <span className="backup-date">{formatDate(b.createdAt)}</span>
              <span className="backup-kind">
                {b.kind === 'auto' ? t('history.auto') : b.label || t('history.manual')}
              </span>
              <span className="muted small">{formatBytes(b.size)}</span>
              <Button size="sm" onClick={() => restore(b)} busy={busy === b.name} disabled={busy !== null}>
                {t('recovery.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
