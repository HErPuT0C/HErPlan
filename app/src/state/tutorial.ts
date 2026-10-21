// Making the tutorial project on disk (F7-05): a fresh copy each time, in the projects folder, in the language
// of the interface; it opens like any project and can be changed freely.

import { allFiles } from '../core/project/files';
import { getLocale } from '../i18n';
import { platform } from '../platform';
import { folderNameFor } from '../platform/paths';
import { tutorialProject } from '../tutorial/project';
import { openOrThrow, type OpenProject } from './project';
import { settings } from './settings';

/** Writes a new copy of the tutorial project ("… (2)" when the name is taken) and opens it. */
export async function openTutorial(): Promise<OpenProject> {
  const p = platform();
  const { data, assets } = tutorialProject(getLocale(), await p.appVersion());
  const parent = settings.get().projectsDir ?? (await p.defaultProjectsDir());
  const base = folderNameFor(data.meta.name) || 'HErPlan';
  let target = await p.joinPath(parent, base);
  for (let i = 2; (await p.pathStatus(target)) !== 'missing'; i++) target = await p.joinPath(parent, `${base} (${i})`);
  await p.createProject(target, allFiles(data));
  const encoder = new TextEncoder();
  for (const a of assets) {
    await p.writeAsset(target, a.folder ? `assets/${a.folder}` : 'assets', a.name, encoder.encode(a.text));
  }
  return openOrThrow(target);
}
