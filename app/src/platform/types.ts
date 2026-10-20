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

/** A file or folder of the asset library ("assets/…"); a folder's size is 0. */
export interface AssetEntry {
  path: string;
  kind: 'file' | 'folder';
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
  /** URL for an outside file the user just picked (cover preview before the project exists). */
  fileUrl(path: string): Promise<string>;

  // Asset library. Every path lies inside "assets/" (anything else fails with 'invalid-path'); temporary files of
  // interrupted writes are never listed or touched.
  /** Every file and folder under "assets/", folders even when empty, sorted by path; "assets" itself is not listed. */
  listAssets(dir: string): Promise<AssetEntry[]>;
  /** Creates a folder with any missing parents; an existing folder is fine, a file with that path fails with 'exists'. */
  assetMkdir(dir: string, path: string): Promise<void>;
  /**
   * Renames or moves a file, or a folder with its contents, creating missing parents of `to`. Fails with 'exists'
   * when `to` is taken and 'invalid-path' when a folder would move into itself. A change of letter case only
   * ("a.png" → "A.png") works on Windows too.
   */
  assetMove(dir: string, from: string, to: string): Promise<void>;
  /**
   * Moves a file, or a folder with its contents, to the Recycle Bin. When the bin refuses (no bin on that drive),
   * fails with 'io' and changes nothing, unless `force` (default false) deletes it for good instead.
   * A path that does not exist is not an error.
   */
  assetDelete(dir: string, path: string, force?: boolean): Promise<void>;
  /**
   * Copies outside files and folders (with everything inside, structure kept) into `destDir`, a folder under
   * "assets/" created if missing. Clashing names get " (2)", " (3)"… like importFile. Symlinks and system files
   * (Thumbs.db, desktop.ini) are skipped. Returns the relative paths of all copied files.
   */
  importAssets(dir: string, sources: string[], destDir: string): Promise<string[]>;
  /**
   * Saves bytes (an image pasted from the clipboard or dropped in the web build) as a new file `name` in
   * `destDir`, renamed like importAssets on a clash; returns its relative path. `name` must be a valid file name.
   */
  writeAsset(dir: string, destDir: string, name: string, data: Uint8Array): Promise<string>;

  createBackup(dir: string, kind: BackupKind, label: string | null): Promise<BackupInfo>;
  listBackups(dir: string): Promise<BackupInfo[]>;
  /** Deletes the oldest automatic copies beyond `keep`; null keeps all. Manual versions are never deleted. */
  pruneBackups(dir: string, keep: number | null): Promise<number>;
  /** Makes a manual safety copy with `safetyLabel`, then replaces the project content with the copy. */
  restoreBackup(dir: string, kind: BackupKind, name: string, safetyLabel: string): Promise<BackupInfo>;

  exportZip(dir: string, target: string): Promise<void>;
  /** Writes an exported file (JSON for game engines) at a path picked in a save dialog. */
  exportText(target: string, text: string): Promise<void>;
  /** Writes an exported binary file (a PDF) at a path picked in a save dialog. */
  exportBytes(target: string, data: Uint8Array): Promise<void>;
  /**
   * Writes exported files (Markdown for Obsidian) into `targetDir`, which must be missing or empty ('not-empty'
   * otherwise); paths are relative with forward slashes and cannot leave the folder ('invalid-path').
   */
  exportFiles(targetDir: string, files: FileText[]): Promise<void>;
  importZip(source: string, targetDir: string): Promise<void>;
  importFolder(source: string, targetDir: string): Promise<void>;

  pickFolder(title: string, defaultPath?: string): Promise<string | null>;
  pickFile(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  /** Several files at once (bulk upload into the asset library); an empty list when cancelled. */
  pickFiles(title: string): Promise<string[]>;
  pickSaveFile(
    title: string,
    defaultPath: string,
    filters: { name: string; extensions: string[] }[],
  ): Promise<string | null>;
  revealInExplorer(path: string): Promise<void>;
  /**
   * Opens an asset ("assets/…" in project `dir`) with its default program. Kinds of files Windows would run
   * (.exe, .bat, .lnk…) are refused with 'invalid-path'; nothing outside the asset library can be opened.
   */
  openAsset(dir: string, path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /**
   * Files dropped on the window from the file explorer: their absolute paths and the drop point in CSS pixels.
   * Returns a function that stops listening. The web build never calls it: there drops arrive as HTML5 events.
   */
  onFileDrop(handler: (paths: string[], x: number, y: number) => void): () => void;
  /** Files dragged over the window: the point in CSS pixels, then null when they leave or are dropped. */
  onFileDragOver?(handler: (point: { x: number; y: number } | null) => void): () => void;
  /** Interface scale in percent (80–200), like browser zoom. */
  setUiScale(percent: number): Promise<void>;
  /** Versions and environment for bug reports: application, Tauri, WebView2, Windows, architecture. */
  systemInfo(): Promise<Record<string, string>>;
  /** Saves a bug report into the application's reports folder; returns the file path. */
  saveReport(text: string): Promise<string>;
  /** Runs `handler` (saving, last backup) before the window closes. */
  onWindowClose(handler: () => Promise<void>): void;
}
