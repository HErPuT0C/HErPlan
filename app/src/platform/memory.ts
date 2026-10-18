// In-memory platform for the web build: the dev server and end-to-end tests run without the Rust backend.
// Files live in a map persisted to localStorage, so a reload behaves like restarting the application.
// Binary files (covers) are stored as data URLs. Archives and backups are JSON, not real zip files.

import { baseName, normalizeProjectPath } from './paths';
import type { BackupInfo, BackupKind, FileText, Platform, PlatformError, PathStatus, ProjectSnapshot } from './types';

const FS_KEY = 'herplan.web.fs.v1';
const SETTINGS_KEY = 'herplan.web.settings.v1';
const LAYOUT = [
  'data/entities',
  'data/graphs',
  'data/boards',
  'documents',
  'assets',
  'backups/auto',
  'backups/manual',
  '.herplan',
];
const EXCLUDED_FROM_ARCHIVE = ['backups/', '.herplan/'];

interface FsState {
  files: Record<string, string>;
  dirs: string[];
}

interface Archive {
  'herplan-web-archive': 1;
  files: Record<string, string>;
}

function fail(code: PlatformError['code'], message: string, path: string | null = null): never {
  throw { code, message, path } satisfies PlatformError;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function join(...parts: string[]): string {
  const joined = parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function timestampName(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/:/g, '-');
}

export class MemoryPlatform implements Platform {
  readonly kind = 'web';
  private fs: FsState;

  constructor(private readonly persist = true) {
    this.fs = this.load();
  }

  private load(): FsState {
    if (this.persist) {
      try {
        const raw = storage()?.getItem(FS_KEY);
        if (raw) return JSON.parse(raw) as FsState;
      } catch {
        // A broken store starts empty, like a fresh machine.
      }
    }
    return { files: {}, dirs: [] };
  }

  private save(): void {
    if (!this.persist) return;
    try {
      storage()?.setItem(FS_KEY, JSON.stringify(this.fs));
    } catch {
      fail('disk-full', 'browser storage is full');
    }
  }

  private status(path: string): PathStatus {
    const p = join(path);
    if (p in this.fs.files) return 'file';
    const prefix = `${p}/`;
    if (Object.keys(this.fs.files).some((f) => f.startsWith(prefix))) return 'non-empty-dir';
    if (this.fs.dirs.some((d) => d.startsWith(prefix))) return 'non-empty-dir';
    return this.fs.dirs.includes(p) ? 'empty-dir' : 'missing';
  }

  private mkdir(path: string): void {
    const parts = join(path).split('/');
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir && !this.fs.dirs.includes(dir)) this.fs.dirs.push(dir);
    }
  }

  private requireProject(dir: string): void {
    const status = this.status(dir);
    if (status === 'missing') fail('not-found', 'project folder not found', dir);
    if (!(join(dir, 'project.json') in this.fs.files)) fail('not-a-project', 'project.json not found', dir);
  }

  private rel(dir: string, path: string): string {
    const normalized = normalizeProjectPath(path);
    if (!normalized) fail('invalid-path', 'path is not allowed', path);
    return join(dir, normalized);
  }

  /** Files of a project that go into archives and backups, relative to the project folder. */
  private projectFiles(dir: string): Record<string, string> {
    const prefix = `${join(dir)}/`;
    const out: Record<string, string> = {};
    for (const [path, content] of Object.entries(this.fs.files)) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (EXCLUDED_FROM_ARCHIVE.some((e) => rel.startsWith(e))) continue;
      out[rel] = content;
    }
    return out;
  }

  private writeArchive(files: Record<string, string>): string {
    return JSON.stringify({ 'herplan-web-archive': 1, files } satisfies Archive);
  }

  private readArchive(path: string): Record<string, string> {
    const raw = this.fs.files[join(path)];
    if (raw === undefined) fail('not-found', 'archive not found', path);
    try {
      const archive = JSON.parse(raw) as Archive;
      if (archive['herplan-web-archive'] !== 1) throw new Error('not an archive');
      return archive.files;
    } catch {
      return fail('bad-archive', 'not a HErPlan archive', path);
    }
  }

  private extractInto(targetDir: string, files: Record<string, string>): void {
    if (!('project.json' in files)) fail('not-a-project', 'project.json not found in archive');
    const status = this.status(targetDir);
    if (status === 'non-empty-dir') fail('not-empty', 'target folder is not empty', targetDir);
    if (status === 'file') fail('exists', 'target is a file', targetDir);
    for (const dir of LAYOUT) this.mkdir(join(targetDir, dir));
    for (const [rel, content] of Object.entries(files)) this.fs.files[join(targetDir, rel)] = content;
    this.save();
  }

  async appVersion(): Promise<string> {
    return __APP_VERSION__;
  }

  async loadSettings(): Promise<string | null> {
    return storage()?.getItem(SETTINGS_KEY) ?? null;
  }

  async saveSettings(text: string): Promise<void> {
    storage()?.setItem(SETTINGS_KEY, text);
  }

  async defaultProjectsDir(): Promise<string> {
    return '/Documents/HErPlan';
  }

  async joinPath(...parts: string[]): Promise<string> {
    return join(...parts);
  }

  async pathStatus(path: string): Promise<PathStatus> {
    return this.status(path);
  }

  async createProject(dir: string, files: FileText[]): Promise<void> {
    const status = this.status(dir);
    if (status === 'non-empty-dir') fail('not-empty', 'folder is not empty', dir);
    if (status === 'file') fail('exists', 'a file with this name exists', dir);
    const targets = files.map((f) => [this.rel(dir, f.path), f.text] as const);
    for (const layout of LAYOUT) this.mkdir(join(dir, layout));
    for (const [path, text] of targets) this.fs.files[path] = text;
    this.save();
  }

  async readProject(dir: string): Promise<ProjectSnapshot> {
    this.requireProject(dir);
    const snapshot: ProjectSnapshot = { files: [], damaged: [], assets: [], removedTempFiles: 0 };
    const prefix = `${join(dir)}/`;
    for (const [path, content] of Object.entries(this.fs.files).sort(([a], [b]) => a.localeCompare(b))) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      const isData = rel === 'project.json' || (rel.startsWith('data/') && rel.endsWith('.json'));
      const isDocument = rel.startsWith('documents/') && rel.endsWith('.md');
      if (isData || isDocument) {
        if (content.length === 0) snapshot.damaged.push({ path: rel, reason: 'empty', detail: null });
        else snapshot.files.push({ path: rel, text: content });
      } else if (rel.startsWith('assets/')) {
        snapshot.assets.push({ path: rel, size: content.length, modifiedMs: 0 });
      }
    }
    return snapshot;
  }

  async readProjectFile(dir: string, path: string): Promise<string | null> {
    return this.fs.files[this.rel(dir, path)] ?? null;
  }

  async writeProject(dir: string, writes: FileText[], deletes: string[]): Promise<void> {
    this.requireProject(dir);
    const writeTargets = writes.map((f) => [this.rel(dir, f.path), f.text] as const);
    const deleteTargets = deletes.map((p) => this.rel(dir, p));
    for (const [path, text] of writeTargets) this.fs.files[path] = text;
    for (const path of deleteTargets) delete this.fs.files[path];
    this.save();
  }

  async importFile(dir: string, source: string, destDir: string): Promise<string> {
    const content = this.fs.files[join(source)];
    if (content === undefined) fail('not-found', 'file not found', source);
    const name = baseName(source);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = `${destDir}/${name}`;
    for (let n = 2; this.fs.files[this.rel(dir, candidate)] !== undefined; n++)
      candidate = `${destDir}/${stem} (${n})${ext}`;
    this.fs.files[this.rel(dir, candidate)] = content;
    this.save();
    return candidate;
  }

  async assetUrl(dir: string, path: string): Promise<string> {
    return this.fs.files[this.rel(dir, path)] ?? '';
  }

  async fileUrl(path: string): Promise<string> {
    return this.fs.files[join(path)] ?? '';
  }

  async createBackup(dir: string, kind: BackupKind, label: string | null): Promise<BackupInfo> {
    this.requireProject(dir);
    const now = new Date();
    const base = timestampName(now);
    let name = base;
    for (let n = 2; join(dir, 'backups', kind, `${name}.zip`) in this.fs.files; n++) name = `${base}-${n}`;
    const archive = this.writeArchive(this.projectFiles(dir));
    this.fs.files[join(dir, 'backups', kind, `${name}.zip`)] = archive;
    const createdAt = now.toISOString().replace(/\.\d+Z$/, 'Z');
    if (kind === 'manual') {
      this.fs.files[join(dir, 'backups', 'manual', `${name}.json`)] = JSON.stringify({ label, createdAt });
    }
    this.save();
    return { kind, name, createdAt, size: archive.length, label: kind === 'manual' ? label : null };
  }

  async listBackups(dir: string): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (const kind of ['auto', 'manual'] as const) {
      const prefix = `${join(dir, 'backups', kind)}/`;
      for (const [path, content] of Object.entries(this.fs.files)) {
        if (!path.startsWith(prefix) || !path.endsWith('.zip')) continue;
        const name = path.slice(prefix.length, -'.zip'.length);
        let label: string | null = null;
        let createdAt = name.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})Z.*$/, '$1:$2:$3Z');
        const sidecar = this.fs.files[join(dir, 'backups', kind, `${name}.json`)];
        if (sidecar) {
          const meta = JSON.parse(sidecar) as { label: string | null; createdAt: string };
          label = meta.label;
          createdAt = meta.createdAt;
        }
        out.push({ kind, name, createdAt, size: content.length, label });
      }
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  async pruneBackups(dir: string, keep: number | null): Promise<number> {
    if (keep === null) return 0;
    const autos = (await this.listBackups(dir)).filter((b) => b.kind === 'auto');
    const excess = autos.slice(keep);
    for (const backup of excess) delete this.fs.files[join(dir, 'backups', 'auto', `${backup.name}.zip`)];
    this.save();
    return excess.length;
  }

  async restoreBackup(dir: string, kind: BackupKind, name: string, safetyLabel: string): Promise<BackupInfo> {
    const files = this.readArchive(join(dir, 'backups', kind, `${name}.zip`));
    if (!('project.json' in files)) fail('bad-archive', 'backup has no project.json');
    const safety = await this.createBackup(dir, 'manual', safetyLabel);
    for (const rel of Object.keys(this.projectFiles(dir))) delete this.fs.files[join(dir, rel)];
    for (const [rel, content] of Object.entries(files)) this.fs.files[join(dir, rel)] = content;
    this.save();
    return safety;
  }

  async exportZip(dir: string, target: string): Promise<void> {
    this.requireProject(dir);
    this.fs.files[join(target)] = this.writeArchive(this.projectFiles(dir));
    this.save();
  }

  async importZip(source: string, targetDir: string): Promise<void> {
    this.extractInto(targetDir, this.readArchive(source));
  }

  async importFolder(source: string, targetDir: string): Promise<void> {
    this.requireProject(source);
    this.extractInto(targetDir, this.projectFiles(source));
  }

  async pickFolder(title: string, defaultPath?: string): Promise<string | null> {
    const answer = window.prompt(title, defaultPath ?? '/Documents/HErPlan');
    return answer ? join(answer) : null;
  }

  async pickFile(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
    const extensions = filters.flatMap((f) => f.extensions);
    // Archives and project folders are picked by path; images come from a real file chooser.
    if (!extensions.some((e) => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e))) {
      const answer = window.prompt(title, '');
      return answer ? join(answer) : null;
    }
    const file = await new Promise<File | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = extensions.map((e) => `.${e}`).join(',');
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!file) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const path = join('/Picked', file.name);
    this.fs.files[path] = dataUrl;
    this.save();
    return path;
  }

  async pickSaveFile(title: string, defaultPath: string): Promise<string | null> {
    const answer = window.prompt(title, defaultPath);
    return answer ? join(answer) : null;
  }

  async revealInExplorer(): Promise<void> {
    // Nothing to reveal in a browser.
  }

  async openUrl(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener');
  }

  async setUiScale(percent: number): Promise<void> {
    document.documentElement.style.zoom = String(percent / 100);
  }

  onWindowClose(handler: () => Promise<void>): void {
    // A page cannot wait on unload; in-memory writes finish synchronously, which is enough here.
    window.addEventListener('pagehide', () => void handler());
  }
}
