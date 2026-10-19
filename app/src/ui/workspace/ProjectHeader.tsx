import { ArchiveRestore, Download, FolderSearch, ImagePlus, Redo2, Settings, Undo2, Variable, X } from 'lucide-react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { openVariables } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { IconButton, toast, useContextMenu } from '../components';
import { errorText } from '../errors';
import { Cover } from '../project/Cover';
import { IMAGE_FILTERS } from '../start/filters';
import { SaveStatus } from './SaveStatus';

interface ProjectHeaderProps {
  project: OpenProject;
  onHistory: () => void;
  onExport: () => void;
  onSettings: () => void;
  onClose: () => void;
}

/** Project header (FR-PRJ-03): cover, name, folder, save state, history, export, settings. */
export function ProjectHeader({ project, onHistory, onExport, onSettings, onClose }: ProjectHeaderProps) {
  const { store } = project;
  const name = useStore(store, (s) => s.meta.name);
  const cover = useStore(store, (s) => s.meta.cover);
  const canUndo = useStore(store, () => store.canUndo);
  const canRedo = useStore(store, () => store.canRedo);
  const undoLabel = useStore(store, () => store.undoLabel);
  const redoLabel = useStore(store, () => store.redoLabel);

  const changeCover = async () => {
    const source = await platform().pickFile(t('create.pickCover'), IMAGE_FILTERS);
    if (!source) return;
    try {
      const path = await platform().importFile(project.dir, source, 'assets');
      store.dispatch(t('history.step.cover'), (d) => {
        d.meta.cover = path;
      });
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };

  const coverMenu = useContextMenu(t('project.cover'), () => [
    { id: 'change', label: t('create.changeCover'), icon: <ImagePlus size={16} />, onSelect: () => void changeCover() },
    {
      id: 'remove',
      label: t('create.removeCover'),
      icon: <X size={16} />,
      disabled: !cover,
      onSelect: () =>
        store.dispatch(t('history.step.coverRemoved'), (d) => {
          d.meta.cover = null;
        }),
    },
  ]);

  return (
    <header className="project-header">
      <button
        type="button"
        className="project-cover-btn"
        aria-label={t('project.changeCover')}
        title={t('project.changeCover')}
        disabled={project.readOnly}
        onClick={changeCover}
        onContextMenu={project.readOnly ? undefined : coverMenu.onContextMenu}
      >
        <Cover dir={project.dir} cover={cover} name={name} size={36} />
      </button>
      {coverMenu.menu}
      <div className="project-title">
        <h1 className="project-name" title={name}>
          {name}
        </h1>
        <button
          type="button"
          className="project-path"
          title={t('common.revealInExplorer')}
          onClick={() => void platform().revealInExplorer(project.dir)}
        >
          <FolderSearch size={12} aria-hidden="true" />
          <span>{project.dir}</span>
        </button>
      </div>
      <SaveStatus saver={project.saver} />
      <div className="project-actions">
        <IconButton
          label={undoLabel ? t('common.undoWhat', { what: undoLabel }) : t('common.undo')}
          icon={<Undo2 size={18} />}
          disabled={!canUndo || project.readOnly}
          onClick={() => store.undo()}
        />
        <IconButton
          label={redoLabel ? t('common.redoWhat', { what: redoLabel }) : t('common.redo')}
          icon={<Redo2 size={18} />}
          disabled={!canRedo || project.readOnly}
          onClick={() => store.redo()}
        />
        <span className="toolbar-sep" />
        <IconButton label={t('var.title')} icon={<Variable size={18} />} onClick={() => openVariables()} />
        <IconButton label={t('history.title')} icon={<ArchiveRestore size={18} />} onClick={onHistory} />
        <IconButton label={t('export.button')} icon={<Download size={18} />} onClick={onExport} />
        <IconButton label={t('settings.title')} icon={<Settings size={18} />} onClick={onSettings} />
        <IconButton label={t('project.close')} icon={<X size={18} />} onClick={onClose} />
      </div>
    </header>
  );
}
