import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { Autosaver } from '../core/project/autosave';
import { newProject } from '../core/project/create';
import { allFiles } from '../core/project/files';
import { loadProject } from '../core/project/load';
import type { ProjectData } from '../core/project/types';
import { Store } from '../core/store';
import type { FileText } from '../platform/types';
import {
  addDocument,
  addFolder,
  asDocument,
  deleteFolder,
  documentFileText,
  documentFolders,
  listDocuments,
  moveDocument,
  moveFolder,
  readDocumentFile,
  renameDocument,
  restoreDocument,
  trashDocument,
} from './model';

const empty = () => newProject({ name: 'P', appVersion: '0.4.0', now: new Date(0) });

describe('document files (F5-02, F5-05)', () => {
  it('keeps the id and unknown front matter; files from elsewhere get an id from their path', () => {
    const doc = readDocumentFile('documents/Мир/Диздок.md', '---\nherplan-id: d1\ntags: [мир]\n---\n# Диздок\n');
    expect(doc).toMatchObject({
      id: 'd1',
      path: 'Мир/Диздок',
      body: '# Диздок\n',
      front: ['tags: [мир]'],
      trashedAt: null,
    });
    expect(documentFileText(doc)).toBe('---\nherplan-id: d1\ntags: [мир]\n---\n# Диздок\n');
    expect(readDocumentFile('documents/Заметка.md', 'просто текст')).toMatchObject({
      id: 'path:Заметка',
      body: 'просто текст',
    });
    const trashed = readDocumentFile(
      'documents/.trash/d2.md',
      '---\nherplan-id: d2\nherplan-trashed-from: "Мир/Старое"\nherplan-trashed-at: 2026-10-20T10:00:00.000Z\n---\nx\n',
    );
    expect(trashed).toMatchObject({ id: 'd2', path: 'Мир/Старое', trashedAt: '2026-10-20T10:00:00.000Z' });
  });

  it('names stay unique in a folder; folders move with what is inside; deleted folders go to the trash', () => {
    let a = '';
    let b = '';
    const data = produce(empty(), (d) => {
      a = addDocument(d, 'Мир', 'Диздок');
      b = addDocument(d, 'Мир', 'диздок');
      addFolder(d, '', 'Пусто');
    });
    expect(asDocument(data.documents[b])!.path).toBe('Мир/диздок (2)');
    expect(documentFolders(data)).toEqual(['Мир', 'Пусто']);

    const moved = produce(data, (d) => moveFolder(d, 'Мир', 'Пусто/Мир'));
    expect(listDocuments(moved).map((x) => x.path)).toEqual(['Пусто/Мир/Диздок', 'Пусто/Мир/диздок (2)']);

    const gone = produce(moved, (d) => deleteFolder(d, 'Пусто'));
    expect(listDocuments(gone)).toEqual([]);
    expect(listDocuments(gone, true)).toHaveLength(2);
    const back = produce(gone, (d) => restoreDocument(d, a));
    expect(asDocument(back.documents[a])!.path).toBe('Пусто/Мир/Диздок');
    expect(documentFolders(back)).toEqual(['Пусто', 'Пусто/Мир']);
  });

  it('a project with documents survives writing and reading; renames and the trash move files', async () => {
    let id = '';
    const store = new Store<ProjectData>(
      produce(empty(), (d) => {
        id = addDocument(d, 'Мир', 'Диздок', '# Диздок\n');
      }),
    );
    const disk = new Map(allFiles(store.getState()).map((f) => [f.path, f.text]));
    expect(disk.get('documents/Мир/Диздок.md')).toContain('herplan-id: ');
    const read = loadProject({
      files: [...disk].map(([path, text]) => ({ path, text })),
      damaged: [],
      assets: [],
      removedTempFiles: 0,
    });
    if (!read.ok) throw new Error('not loaded');
    expect(asDocument(read.data.documents[id])!.body).toBe('# Диздок\n');

    const writes: FileText[][] = [];
    const deletes: string[][] = [];
    const saver = new Autosaver(store, {
      write: async (w, d) => {
        writes.push(w);
        deletes.push(d);
      },
      delayMs: () => 1,
      existingFiles: [],
      documentPaths: read.documentPaths,
    });
    store.dispatch('rename', (d) => renameDocument(d, id, 'Дизайн'));
    await saver.flush();
    expect(writes.at(-1)!.map((w) => w.path)).toEqual(['documents/Мир/Дизайн.md']);
    expect(deletes.at(-1)).toEqual(['documents/Мир/Диздок.md']);

    store.dispatch('move', (d) => moveDocument(d, id, ''));
    store.dispatch('trash', (d) => trashDocument(d, id));
    await saver.flush();
    expect(writes.at(-1)!.map((w) => w.path)).toEqual([`documents/.trash/${id}.md`]);
    expect(deletes.at(-1)).toEqual(['documents/Мир/Дизайн.md']);
    saver.dispose();
  });

  it('an empty Markdown file is an empty document, not a damaged file', () => {
    const disk = allFiles(empty());
    const read = loadProject({
      files: disk,
      damaged: [{ path: 'documents/Пусто.md', reason: 'empty', detail: null }],
      assets: [],
      removedTempFiles: 0,
    });
    if (!read.ok) throw new Error('not loaded');
    expect(read.issues).toEqual([]);
    expect(listDocuments(read.data).map((d) => d.path)).toEqual(['Пусто']);
  });
});
