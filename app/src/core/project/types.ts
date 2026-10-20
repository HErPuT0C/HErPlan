// Project data in memory, mirroring format v1 (docs/format/project-v1.md).
// Objects keep unknown fields as they were read, so files written by newer versions survive a round trip.

export const PROJECT_FORMAT = 'herplan-project';
export const FORMAT_VERSION = 1;

export type JsonObject = { [key: string]: unknown };

export type BackupKeep = number | 'all';

export interface ProjectSettings {
  backups: { keep: BackupKeep; intervalMinutes: number };
  dialogueLimits: { maxLines: number; maxLineChars: number };
  [extra: string]: unknown;
}

export interface ProjectMeta {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  id: string;
  name: string;
  description: string;
  /** Path inside the project, e.g. "assets/cover.png". */
  cover: string | null;
  createdAt: string;
  updatedAt: string;
  createdWith: string;
  settings: ProjectSettings;
  [extra: string]: unknown;
}

/** Everything that is saved as JSON. Collections are keyed by object ID (one file per object). */
export interface ProjectData {
  meta: ProjectMeta;
  /** data/types.json; typed with the database in phase F4. */
  types: JsonObject;
  /** data/variables.json; typed with the logic editor in phase F3. */
  variables: JsonObject;
  /** data/assets.json: the asset library's own settings (folder colours), since 0.3. */
  assetMeta: JsonObject;
  entities: Record<string, JsonObject>;
  graphs: Record<string, JsonObject>;
  boards: Record<string, JsonObject>;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  backups: { keep: 50, intervalMinutes: 10 },
  dialogueLimits: { maxLines: 100, maxLineChars: 100 },
};
