import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileText } from '../../platform/types';
import { Store } from '../store';
import { Autosaver } from './autosave';
import { newProject } from './create';
import type { ProjectData } from './types';

interface Call {
  writes: FileText[];
  deletes: string[];
}

function setup(write?: (writes: FileText[], deletes: string[]) => Promise<void>) {
  const data = newProject({ name: 'P', appVersion: '0.1.0' });
  data.entities.old = { id: 'old' };
  const store = new Store<ProjectData>(data);
  const calls: Call[] = [];
  const saver = new Autosaver(store, {
    write:
      write ??
      (async (writes, deletes) => {
        calls.push({ writes, deletes });
      }),
    delayMs: () => 5000,
    existingFiles: ['data/entities/old.json'],
  });
  return { store, saver, calls };
}

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes only the changed files, within the interval of the first change', async () => {
    const { store, saver, calls } = setup();
    store.dispatch('rename', (d) => {
      d.meta.name = 'Мельница';
    });
    expect(saver.state.get().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(3000);
    store.dispatch('add', (d) => {
      d.entities.e1 = { id: 'e1', name: 'Мира' };
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1);
    expect(calls[0].writes.map((w) => w.path).sort()).toEqual(['data/entities/e1.json', 'project.json']);
    expect(JSON.parse(calls[0].writes.find((w) => w.path === 'project.json')!.text).name).toBe('Мельница');
    expect(saver.state.get().status).toBe('saved');
  });

  it('deletes the file of a removed object, and nothing for an object that never reached the disk', async () => {
    const { store, calls } = setup();
    store.dispatch('add', (d) => {
      d.entities.temp = { id: 'temp' };
    });
    store.dispatch('remove', (d) => {
      delete d.entities.temp;
      delete d.entities.old;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([{ writes: [], deletes: ['data/entities/old.json'] }]);
  });

  it('saves undo and redo like any other change', async () => {
    const { store, calls } = setup();
    store.dispatch('rename', (d) => {
      d.meta.name = 'A';
    });
    await vi.advanceTimersByTimeAsync(5000);
    store.undo();
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.parse(calls[1].writes[0].text).name).toBe('P');
  });

  it('handles a replaced collection by comparing with the disk', async () => {
    const { store, calls } = setup();
    store.dispatch('replace', (d) => {
      d.entities = { fresh: { id: 'fresh' } };
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls[0].writes.map((w) => w.path)).toEqual(['data/entities/fresh.json']);
    expect(calls[0].deletes).toEqual(['data/entities/old.json']);
  });

  it('keeps the changes after a failed write and retries', async () => {
    let fail = true;
    const written: string[][] = [];
    const { store, saver } = setup(async (writes) => {
      if (fail) throw { code: 'disk-full', message: 'no space', path: null };
      written.push(writes.map((w) => w.path));
    });
    store.dispatch('rename', (d) => {
      d.meta.name = 'A';
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(saver.state.get()).toMatchObject({ status: 'error', error: { code: 'disk-full' } });
    expect(saver.hasUnsavedChanges).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(written).toEqual([['project.json']]);
    expect(saver.state.get().status).toBe('saved');
  });

  it('flush writes immediately and reports a failure', async () => {
    const { store, saver, calls } = setup();
    store.dispatch('rename', (d) => {
      d.meta.name = 'Now';
    });
    await saver.flush();
    expect(calls).toHaveLength(1);
    expect(saver.hasUnsavedChanges).toBe(false);

    const failing = setup(async () => {
      throw new Error('boom');
    });
    failing.store.dispatch('rename', (d) => {
      d.meta.name = 'X';
    });
    await expect(failing.saver.flush()).rejects.toMatchObject({ code: 'io' });
  });

  it('a change during a running save is written by the next save', async () => {
    let release!: () => void;
    const paths: string[][] = [];
    const { store, saver } = setup(async (writes) => {
      paths.push(writes.map((w) => w.path));
      if (paths.length === 1) await new Promise<void>((r) => (release = r));
    });
    store.dispatch('a', (d) => {
      d.meta.name = 'A';
    });
    await vi.advanceTimersByTimeAsync(5000);
    store.dispatch('b', (d) => {
      d.entities.e2 = { id: 'e2' };
    });
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(paths).toEqual([['project.json'], ['data/entities/e2.json']]);
    expect(saver.state.get().status).toBe('saved');
  });
});
