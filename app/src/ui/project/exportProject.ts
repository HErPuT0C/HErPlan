import { t } from '../../i18n';
import { platform } from '../../platform';
import { folderNameFor } from '../../platform/paths';
import type { OpenProject } from '../../state/project';
import { toast } from '../components';
import { errorText } from '../errors';
import { zipFilters } from '../start/filters';

/** Export the whole project as .zip (FR-SAV-06): pending changes are saved first. */
export async function exportProject(project: OpenProject): Promise<void> {
  const p = platform();
  const name = folderNameFor(project.store.getState().meta.name) || 'HErPlan';
  const defaultPath = await p.joinPath(await p.defaultProjectsDir(), `${name}.zip`);
  const target = await p.pickSaveFile(t('export.title'), defaultPath, zipFilters());
  if (!target) return;
  try {
    await project.saver?.flush();
    await p.exportZip(project.dir, target);
    toast({
      kind: 'success',
      text: t('export.done', { path: target }),
      action: { label: t('common.revealInExplorer'), run: () => void p.revealInExplorer(target) },
    });
  } catch (e) {
    toast({ kind: 'error', text: t('export.failed', { reason: errorText(e) }) });
  }
}
