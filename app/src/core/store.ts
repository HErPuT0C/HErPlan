// Project state store: the single way to change project data.
//
// Every change is an Immer recipe. Immer records forward and inverse patches, which give us:
//   - undo/redo for any change without hand-written inverse operations;
//   - coalescing of rapid edits (typing) into one undo step via `mergeKey`;
//   - transactions that group several changes into one undo step;
//   - the exact paths that changed, so storage writes only the affected files (ADR-004).

import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  at: number;
}

export interface ChangeEvent {
  label: string;
  patches: Patch[];
  source: 'do' | 'undo' | 'redo';
}

export interface DispatchOptions {
  // Consecutive changes with the same key within `mergeWindowMs` become one undo step.
  mergeKey?: string;
  mergeWindowMs?: number;
  /**
   * False: not an undo step. For changes that follow something done outside the store which undo cannot
   * take back (a file renamed on disk: the references to it must stay with the file).
   */
  history?: boolean;
}

export class Store<S extends object> {
  private state: S;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private changeListeners = new Set<(e: ChangeEvent) => void>();
  private transaction: HistoryEntry | null = null;

  constructor(
    initial: S,
    private readonly limit = 500,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.state = initial;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Low-level change feed (patches) for storage, search indexes and backlinks. */
  onChange(listener: (e: ChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  dispatch(label: string, recipe: (draft: Draft<S>) => void, options: DispatchOptions = {}): void {
    const [next, patches, inverse] = produceWithPatches(this.state, recipe);
    if (patches.length === 0) return;
    this.state = next as S;

    if (options.history === false) {
      // Nothing to undo; steps recorded before stay valid only for paths this change did not touch.
    } else if (this.transaction) {
      this.transaction.patches.push(...patches);
      this.transaction.inverse.unshift(...inverse);
    } else {
      this.record(
        { label, patches, inverse, mergeKey: options.mergeKey, at: this.now() },
        options.mergeWindowMs ?? 1000,
      );
    }
    this.emit({ label, patches, source: 'do' });
  }

  /** Runs several dispatches as one undo step. Nested transactions join the outer one. */
  transact(label: string, fn: () => void): void {
    if (this.transaction) {
      fn();
      return;
    }
    const entry: HistoryEntry = { label, patches: [], inverse: [], at: this.now() };
    this.transaction = entry;
    try {
      fn();
    } catch (err) {
      // Roll back whatever the failed transaction already changed.
      this.state = applyPatches(this.state, entry.inverse);
      this.transaction = null;
      this.emit({ label, patches: entry.inverse, source: 'undo' });
      throw err;
    }
    this.transaction = null;
    if (entry.patches.length) this.record(entry, 0);
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.state = applyPatches(this.state, entry.inverse);
    this.redoStack.push(entry);
    this.emit({ label: entry.label, patches: entry.inverse, source: 'undo' });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.state = applyPatches(this.state, entry.patches);
    this.undoStack.push(entry);
    this.emit({ label: entry.label, patches: entry.patches, source: 'redo' });
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Rewrites text values in every recorded step, both ways. After a file was renamed on disk, steps recorded
   * earlier must not bring the old path back on undo or redo.
   */
  rewriteHistory(map: (text: string) => string): void {
    const deep = (v: unknown): unknown => {
      if (typeof v === 'string') return map(v);
      if (Array.isArray(v)) return v.map(deep);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
      return v;
    };
    const patch = (p: Patch): Patch => ('value' in p ? { ...p, value: deep(p.value) } : p);
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      entry.patches = entry.patches.map(patch);
      entry.inverse = entry.inverse.map(patch);
    }
  }

  /**
   * After a change made outside the history (`history: false`), steps recorded earlier that put back a whole
   * object containing `path` carry the current value there, so undoing and redoing them does not bring old
   * content back. Text typed in a document has its own undo in the editor; "undo creating the document, then
   * redo" must not lose that text.
   */
  refreshHistory(path: readonly (string | number)[]): void {
    let current: unknown = this.state;
    for (const key of path) current = (current as Record<string | number, unknown> | undefined)?.[key];
    const set = (target: unknown, rest: readonly (string | number)[]): unknown => {
      if (rest.length === 0) return structuredClone(current);
      if (!target || typeof target !== 'object') return target;
      const [key, ...more] = rest;
      return Array.isArray(target)
        ? target.map((v, i) => (i === key ? set(v, more) : v))
        : { ...target, [key]: set((target as Record<string | number, unknown>)[key], more) };
    };
    const refresh = (p: Patch): Patch => {
      const inside = p.path.length < path.length && p.path.every((k, i) => k === path[i]);
      return inside && 'value' in p ? { ...p, value: set(p.value, path.slice(p.path.length)) } : p;
    };
    for (const entry of [...this.undoStack, ...this.redoStack]) {
      entry.patches = entry.patches.map(refresh);
      entry.inverse = entry.inverse.map(refresh);
    }
  }

  /** Label of the step that undo would revert, for menus and tooltips. */
  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  private record(entry: HistoryEntry, mergeWindowMs: number): void {
    this.redoStack = [];
    const last = this.undoStack.at(-1);
    if (entry.mergeKey && last?.mergeKey === entry.mergeKey && entry.at - last.at <= mergeWindowMs) {
      last.patches.push(...entry.patches);
      last.inverse.unshift(...entry.inverse);
      last.at = entry.at;
      return;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  private emit(e: ChangeEvent): void {
    for (const l of this.changeListeners) l(e);
    for (const l of this.listeners) l();
  }
}
