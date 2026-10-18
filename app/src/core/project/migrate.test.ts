import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../platform/types';
import { applyMigrations, MIGRATIONS, planMigrations, readFormatVersion, type Migration } from './migrate';

const snapshot = (files: Record<string, string>): ProjectSnapshot => ({
  files: Object.entries(files).map(([path, text]) => ({ path, text })),
  damaged: [],
  assets: [],
  removedTempFiles: 0,
});

// A made-up history: v1 stored characters in data/characters.json, v2 split them into one file each,
// v3 renamed "title" to "name". The real registry is empty while v1 is the only format.
const registry: Migration[] = [
  {
    from: 1,
    to: 2,
    run: (files) => {
      const out = new Map(files);
      const list = JSON.parse(out.get('data/characters.json') ?? '[]') as { id: string; title: string }[];
      out.delete('data/characters.json');
      for (const c of list) out.set(`data/entities/${c.id}.json`, `${JSON.stringify(c, null, 2)}\n`);
      return out;
    },
  },
  {
    from: 2,
    to: 3,
    run: (files) => {
      const out = new Map(files);
      for (const [path, text] of files) {
        if (!path.startsWith('data/entities/')) continue;
        const { title, ...rest } = JSON.parse(text) as { title: string };
        out.set(path, `${JSON.stringify({ ...rest, name: title }, null, 2)}\n`);
      }
      return out;
    },
  },
];

describe('format migrations', () => {
  it('has no real migrations while format v1 is the only one', () => {
    expect(MIGRATIONS).toEqual([]);
    expect(planMigrations(1)).toEqual([]);
  });

  it('plans a chain and refuses a gap', () => {
    expect(planMigrations(1, 3, registry)?.map((m) => m.to)).toEqual([2, 3]);
    expect(planMigrations(2, 3, registry)).toHaveLength(1);
    expect(planMigrations(0, 3, registry)).toBeNull();
  });

  it('migrates an old project step by step and lists writes and deletes', () => {
    const old = snapshot({
      'project.json': JSON.stringify({ format: 'herplan-project', formatVersion: 1, name: 'Old' }),
      'data/characters.json': JSON.stringify([{ id: 'mira', title: 'Мира' }]),
      'data/types.json': '{"types": []}\n',
    });
    expect(readFormatVersion(old)).toBe(1);
    const result = applyMigrations(old, planMigrations(1, 3, registry)!);
    expect(result.deletes).toEqual(['data/characters.json']);
    const written = Object.fromEntries(result.writes.map((w) => [w.path, JSON.parse(w.text)]));
    expect(written['project.json']).toMatchObject({ formatVersion: 3, name: 'Old' });
    expect(written['data/entities/mira.json']).toEqual({ id: 'mira', name: 'Мира' });
    expect(written['data/types.json']).toBeUndefined();
  });

  it('reads no version from a damaged project.json', () => {
    expect(readFormatVersion(snapshot({ 'project.json': '{' }))).toBeNull();
    expect(readFormatVersion(snapshot({}))).toBeNull();
  });
});
