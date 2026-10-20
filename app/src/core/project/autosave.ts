// Autosave: changed files are written a few seconds after the first change (NFR-06: the loss after a crash
// is at most the autosave interval). Only the files touched by a change are written (ADR-004).
//
// Timing: the first change schedules a save `delayMs` later; further changes join that save instead of
// pushing it back, so continuous typing still saves every `delayMs`. A failed save keeps the files dirty
// and retries with a growing pause; the interface shows the error (disk full, no access) meanwhile.

import { atom, type Atom } from '../atom';
import type { Store } from '../store';
import type { FileText, PlatformError } from '../../platform/types';
import { isPlatformError } from '../../platform/types';
import { COLLECTIONS, DOC_PREFIX, documentWrite, fileContent, fileForPath, SINGLE_FILES } from './files';
import type { ProjectData } from './types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface SaveState {
  status: SaveStatus;
  lastSavedAt: number | null;
  error: PlatformError | null;
}

export interface AutosaverOptions {
  write: (writes: FileText[], deletes: string[]) => Promise<void>;
  delayMs: () => number;
  /** Files of collections that exist on disk (loaded successfully); needed to delete removed objects. */
  existingFiles: Iterable<string>;
  /** The file each document was read from, by document id; documents move when renamed. */
  documentPaths?: Record<string, string>;
  /** Called before every flush: editors that hold typed text put it into the store. */
  beforeFlush?: () => void;
  now?: () => number;
}

const MAX_RETRY_MS = 60_000;

export class Autosaver {
  readonly state: Atom<SaveState> = atom<SaveState>({ status: 'saved', lastSavedAt: null, error: null });
  private dirty = new Set<string>();
  private onDisk: Set<string>;
  /** Where each document is on disk now, by id. */
  private docPaths: Map<string, string>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private retryMs = 0;
  private unsubscribe: () => void;
  private disposed = false;

  constructor(
    private readonly store: Store<ProjectData>,
    private readonly options: AutosaverOptions,
  ) {
    this.onDisk = new Set(options.existingFiles);
    this.docPaths = new Map(Object.entries(options.documentPaths ?? {}));
    this.unsubscribe = store.onChange((e) => {
      for (const patch of e.patches) this.markPath(patch.path);
      this.schedule();
    });
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty.size > 0 || this.running !== null;
  }

  private markPath(path: readonly (string | number)[]): void {
    const file = fileForPath(path);
    if (file) {
      this.dirty.add(file);
      return;
    }
    // A whole collection (or the whole state) was replaced: compare everything with what is on disk.
    const roots = path.length === 0 ? Object.keys(COLLECTIONS) : [String(path[0])];
    if (path.length === 0) Object.values(SINGLE_FILES).forEach((f) => this.dirty.add(f));
    const data = this.store.getState();
    if (path.length === 0 || path[0] === 'documents') {
      for (const id of [...Object.keys(data.documents), ...this.docPaths.keys()]) this.dirty.add(`${DOC_PREFIX}${id}`);
    }
    for (const root of roots) {
      if (!(root in COLLECTIONS)) continue;
      const dir = COLLECTIONS[root as keyof typeof COLLECTIONS];
      for (const id of Object.keys(data[root as keyof typeof COLLECTIONS])) this.dirty.add(`${dir}/${id}.json`);
      for (const existing of this.onDisk) if (existing.startsWith(`${dir}/`)) this.dirty.add(existing);
    }
  }

  private schedule(delay = this.options.delayMs()): void {
    if (this.disposed || this.dirty.size === 0) return;
    if (this.state.get().status !== 'error') this.state.set((s) => ({ ...s, status: 'pending' }));
    if (this.timer !== null || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, delay);
  }

  /** Writes everything pending right now (closing the project, before a backup or export). */
  async flush(): Promise<void> {
    this.options.beforeFlush?.();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.running) await this.running;
    if (this.dirty.size > 0) await this.save();
    if (this.state.get().status === 'error') throw this.state.get().error;
  }

  private save(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.saveOnce().finally(() => {
      this.running = null;
      if (this.dirty.size > 0) this.schedule(this.state.get().status === 'error' ? this.retryMs : undefined);
    });
    return this.running;
  }

  private async saveOnce(): Promise<void> {
    const files = [...this.dirty];
    this.dirty.clear();
    const data = this.store.getState();
    const writes: FileText[] = [];
    const deletes: string[] = [];
    const moves = new Map<string, string | null>();
    for (const path of files) {
      if (path.startsWith(DOC_PREFIX)) {
        // A document: written where its name and folder say; the old file goes when it moved or was deleted.
        const id = path.slice(DOC_PREFIX.length);
        const file = documentWrite(data, id);
        const old = this.docPaths.get(id);
        if (file) writes.push(file);
        if (old && old !== file?.path) deletes.push(old);
        moves.set(id, file?.path ?? null);
        continue;
      }
      const text = fileContent(data, path);
      if (text !== null) writes.push({ path, text });
      else if (this.onDisk.has(path)) deletes.push(path);
    }
    // A file written for one document may be the old place of another (two documents swapped names).
    const written = new Set(writes.map((w) => w.path));
    for (let i = deletes.length - 1; i >= 0; i--) if (written.has(deletes[i])) deletes.splice(i, 1);
    if (writes.length === 0 && deletes.length === 0) {
      this.state.set((s) => ({ ...s, status: 'saved' }));
      return;
    }
    this.state.set((s) => ({ ...s, status: 'saving' }));
    try {
      await this.options.write(writes, deletes);
      for (const w of writes) if (isCollectionFile(w.path)) this.onDisk.add(w.path);
      for (const d of deletes) this.onDisk.delete(d);
      for (const [id, at] of moves) {
        if (at) this.docPaths.set(id, at);
        else this.docPaths.delete(id);
      }
      this.retryMs = 0;
      const now = this.options.now?.() ?? Date.now();
      this.state.set({ status: this.dirty.size > 0 ? 'pending' : 'saved', lastSavedAt: now, error: null });
    } catch (e) {
      // Put the files back; changes made during the failed write are already in `dirty`.
      files.forEach((f) => this.dirty.add(f));
      this.retryMs = Math.min(Math.max(this.retryMs * 2, this.options.delayMs(), 2000), MAX_RETRY_MS);
      const error: PlatformError = isPlatformError(e) ? e : { code: 'io', message: String(e), path: null };
      this.state.set((s) => ({ ...s, status: 'error', error }));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    if (this.timer !== null) clearTimeout(this.timer);
  }
}

function isCollectionFile(path: string): boolean {
  return Object.values(COLLECTIONS).some((dir) => path.startsWith(`${dir}/`));
}
