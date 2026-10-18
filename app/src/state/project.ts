// The open project: data store, autosave, automatic copies, and the recent-projects list.

import { atom } from '../core/atom';
import { Autosaver } from '../core/project/autosave';
import { BackupScheduler } from '../core/project/backups';
import { COLLECTIONS } from '../core/project/files';
import { loadProject, type LoadIssue } from '../core/project/load';
import { applyMigrations, planMigrations, readFormatVersion } from '../core/project/migrate';
import { FORMAT_VERSION, type ProjectData } from '../core/project/types';
import { Store } from '../core/store';
import { t } from '../i18n';
import { platform, isPlatformError, type PlatformError, type ProjectSnapshot } from '../platform';
import { settings, updateSettings, withRecent } from './settings';

export interface OpenProject {
  dir: string;
  store: Store<ProjectData>;
  /** Null when the project is read-only (made by a newer HErPlan). */
  saver: Autosaver | null;
  backups: BackupScheduler | null;
  readOnly: boolean;
  issues: LoadIssue[];
}

export type OpenFailure =
  | { kind: 'platform'; error: PlatformError }
  | { kind: 'project-json-damaged' | 'not-herplan'; issues: LoadIssue[] }
  | { kind: 'no-migration'; from: number };

export type OpenResult = { ok: true; project: OpenProject } | { ok: false; dir: string; failure: OpenFailure };

export const currentProject = atom<OpenProject | null>(null);

function toPlatformError(e: unknown): PlatformError {
  return isPlatformError(e) ? e : { code: 'io', message: String(e), path: null };
}

export async function openProject(dir: string): Promise<OpenResult> {
  try {
    await closeProject();
  } catch (e) {
    return { ok: false, dir, failure: { kind: 'platform', error: toPlatformError(e) } };
  }
  let snapshot: ProjectSnapshot;
  try {
    snapshot = await platform().readProject(dir);
    const version = readFormatVersion(snapshot);
    if (version !== null && version < FORMAT_VERSION) {
      const plan = planMigrations(version);
      if (!plan) return { ok: false, dir, failure: { kind: 'no-migration', from: version } };
      // A labelled version first, so the project can go back if the migration goes wrong.
      await platform().createBackup(dir, 'manual', t('migration.backupLabel', { version: FORMAT_VERSION }));
      const { writes, deletes } = applyMigrations(snapshot, plan);
      await platform().writeProject(dir, writes, deletes);
      snapshot = await platform().readProject(dir);
    }
  } catch (e) {
    return { ok: false, dir, failure: { kind: 'platform', error: toPlatformError(e) } };
  }
  const result = loadProject(snapshot);
  if (!result.ok) return { ok: false, dir, failure: { kind: result.reason, issues: result.issues } };

  const store = new Store<ProjectData>(result.data);
  const existingFiles = Object.entries(COLLECTIONS).flatMap(([key, folder]) =>
    Object.keys(result.data[key as keyof typeof COLLECTIONS]).map((id) => `${folder}/${id}.json`),
  );
  const saver = result.readOnly
    ? null
    : new Autosaver(store, {
        write: (writes, deletes) => platform().writeProject(dir, writes, deletes),
        delayMs: () => settings.get().autosaveSeconds * 1000,
        existingFiles,
      });
  const backups =
    saver &&
    new BackupScheduler(store, {
      flush: () => saver.flush(),
      create: () => platform().createBackup(dir, 'auto', null),
      prune: (keep) => platform().pruneBackups(dir, keep),
      isActive: () => document.visibilityState === 'visible',
      onError: (e) => console.error('automatic backup failed', e),
    });

  const project: OpenProject = { dir, store, saver, backups, readOnly: result.readOnly, issues: result.issues };
  rememberRecent(project);
  currentProject.set(project);
  return { ok: true, project };
}

/** Opens a project that was just created, imported or restored; any failure is thrown as an error to show. */
export async function openOrThrow(dir: string): Promise<OpenProject> {
  const result = await openProject(dir);
  if (result.ok) return result.project;
  throw result.failure.kind === 'platform' ? result.failure.error : new Error(result.failure.kind);
}

export function rememberRecent(project: OpenProject): void {
  const { meta } = project.store.getState();
  updateSettings((s) =>
    withRecent(s, {
      path: project.dir,
      name: meta.name,
      id: meta.id,
      cover: meta.cover,
      openedAt: new Date().toISOString(),
    }),
  );
}

/**
 * Saves everything, makes the closing copy if anything changed, and returns to the start screen.
 * If saving fails (disk full, no access) the project stays open and the error is thrown, unless `discard`
 * is set: then unsaved changes are dropped on purpose. A failed closing copy does not block closing.
 */
export async function closeProject({ discard = false } = {}): Promise<void> {
  const project = currentProject.get();
  if (!project) return;
  if (!discard) {
    await project.saver?.flush();
    await project.backups?.backupIfChanged().catch((e) => console.error('closing backup failed', e));
  }
  project.backups?.dispose();
  project.saver?.dispose();
  currentProject.set(null);
}
