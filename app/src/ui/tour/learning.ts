// Starting the tutorial project and the tour from the start screen and from the settings (0.7).

import { t } from '../../i18n';
import { closeProject, currentProject } from '../../state/project';
import { updateSettings } from '../../state/settings';
import { startTour } from '../../state/tour';
import { openTutorial } from '../../state/tutorial';
import { toast } from '../components';
import { errorText } from '../errors';

/** A fresh copy of the tutorial project, opened (the open project is closed first); then the tour, if asked. */
export async function openTutorialProject(withTour: boolean): Promise<boolean> {
  try {
    if (currentProject.get()) await closeProject();
    await openTutorial();
    if (withTour) startTour();
    else updateSettings((s) => ({ ...s, tourSeen: true }));
    return true;
  } catch (e) {
    toast({ kind: 'error', text: t('learning.failed', { reason: errorText(e) }) });
    return false;
  }
}

/** The tour over the open project, or over a fresh tutorial project when none is open. */
export function takeTour(): void {
  if (currentProject.get()) startTour();
  else void openTutorialProject(true);
}
