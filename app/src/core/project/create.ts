import { newId } from '../ids';
import { DEFAULT_PROJECT_SETTINGS, FORMAT_VERSION, PROJECT_FORMAT, type ProjectData } from './types';

export interface NewProjectInput {
  name: string;
  description?: string;
  appVersion: string;
  now?: Date;
}

/** A fresh empty project. The cover is added after the folder exists (it is copied into assets/). */
export function newProject({ name, description = '', appVersion, now = new Date() }: NewProjectInput): ProjectData {
  const timestamp = isoSeconds(now);
  return {
    meta: {
      format: PROJECT_FORMAT,
      formatVersion: FORMAT_VERSION,
      id: newId(),
      name: name.trim(),
      description,
      cover: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdWith: appVersion,
      settings: structuredClone(DEFAULT_PROJECT_SETTINGS),
    },
    types: { types: [], propertySets: [] },
    variables: { variables: [], labels: [] },
    assetMeta: { folders: {} },
    entities: {},
    graphs: {},
    boards: {},
  };
}

/** ISO 8601 in UTC without milliseconds: "2026-10-18T09:30:00Z". */
export function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
