// Mapping between project data and files. A change to one entity rewrites one file (ADR-004).

import type { FileText } from '../../platform/types';
import type { ProjectData } from './types';

export const SINGLE_FILES = {
  meta: 'project.json',
  types: 'data/types.json',
  variables: 'data/variables.json',
} as const;

export const COLLECTIONS = {
  entities: 'data/entities',
  graphs: 'data/graphs',
  boards: 'data/boards',
} as const;

type SingleKey = keyof typeof SINGLE_FILES;
type CollectionKey = keyof typeof COLLECTIONS;

/** Which file a changed path of the state belongs to (an Immer patch path). */
export function fileForPath(path: readonly (string | number)[]): string | null {
  const [root, id] = path;
  if (root in SINGLE_FILES) return SINGLE_FILES[root as SingleKey];
  if (root in COLLECTIONS && id !== undefined) return `${COLLECTIONS[root as CollectionKey]}/${id}.json`;
  return null;
}

/** JSON as it is stored: two-space indent, LF, newline at the end of the file. */
export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Current content of a project file, or null if the object it held no longer exists. */
export function fileContent(data: ProjectData, file: string): string | null {
  for (const [key, name] of Object.entries(SINGLE_FILES)) {
    if (file === name) return serializeJson(data[key as SingleKey]);
  }
  for (const [key, dir] of Object.entries(COLLECTIONS)) {
    if (file.startsWith(`${dir}/`) && file.endsWith('.json')) {
      const id = file.slice(dir.length + 1, -'.json'.length);
      const object = data[key as CollectionKey][id];
      return object === undefined ? null : serializeJson(object);
    }
  }
  return null;
}

/** All files of a project, for creating it on disk. */
export function allFiles(data: ProjectData): FileText[] {
  const files: FileText[] = Object.entries(SINGLE_FILES).map(([key, path]) => ({
    path,
    text: serializeJson(data[key as SingleKey]),
  }));
  for (const [key, dir] of Object.entries(COLLECTIONS)) {
    for (const [id, object] of Object.entries(data[key as CollectionKey])) {
      files.push({ path: `${dir}/${id}.json`, text: serializeJson(object) });
    }
  }
  return files;
}
