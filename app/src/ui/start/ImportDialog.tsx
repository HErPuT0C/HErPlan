import { useState } from 'react';
import { t } from '../../i18n';
import { platform, type PathStatus } from '../../platform';
import { baseName, folderNameFor } from '../../platform/paths';
import { openProject } from '../../state/project';
import { settings } from '../../state/settings';
import { Button, Dialog, TextField } from '../components';
import { errorText } from '../errors';
import { useAsync } from '../useAsync';

export type ImportSource = { kind: 'zip' | 'folder'; path: string };

/** Import a project from a .zip or a folder into a new folder (FR-SAV-06), then open it. */
export function ImportDialog({ source, onClose }: { source: ImportSource | null; onClose: () => void }) {
  return source ? <ImportForm key={source.path} source={source} onClose={onClose} /> : null;
}

function ImportForm({ source, onClose }: { source: ImportSource; onClose: () => void }) {
  const [pickedParent, setParent] = useState<string | null>(settings.get().projectsDir);
  const [folder, setFolder] = useState(() => folderNameFor(baseName(source.path).replace(/\.zip$/i, '')) || 'HErPlan');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultParent = useAsync(() => platform().defaultProjectsDir(), [], null);
  const parent = pickedParent ?? defaultParent;

  const safeFolder = folderNameFor(folder);
  const target = useAsync(
    async () => (parent && safeFolder ? platform().joinPath(parent, safeFolder) : ''),
    [parent, safeFolder],
    '',
  );
  const status = useAsync<PathStatus | null>(
    async () => (target ? platform().pathStatus(target) : null),
    [target],
    null,
  );
  const taken = status === 'non-empty-dir' || status === 'file';

  const run = async () => {
    if (!target || taken) return;
    setBusy(true);
    setError(null);
    try {
      if (source.kind === 'zip') await platform().importZip(source.path, target);
      else await platform().importFolder(source.path, target);
      const opened = await openProject(target);
      if (!opened.ok) throw opened.failure.kind === 'platform' ? opened.failure.error : new Error(opened.failure.kind);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('import.title')}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={run} busy={busy} disabled={!safeFolder || taken}>
            {t('import.submit')}
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">{source.kind === 'zip' ? t('import.fromZip') : t('import.fromFolder')}</span>
        <span className="path-text" title={source.path}>
          {source.path}
        </span>
      </div>
      <div className="field">
        <span className="field-label">{t('import.location')}</span>
        <div className="path-picker">
          <span className="path-text" title={parent ?? ''}>
            {parent}
          </span>
          <Button
            size="sm"
            onClick={async () => {
              const picked = await platform().pickFolder(t('create.pickFolder'), parent ?? undefined);
              if (picked) setParent(picked);
            }}
          >
            {t('common.change')}
          </Button>
        </div>
      </div>
      <TextField
        label={t('import.folderName')}
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
        error={taken ? t('create.folderTaken', { path: target }) : null}
        hint={target ? t('create.willCreate', { path: target }) : undefined}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
