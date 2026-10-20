// The asset library's side of project data (F4-11, F4-12): where a file is used (entity pictures, image
// fields, chapter pictures, the project cover), keeping those references when a file or folder is renamed
// or moved, and folder colours in data/assets.json.

import type { JsonObject, ProjectData } from '../core/project/types';
import { asEntity } from '../story/entities';
import { allGraphs, asStory } from '../story/model';
import { effectiveFields, typesFile } from './schema';

export type AssetUse =
  | { kind: 'cover'; path: string }
  | { kind: 'entity'; path: string; entity: string; name: string }
  | { kind: 'field'; path: string; entity: string; name: string; field: string }
  | { kind: 'chapter'; path: string; graph: string; node: string; title: string };

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
    for (const { field } of effectiveFields(schema, e.type)) {
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
    for (const { field } of effectiveFields(schema, e.type)) {
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
    }
  }
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
