// The asset library's side of project data (F4-11, F4-12): where a file is used (entity pictures, image
// fields, chapter pictures, the project cover, pictures and links to files in documents, cards of the project
// map, links of tasks), keeping those references when a file or folder is renamed or moved, and folder colours
// in data/assets.json.

import type { JsonObject, ProjectData } from '../core/project/types';
import { asDocument, docName, listDocuments } from '../documents/model';
import { asEntity } from '../story/entities';
import { allGraphs, asStory } from '../story/model';
import { listBoards, moveTaskAssetLinks } from '../tasks/model';
import { cardFields, typesFile } from './schema';

export type AssetUse =
  | { kind: 'cover'; path: string }
  | { kind: 'entity'; path: string; entity: string; name: string }
  | { kind: 'field'; path: string; entity: string; name: string; field: string }
  | { kind: 'chapter'; path: string; graph: string; node: string; title: string }
  | { kind: 'document'; path: string; doc: string; name: string }
  | { kind: 'map'; path: string; graph: string; node: string }
  | { kind: 'task'; path: string; task: string; name: string };

/** Pictures in Markdown: ![alt](path) or ![alt](<path with spaces>). */
const IMAGE = /(!\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;

/** Paths of the pictures a document shows. */
export function imagesIn(body: string): string[] {
  return [...body.matchAll(IMAGE)].map((m) => m[2].replace(/^<|>$/g, ''));
}

/** Links of documents to files (0.5): `[[asset:<path>|…]]`, a link's place `|assets:<path>]]`, and their HTML form. */
const FILE_LINK = /(\[\[asset:)([^|\]\n]+)/g;
const FILE_PLACE = /(\|assets:)([^|\]\n]+)(?=\]\])/g;
const HTML_FILE = /((?:data-link="asset:|data-place="assets:))([^"]+)/g;
const unattr = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Files a document links to (not the pictures it shows: see imagesIn). */
export function fileLinksIn(body: string): string[] {
  return [
    ...[...body.matchAll(FILE_LINK)].map((m) => m[2]),
    ...[...body.matchAll(FILE_PLACE)].map((m) => m[2]),
    ...[...body.matchAll(HTML_FILE)].map((m) => unattr(m[2])),
  ];
}

/** A text with the paths of its pictures and file links changed; whole strings that are a path are changed too. */
export function moveInText(text: string, from: string, to: string): string {
  if (text === from || text.startsWith(`${from}/`)) return movedPath(text, from, to);
  let out = text;
  if (out.includes('![')) {
    out = out.replace(IMAGE, (all, start: string, path: string, end: string) => {
      const bare = path.replace(/^<|>$/g, '');
      if (!covers(from, bare)) return all;
      const moved = movedPath(bare, from, to);
      return `${start}${/[\s()<>]/.test(moved) ? `<${moved}>` : moved}${end}`;
    });
  }
  if (out.includes('asset')) {
    const move = (all: string, start: string, path: string) =>
      covers(from, path) ? `${start}${movedPath(path, from, to)}` : all;
    out = out
      .replace(FILE_LINK, move)
      .replace(FILE_PLACE, move)
      .replace(HTML_FILE, (all, start: string, path: string) =>
        covers(from, unattr(path)) ? `${start}${attr(movedPath(unattr(path), from, to))}` : all,
      );
  }
  return out;
}

/** Is `path` the asset itself, or inside the folder `target`. */
const covers = (target: string, path: string | null | undefined): path is string =>
  !!path && (path === target || path.startsWith(`${target}/`));

/** Every reference to an asset, or to anything inside a folder of assets. */
export function assetUses(data: ProjectData, target: string): AssetUse[] {
  const out: AssetUse[] = [];
  if (covers(target, data.meta.cover)) out.push({ kind: 'cover', path: data.meta.cover });
  const schema = typesFile(data);
  for (const raw of Object.values(data.entities)) {
    const e = asEntity(raw);
    if (!e) continue;
    if (covers(target, e.image)) out.push({ kind: 'entity', path: e.image, entity: e.id, name: e.name });
    for (const { field } of cardFields(schema, e)) {
      const v = e.values[field.id];
      if (field.type === 'image' && typeof v === 'string' && covers(target, v)) {
        out.push({ kind: 'field', path: v, entity: e.id, name: e.name, field: field.label });
      }
    }
  }
  for (const g of allGraphs(data)) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.kind === 'chapter' && covers(target, n.image)) {
        out.push({ kind: 'chapter', path: n.image, graph: g.id, node: n.id, title: n.title });
      }
      const ref = raw.ref as { kind?: string; id?: string } | undefined;
      if (g.kind === 'projectMap' && ref?.kind === 'asset' && covers(target, ref.id)) {
        out.push({ kind: 'map', path: ref.id, graph: g.id, node: raw.id });
      }
    }
  }
  for (const doc of listDocuments(data)) {
    for (const path of new Set([...imagesIn(doc.body), ...fileLinksIn(doc.body)])) {
      if (covers(target, path)) out.push({ kind: 'document', path, doc: doc.id, name: docName(doc.path) });
    }
  }
  for (const board of listBoards(data)) {
    for (const task of board.lists.flatMap((l) => l.tasks)) {
      for (const l of task.links) {
        if (l.kind === 'asset' && covers(target, l.id))
          out.push({ kind: 'task', path: l.id, task: task.id, name: task.title });
      }
    }
  }
  return out;
}

/** How many references each asset file has, for badges in the library. */
export function assetUseCounts(data: ProjectData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const u of assetUses(data, 'assets')) counts.set(u.path, (counts.get(u.path) ?? 0) + 1);
  return counts;
}

/** The path after `from` was renamed or moved to `to` (a file, or a folder with what is inside). */
export function movedPath(path: string, from: string, to: string): string {
  return path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/** Points every reference at the new place after a rename or move on disk (inside a Store recipe). */
export function moveAssetRefs(d: ProjectData, from: string, to: string): void {
  if (covers(from, d.meta.cover)) d.meta.cover = movedPath(d.meta.cover, from, to);
  const schema = typesFile(d);
  for (const raw of Object.values(d.entities)) {
    if (typeof raw.image === 'string' && covers(from, raw.image)) raw.image = movedPath(raw.image, from, to);
    const e = asEntity(raw);
    if (!e) continue;
    for (const { field } of cardFields(schema, e)) {
      const v = e.values[field.id];
      if (field.type === 'image' && typeof v === 'string' && covers(from, v)) {
        (raw.values as JsonObject)[field.id] = movedPath(v, from, to);
      }
    }
  }
  for (const g of allGraphs(d)) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.kind === 'chapter' && covers(from, n.image)) n.image = movedPath(n.image, from, to);
      const ref = raw.ref as { kind?: string; id?: string } | undefined;
      if (ref?.kind === 'asset' && covers(from, ref.id)) ref.id = movedPath(ref.id, from, to);
    }
  }
  for (const raw of Object.values(d.documents)) {
    const doc = asDocument(raw);
    if (doc && [...imagesIn(doc.body), ...fileLinksIn(doc.body)].some((p) => covers(from, p)))
      raw.body = moveInText(doc.body, from, to);
  }
  moveTaskAssetLinks(d, from, to);
  const folders = editableColors(d);
  for (const key of Object.keys(folders)) {
    if (!covers(from, key)) continue;
    const color = folders[key];
    delete folders[key];
    folders[movedPath(key, from, to)] = color;
  }
}

/** Colours of folders by path ("assets/world" → "#e8b931"). */
export function folderColors(data: Pick<ProjectData, 'assetMeta'>): Readonly<Record<string, string>> {
  const folders = (data.assetMeta as { folders?: unknown }).folders;
  return typeof folders === 'object' && folders !== null && !Array.isArray(folders)
    ? (folders as Record<string, string>)
    : {};
}

/** The same, to change inside a Store recipe. */
function editableColors(d: ProjectData): Record<string, string> {
  const meta = d.assetMeta as { folders?: unknown };
  if (typeof meta.folders !== 'object' || meta.folders === null || Array.isArray(meta.folders)) meta.folders = {};
  return meta.folders as Record<string, string>;
}

export function setFolderColor(d: ProjectData, folder: string, color: string | null): void {
  const folders = editableColors(d);
  if (color) folders[folder] = color;
  else delete folders[folder];
}

/** A deleted folder's colours go with it (inside a Store recipe). */
export function forgetFolder(d: ProjectData, path: string): void {
  const folders = editableColors(d);
  for (const key of Object.keys(folders)) if (covers(path, key)) delete folders[key];
}

/** The folder a path is in ("assets/a/b.png" → "assets/a"). */
export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/'))) || 'assets';

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
