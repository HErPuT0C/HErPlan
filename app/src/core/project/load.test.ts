import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../platform/types';
import { newProject } from './create';
import { allFiles, fileContent, fileForPath } from './files';
import { loadProject } from './load';

function snapshotOf(files: { path: string; text: string }[], damaged: ProjectSnapshot['damaged'] = []) {
  return { files, damaged, assets: [], removedTempFiles: 0 } satisfies ProjectSnapshot;
}

describe('project files', () => {
  it('maps state paths to files', () => {
    expect(fileForPath(['meta', 'name'])).toBe('project.json');
    expect(fileForPath(['variables', 'variables', 0])).toBe('data/variables.json');
    expect(fileForPath(['entities', 'abc', 'name'])).toBe('data/entities/abc.json');
    expect(fileForPath(['entities'])).toBeNull();
    expect(fileForPath(['unknown'])).toBeNull();
  });

  it('creates, writes and reads back the same project', () => {
    const data = newProject({ name: '  Мельница ', appVersion: '0.1.0', now: new Date('2026-10-18T09:30:00.123Z') });
    data.entities.e1 = { id: 'e1', name: 'Мира' };
    const files = allFiles(data);
    expect(files.map((f) => f.path).sort()).toEqual([
      'data/entities/e1.json',
      'data/types.json',
      'data/variables.json',
      'project.json',
    ]);
    const meta = JSON.parse(files.find((f) => f.path === 'project.json')!.text);
    expect(meta).toMatchObject({ format: 'herplan-project', formatVersion: 1, name: 'Мельница' });
    expect(meta.createdAt).toBe('2026-10-18T09:30:00Z');
    expect(files.every((f) => f.text.endsWith('}\n'))).toBe(true);

    const result = loadProject(snapshotOf(files));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual(data);
    expect(result.issues).toEqual([]);
    expect(result.readOnly).toBe(false);
  });

  it('returns null content for a deleted object', () => {
    const data = newProject({ name: 'P', appVersion: '0.1.0' });
    expect(fileContent(data, 'data/entities/gone.json')).toBeNull();
    expect(fileContent(data, 'project.json')).toContain('"herplan-project"');
  });
});

describe('loading a project', () => {
  const meta = (extra: object = {}) =>
    JSON.stringify({ format: 'herplan-project', formatVersion: 1, id: 'p', name: 'P', ...extra });

  it('fills missing settings and keeps unknown fields', () => {
    const result = loadProject(snapshotOf([{ path: 'project.json', text: meta({ future: { a: 1 } }) }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.meta.settings.backups).toEqual({ keep: 50, intervalMinutes: 10 });
    expect(result.data.meta.settings.dialogueLimits).toEqual({ maxLines: 100, maxLineChars: 100 });
    expect(result.data.meta.future).toEqual({ a: 1 });
    expect(result.data.types).toEqual({ types: [], propertySets: [] });
  });

  it('accepts "all" as the backup policy and rejects nonsense', () => {
    const all = loadProject(
      snapshotOf([{ path: 'project.json', text: meta({ settings: { backups: { keep: 'all' } } }) }]),
    );
    const bad = loadProject(
      snapshotOf([{ path: 'project.json', text: meta({ settings: { backups: { keep: -3 } } }) }]),
    );
    expect(all.ok && all.data.meta.settings.backups.keep).toBe('all');
    expect(bad.ok && bad.data.meta.settings.backups.keep).toBe(50);
  });

  it('reports a damaged project.json', () => {
    expect(loadProject(snapshotOf([{ path: 'project.json', text: '{"format": "herpl' }]))).toMatchObject({
      ok: false,
      reason: 'project-json-damaged',
      issues: [{ path: 'project.json', kind: 'invalid-json' }],
    });
    expect(loadProject(snapshotOf([], [{ path: 'project.json', reason: 'empty', detail: null }]))).toMatchObject({
      ok: false,
      reason: 'project-json-damaged',
    });
  });

  it('refuses a folder that is not a HErPlan project', () => {
    expect(loadProject(snapshotOf([{ path: 'project.json', text: '{"name": "npm package"}' }]))).toMatchObject({
      ok: false,
      reason: 'not-herplan',
    });
  });

  it('skips damaged objects and lists them', () => {
    const result = loadProject(
      snapshotOf(
        [
          { path: 'project.json', text: meta() },
          { path: 'data/entities/ok.json', text: '{"id": "ok"}' },
          { path: 'data/entities/broken.json', text: '{"id": ' },
          { path: 'data/entities/list.json', text: '[1, 2]' },
        ],
        [{ path: 'data/graphs/g.json', reason: 'empty', detail: null }],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.entities)).toEqual(['ok']);
    expect(result.issues.map((i) => [i.path, i.kind])).toEqual([
      ['data/graphs/g.json', 'empty'],
      ['data/entities/broken.json', 'invalid-json'],
      ['data/entities/list.json', 'not-an-object'],
    ]);
  });

  it('opens a project from a newer version read-only', () => {
    const result = loadProject(snapshotOf([{ path: 'project.json', text: meta({ formatVersion: 7 }) }]));
    expect(result).toMatchObject({ ok: true, readOnly: true, formatVersion: 7 });
  });
});

describe('graphs edited by hand', () => {
  it('get missing arrays and coordinates, and lose parts that cannot be drawn', async () => {
    const { normalizeGraph } = await import('./load');
    const g = normalizeGraph({
      id: 'g',
      kind: 'story',
      nodes: [{ id: 'a', title: 'A' }, { title: 'no id' }, { id: 'b', x: 'oops', y: 10 }],
      edges: [
        { id: 'e1', from: { node: 'a', port: 'out' }, to: { node: 'b', port: 'in' } },
        { id: 'e2', from: 'a' },
      ],
    });
    expect(g.nodes).toEqual([
      { id: 'a', title: 'A', kind: 'node', x: 0, y: 0, w: 240, h: 120 },
      { id: 'b', title: '', kind: 'node', x: 0, y: 10, w: 240, h: 120 },
    ]);
    expect((g.edges as unknown[]).length).toBe(1);
    expect(g.groups).toEqual([]);
  });
});
