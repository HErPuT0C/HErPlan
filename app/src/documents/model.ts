// Documents (F5-02, F5-05): Markdown files under documents/, in folders of the user's own. A document keeps
// its id in the front matter ("herplan-id"), so links to it survive a rename; files made elsewhere (Obsidian)
// without one get an id from their path until HErPlan writes them. Deleted documents wait in documents/.trash/
// (hidden in Obsidian) until the trash is emptied; empty folders are kept in data/documents.json.

import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';

export const DOCUMENTS_DIR = 'documents';
export const TRASH_DIR = `${DOCUMENTS_DIR}/.trash`;

export interface DocumentFile {
  id: string;
  /** Folder and name without ".md": "Мир/Диздок". For a document in the trash: where it was. */
  path: string;
  /** Markdown without the front matter. */
  body: string;
  /** Lines of the front matter HErPlan does not know, kept as they were (tags of Obsidian and so on). */
  front: string[];
  /** In the trash since this moment (ISO), or null. */
  trashedAt: string | null;
}

export const asDocument = (raw: unknown): DocumentFile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<DocumentFile>;
  if (typeof d.id !== 'string' || typeof d.path !== 'string') return null;
  return {
    id: d.id,
    path: d.path,
    body: typeof d.body === 'string' ? d.body : '',
    front: Array.isArray(d.front) ? d.front.filter((x): x is string => typeof x === 'string') : [],
    trashedAt: typeof d.trashedAt === 'string' ? d.trashedAt : null,
  };
};

export const docName = (path: string) => path.split('/').pop() ?? path;
export const docFolder = (path: string) => path.split('/').slice(0, -1).join('/');

/** The file of a document on disk. */
export function documentFilePath(doc: Pick<DocumentFile, 'id' | 'path' | 'trashedAt'>): string {
  return doc.trashedAt ? `${TRASH_DIR}/${doc.id}.md` : `${DOCUMENTS_DIR}/${doc.path}.md`;
}

// ---------- reading and writing files ----------

const quote = (s: string) => JSON.stringify(s);
const unquote = (s: string) => {
  const v = s.trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
};

/** Splits "---\n…\n---\n" off the start of a file. */
function splitFront(text: string): { lines: string[] | null; body: string } {
  const t = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t);
  if (!m) return { lines: null, body: t };
  return { lines: m[1].split(/\r?\n/), body: t.slice(m[0].length) };
}

/** A file read from disk (`path` relative to the project, "documents/…/x.md") as a document. */
export function readDocumentFile(path: string, text: string): DocumentFile {
  const { lines, body } = splitFront(text);
  let id: string | null = null;
  let from: string | null = null;
  let at: string | null = null;
  const front: string[] = [];
  for (const line of lines ?? []) {
    const m = /^(herplan-id|herplan-trashed-from|herplan-trashed-at):(.*)$/.exec(line);
    if (!m) front.push(line);
    else if (m[1] === 'herplan-id') id = unquote(m[2]);
    else if (m[1] === 'herplan-trashed-from') from = unquote(m[2]);
    else at = unquote(m[2]);
  }
  const inTrash = path.startsWith(`${TRASH_DIR}/`);
  const own = path.slice(DOCUMENTS_DIR.length + 1, -'.md'.length);
  return {
    id: id || `path:${own}`,
    path: inTrash ? from || docName(own) : own,
    body: body.replace(/\r\n/g, '\n'),
    front,
    trashedAt: inTrash ? at || new Date(0).toISOString() : null,
  };
}

/** The file of a document: the front matter with its id, then the Markdown. */
export function documentFileText(doc: DocumentFile): string {
  const front = [`herplan-id: ${doc.id}`];
  if (doc.trashedAt) front.push(`herplan-trashed-from: ${quote(doc.path)}`, `herplan-trashed-at: ${doc.trashedAt}`);
  front.push(...doc.front);
  const body = doc.body.endsWith('\n') || !doc.body ? doc.body : `${doc.body}\n`;
  return `---\n${front.join('\n')}\n---\n${body}`;
}

// ---------- the list of documents ----------

export function listDocuments(data: Pick<ProjectData, 'documents'>, trash = false): DocumentFile[] {
  return Object.values(data.documents)
    .map(asDocument)
    .filter((d): d is DocumentFile => !!d && !!d.trashedAt === trash)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/** data/documents.json: folders kept even when empty. */
export function documentFolders(data: Pick<ProjectData, 'documents' | 'documentMeta'>): string[] {
  const own = Array.isArray(data.documentMeta.folders)
    ? data.documentMeta.folders.filter((f): f is string => typeof f === 'string' && !!f)
    : [];
  const all = new Set<string>();
  const add = (folder: string) => {
    const parts = folder.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  };
  own.forEach(add);
  for (const d of listDocuments(data)) add(docFolder(d.path));
  return [...all].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** A name Windows accepts for a file or folder: no \ / : * ? " < > |, no dot or space at the end. */
export function cleanName(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex -- control characters are not allowed in Windows names
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
  );
}

const takenPaths = (data: Pick<ProjectData, 'documents'>, except?: string) =>
  new Set(
    listDocuments(data)
      .filter((d) => d.id !== except)
      .map((d) => d.path.toLowerCase()),
  );

/** `folder/name`, or `folder/name (2)`… when that is taken (Windows does not tell letter case apart). */
export function freePath(data: Pick<ProjectData, 'documents'>, folder: string, name: string, except?: string): string {
  const base = cleanName(name) || 'Document';
  const taken = takenPaths(data, except);
  const at = (n: string) => (folder ? `${folder}/${n}` : n);
  if (!taken.has(at(base).toLowerCase())) return at(base);
  for (let i = 2; ; i++) if (!taken.has(at(`${base} (${i})`).toLowerCase())) return at(`${base} (${i})`);
}

// ---------- changes (inside a Store recipe) ----------

export function addDocument(d: ProjectData, folder: string, name: string, body = ''): string {
  const id = newId();
  const doc: DocumentFile = { id, path: freePath(d, folder, name), body, front: [], trashedAt: null };
  d.documents[id] = doc as unknown as JsonObject;
  return id;
}

export function renameDocument(d: ProjectData, id: string, name: string): void {
  const doc = d.documents[id];
  if (!doc || typeof doc.path !== 'string') return;
  doc.path = freePath(d, docFolder(doc.path), name, id);
}

export function moveDocument(d: ProjectData, id: string, folder: string): void {
  const doc = d.documents[id];
  if (!doc || typeof doc.path !== 'string') return;
  doc.path = freePath(d, folder, docName(doc.path), id);
}

export function setBody(d: ProjectData, id: string, body: string): void {
  const doc = d.documents[id];
  if (doc) doc.body = body;
}

export function trashDocument(d: ProjectData, id: string, now = new Date()): void {
  const doc = d.documents[id];
  if (doc) doc.trashedAt = now.toISOString();
}

/** Back from the trash, to its folder (renamed if the name was taken meanwhile). */
export function restoreDocument(d: ProjectData, id: string): void {
  const doc = d.documents[id];
  if (!doc || typeof doc.path !== 'string') return;
  doc.trashedAt = null;
  doc.path = freePath(d, docFolder(doc.path), docName(doc.path), id);
}

export function deleteForever(d: ProjectData, id: string): void {
  delete d.documents[id];
}

const folderList = (d: ProjectData): string[] => {
  if (!Array.isArray(d.documentMeta.folders)) d.documentMeta.folders = [];
  return d.documentMeta.folders as string[];
};

export function addFolder(d: ProjectData, parent: string, name: string): string {
  const base = cleanName(name) || 'Folder';
  const existing = new Set(documentFolders(d).map((f) => f.toLowerCase()));
  const at = (n: string) => (parent ? `${parent}/${n}` : n);
  let path = at(base);
  for (let i = 2; existing.has(path.toLowerCase()); i++) path = at(`${base} (${i})`);
  folderList(d).push(path);
  return path;
}

/** Renames or moves a folder with everything inside it. */
export function moveFolder(d: ProjectData, from: string, to: string): void {
  if (!to || to === from || to.startsWith(`${from}/`)) return;
  const inside = (p: string) => p === from || p.startsWith(`${from}/`);
  const moved = (p: string) => to + p.slice(from.length);
  d.documentMeta.folders = folderList(d).map((f) => (inside(f) ? moved(f) : f));
  for (const raw of Object.values(d.documents)) {
    const doc = asDocument(raw);
    if (doc && !doc.trashedAt && inside(docFolder(doc.path))) raw.path = moved(doc.path);
  }
}

/** Deletes a folder: the documents inside go to the trash (and come back to the same folder). */
export function deleteFolder(d: ProjectData, folder: string, now = new Date()): void {
  const inside = (p: string) => p === folder || p.startsWith(`${folder}/`);
  d.documentMeta.folders = folderList(d).filter((f) => !inside(f));
  for (const raw of Object.values(d.documents)) {
    const doc = asDocument(raw);
    if (doc && !doc.trashedAt && inside(docFolder(doc.path))) raw.trashedAt = now.toISOString();
  }
}
