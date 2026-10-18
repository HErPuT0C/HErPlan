import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupInfo } from '../../platform/types';
import { Store } from '../store';
import { BackupScheduler } from './backups';
import { newProject } from './create';
import type { ProjectData } from './types';

function setup(active = { value: true }) {
  const store = new Store<ProjectData>(newProject({ name: 'P', appVersion: '0.1.0' }));
  const events: string[] = [];
  const scheduler = new BackupScheduler(store, {
    flush: async () => {
      events.push('flush');
    },
    create: async () => {
      events.push('create');
      return { kind: 'auto', name: 'x', createdAt: '', size: 1, label: null } satisfies BackupInfo;
    },
    prune: async (keep) => {
      events.push(`prune:${keep}`);
      return 0;
    },
    isActive: () => active.value,
  });
  const change = () =>
    store.dispatch('edit', (d) => {
      d.meta.description += '.';
    });
  return { store, scheduler, events, change };
}

describe('automatic backups', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('copies after 10 minutes of work when something changed, then prunes by policy', async () => {
    const { scheduler, events, change } = setup();
    change();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toEqual(['flush', 'create', 'prune:50']);
    scheduler.dispose();
  });

  it('does nothing without changes', async () => {
    const { scheduler, events } = setup();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(events).toEqual([]);
    expect(await scheduler.backupIfChanged()).toBeNull();
    scheduler.dispose();
  });

  it('counts only minutes while the window is visible', async () => {
    const active = { value: false };
    const { scheduler, events, change } = setup(active);
    change();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(events).toEqual([]);
    active.value = true;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(events).toEqual(['flush', 'create', 'prune:50']);
    scheduler.dispose();
  });

  it('keeps all copies with the "all" policy and copies on close', async () => {
    const { store, scheduler, events, change } = setup();
    store.dispatch('policy', (d) => {
      d.meta.settings.backups.keep = 'all';
    });
    change();
    await scheduler.backupIfChanged();
    expect(events).toEqual(['flush', 'create', 'prune:null']);
    expect(await scheduler.backupIfChanged()).toBeNull();
    scheduler.dispose();
  });
});
