import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import { newProject } from '../../core/project/create';
import { allFiles, serializeJson } from '../../core/project/files';
import { t } from '../../i18n';
import { platform, type PathStatus } from '../../platform';
import { folderNameFor } from '../../platform/paths';
import { openOrThrow } from '../../state/project';
import { settings, updateSettings } from '../../state/settings';
import { Button, Dialog, TextArea, TextField } from '../components';
import { errorText } from '../errors';
import { CoverImage } from '../project/Cover';
import { useAsync } from '../useAsync';
import { IMAGE_FILTERS } from './filters';

/** New project (FR-PRJ-02): name, folder (Documents\HErPlan by default), optional 1:1 cover. */
export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every opening starts with an empty form.
  return open ? <CreateProjectForm onClose={onClose} /> : null;
}

function CreateProjectForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pickedParent, setParent] = useState<string | null>(settings.get().projectsDir);
  const [cover, setCover] = useState<{ source: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const defaultParent = useAsync(() => platform().defaultProjectsDir(), [], null);
  const parent = pickedParent ?? defaultParent;

  const folder = folderNameFor(name);
  const target = useAsync(
    async () => (parent && folder ? platform().joinPath(parent, folder) : ''),
    [parent, folder],
    '',
  );
  const status = useAsync<PathStatus | null>(
    async () => (target ? platform().pathStatus(target) : null),
    [target],
    null,
  );

  const nameError = touched && !name.trim() ? t('create.nameRequired') : null;
  const folderTaken = status === 'non-empty-dir' || status === 'file';

  const pickParent = async () => {
    const picked = await platform().pickFolder(t('create.pickFolder'), parent ?? undefined);
    if (picked) setParent(picked);
  };

  const pickCover = async () => {
    const source = await platform().pickFile(t('create.pickCover'), IMAGE_FILTERS);
    if (source) setCover({ source, url: await platform().fileUrl(source) });
  };

  const create = async () => {
    setTouched(true);
    if (!name.trim() || !parent || !target || folderTaken) return;
    setBusy(true);
    setError(null);
    try {
      const p = platform();
      const data = newProject({ name, description: description.trim(), appVersion: await p.appVersion() });
      await p.createProject(target, allFiles(data));
      if (cover) {
        data.meta.cover = await p.importFile(target, cover.source, 'assets');
        await p.writeProject(target, [{ path: 'project.json', text: serializeJson(data.meta) }], []);
      }
      updateSettings((s) => ({ ...s, projectsDir: parent }));
      await openOrThrow(target);
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
      title={t('create.title')}
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={create} busy={busy} disabled={folderTaken}>
            {t('create.submit')}
          </Button>
        </>
      }
    >
      <form
        className="create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="create-cover">
          <CoverImage url={cover?.url ?? ''} name={name} size={112} />
          <div className="create-cover-actions">
            <Button size="sm" icon={<ImagePlus size={16} />} onClick={pickCover}>
              {cover ? t('create.changeCover') : t('create.addCover')}
            </Button>
            {cover && (
              <Button size="sm" variant="ghost" icon={<X size={16} />} onClick={() => setCover(null)}>
                {t('create.removeCover')}
              </Button>
            )}
            <span className="muted small">{t('create.coverHint')}</span>
          </div>
        </div>
        <TextField
          label={t('create.name')}
          value={name}
          autoFocus
          maxLength={120}
          placeholder={t('create.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          error={nameError}
        />
        <div className="field">
          <span className="field-label">{t('create.location')}</span>
          <div className="path-picker">
            <span className="path-text" title={parent ?? ''}>
              {parent}
            </span>
            <Button size="sm" onClick={pickParent}>
              {t('common.change')}
            </Button>
          </div>
          {target && (
            <span className={folderTaken ? 'field-error' : 'field-hint'} role={folderTaken ? 'alert' : undefined}>
              {folderTaken ? t('create.folderTaken', { path: target }) : t('create.willCreate', { path: target })}
            </span>
          )}
        </div>
        <TextArea
          label={t('create.description')}
          value={description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('create.descriptionPlaceholder')}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
