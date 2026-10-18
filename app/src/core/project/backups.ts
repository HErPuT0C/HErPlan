// Automatic copies (FR-SAV-04): every `intervalMinutes` minutes of work if something changed, and when the
// project is closed. A minute counts as work while the window is visible. Old automatic copies are pruned
// by the project's policy (keep the last N, or all); manual versions are never pruned.

import type { BackupInfo } from '../../platform/types';
import type { Store } from '../store';
import type { ProjectData } from './types';

export interface BackupSchedulerDeps {
  /** Writes pending autosave changes, so the copy holds the latest state. */
  flush: () => Promise<void>;
  create: () => Promise<BackupInfo>;
  prune: (keep: number | null) => Promise<number>;
  isActive: () => boolean;
  onError?: (error: unknown) => void;
}

const MINUTE = 60_000;

export class BackupScheduler {
  private changed = false;
  private workMinutes = 0;
  private timer: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private running: Promise<BackupInfo | null> | null = null;

  constructor(
    private readonly store: Store<ProjectData>,
    private readonly deps: BackupSchedulerDeps,
  ) {
    this.unsubscribe = store.onChange(() => {
      this.changed = true;
    });
    this.timer = setInterval(() => this.tick(), MINUTE);
  }

  private tick(): void {
    if (!this.deps.isActive()) return;
    this.workMinutes++;
    const { intervalMinutes } = this.store.getState().meta.settings.backups;
    if (this.changed && this.workMinutes >= intervalMinutes) void this.backup().catch((e) => this.deps.onError?.(e));
  }

  /** Makes an automatic copy now if anything changed since the last one; returns it, or null. */
  async backupIfChanged(): Promise<BackupInfo | null> {
    return this.changed ? this.backup() : null;
  }

  private backup(): Promise<BackupInfo | null> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<BackupInfo> {
    this.changed = false;
    this.workMinutes = 0;
    try {
      await this.deps.flush();
      const info = await this.deps.create();
      const { keep } = this.store.getState().meta.settings.backups;
      await this.deps.prune(keep === 'all' ? null : keep);
      return info;
    } catch (e) {
      this.changed = true;
      throw e;
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }
}
