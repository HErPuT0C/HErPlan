// Contract between the interface and the desktop backend (Rust commands in app/src-tauri).
// The web build (dev server, end-to-end tests) implements the same contract in memory (platform/memory.ts).
// Paths inside a project are relative and use forward slashes: "data/entities/<id>.json".

export interface FileText {
  path: string;
  text: string;
}

export type DamageReason = 'empty' | 'unreadable' | 'not-utf8';

export interface DamagedFile {
  path: string;
  reason: DamageReason;
  detail: string | null;
}

export interface AssetInfo {
  path: string;
  size: number;
  modifiedMs: number;
}

/** Everything the interface needs to open a project: JSON and Markdown as text, assets as a listing. */
export interface ProjectSnapshot {
  files: FileText[];
  damaged: DamagedFile[];
  assets: AssetInfo[];
  removedTempFiles: number;
}

export type PathStatus = 'missing' | 'empty-dir' | 'non-empty-dir' | 'file';

export type BackupKind = 'auto' | 'manual';

export interface BackupInfo {
  kind: BackupKind;
  /** File name without extension, e.g. "2026-10-18T09-40-00Z". */
  name: string;
  createdAt: string;
  size: number;
  label: string | null;
}

export type ErrorCode =
  | 'disk-full'
  | 'not-found'
  | 'exists'
  | 'not-empty'
  | 'not-a-project'
  | 'invalid-path'
  | 'permission-denied'
  | 'bad-archive'
  | 'io';

export interface PlatformError {
  code: ErrorCode;
  message: string;
  path: string | null;
}

export function isPlatformError(value: unknown): value is PlatformError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export interface Platform {
  readonly kind: 'tauri' | 'web';

  appVersion(): Promise<string>;

  /** Raw text of the application settings file, or null when there is none (or it was damaged). */
  loadSettings(): Promise<string | null>;
  saveSettings(text: string): Promise<void>;

  /** "Documents\HErPlan" on Windows; not created until a project is created there. */
  defaultProjectsDir(): Promise<string>;
  joinPath(...parts: string[]): Promise<string>;
  pathStatus(path: string): Promise<PathStatus>;

  /** Creates the project folder layout and writes the initial files; fails if the folder is not empty. */
  createProject(dir: string, files: FileText[]): Promise<void>;
  readProject(dir: string): Promise<ProjectSnapshot>;
  /** Reads one file inside the project (null if missing), e.g. ".herplan/workspace.json". */
  readProjectFile(dir: string, path: string): Promise<string | null>;
  /** Atomic writes, then deletes. Paths are validated: nothing outside the project or inside backups/. */
  writeProject(dir: string, writes: FileText[], deletes: string[]): Promise<void>;
  /** Copies an outside file into the project, e.g. a cover into "assets"; returns its relative path. */
  importFile(dir: string, source: string, destDir: string): Promise<string>;
  /** URL the interface can show in <img> for a file inside the project. */
  assetUrl(dir: string, path: string): Promise<string>;

  createBackup(dir: string, kind: BackupKind, label: string | null): Promise<BackupInfo>;
  listBackups(dir: string): Promise<BackupInfo[]>;
  /** Deletes the oldest automatic copies beyond `keep`; null keeps all. Manual versions are never deleted. */
  pruneBackups(dir: string, keep: number | null): Promise<number>;
  /** Makes a manual safety copy with `safetyLabel`, then replaces the project content with the copy. */
  restoreBackup(dir: string, kind: BackupKind, name: string, safetyLabel: string): Promise<BackupInfo>;

  exportZip(dir: string, target: string): Promise<void>;
  importZip(source: string, targetDir: string): Promise<void>;
  importFolder(source: string, targetDir: string): Promise<void>;

  pickFolder(title: string, defaultPath?: string): Promise<string | null>;
  pickFile(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  pickSaveFile(
    title: string,
    defaultPath: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<string | null>;
  revealInExplorer(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}
