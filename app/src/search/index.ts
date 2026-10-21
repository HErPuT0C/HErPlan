// The project-wide search (F6-06, FR-PRJ-05, NFR-08): every object of the project by a part of its name or
// of its description, anywhere in the word, without regard to case; names rank above descriptions. The
// index is rebuilt from what changed only: items of an unchanged object (the same object in the immutable
// state) are taken from a cache.

import type { JsonObject, ProjectData } from '../core/project/types';
import { searchKey } from '../canvas/ops';
import { asDocument, docFolder, docName } from '../documents/model';
import { asEntity } from '../story/entities';
import { graphTitle } from '../story/flow';
import { asStory, type StoryNode } from '../story/model';
import { fullName, listVariables } from '../story/variables';
import { asBoard } from '../tasks/model';
import { typesFile } from '../world/schema';

export type SearchKind = 'entity' | 'chapter' | 'document' | 'task' | 'node' | 'asset' | 'variable' | 'tag';

/** Kinds in the order their results are listed when they match equally well. */
export const SEARCH_KINDS: readonly SearchKind[] = [
  'entity',
  'chapter',
  'document',
  'task',
  'node',
  'asset',
  'variable',
  'tag',
];

export interface SearchItem {
  kind: SearchKind;
  /** What opens it: an entity id, a graph id, "<graph>/<node>", a document id, a task id, a path, a variable
   * id, "<catalog>/<tag>". */
  id: string;
  name: string;
  /** The text searched besides the name (description, the text of a node or a document). */
  text: string;
  /** Where it is, for the list: an entity's type id, a node's graph, a document's folder, a task's board… */
  where: string;
  nameKey: string;
  textKey: string;
}

export interface SearchHit {
  item: SearchItem;
  /** 0 — the name starts with the query, 1 — a word of the name does, 2 — the name has it, 3 — the text has it. */
  rank: 0 | 1 | 2 | 3;
  /** Where the text matched (rank 3), for an excerpt. */
  at: number;
}

const item = (kind: SearchKind, id: string, name: string, text: string, where: string): SearchItem => ({
  kind,
  id,
  name,
  text,
  where,
  nameKey: searchKey(name),
  textKey: searchKey(text),
});

/** Text of a document without its markup: what a reader sees. */
export function plainText(body: string): string {
  return body
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[[^|\]\n]+\|([^|\]\n]*)(?:\|[^\]\n]*)?\]\]/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/&#?\w+;/g, ' ')
    .replace(/[#*_`>~|\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const nodeText = (n: StoryNode) =>
  [n.text ?? '', ...(n.lines ?? []).map((l) => l.text ?? ''), ...(n.options ?? []).map((o) => o.text ?? '')]
    .filter(Boolean)
    .join(' ');

/** Items of one object, cached while the object is the same. */
const cache = new WeakMap<object, SearchItem[]>();
function cached(raw: object, make: () => SearchItem[]): SearchItem[] {
  let items = cache.get(raw);
  if (!items) {
    items = make();
    cache.set(raw, items);
  }
  return items;
}

/** Everything that can be found, but files of the assets (they are on disk: see `assets`). */
export function searchIndex(data: ProjectData, assets: readonly string[] = []): SearchItem[] {
  const out: SearchItem[] = [];
  for (const raw of Object.values(data.entities)) {
    out.push(
      ...cached(raw, () => {
        const e = asEntity(raw);
        return e ? [item('entity', e.id, e.name, e.description, e.type)] : [];
      }),
    );
  }
  const graphs = Object.values(data.graphs) as (JsonObject & { id: string; kind?: string; nodes?: JsonObject[] })[];
  for (const g of graphs) {
    if (g.kind === 'chapter') out.push(item('chapter', g.id, graphTitle(data, g.id), '', ''));
  }
  for (const raw of Object.values(data.documents)) {
    out.push(
      ...cached(raw, () => {
        const d = asDocument(raw);
        return d && !d.trashedAt ? [item('document', d.id, docName(d.path), plainText(d.body), docFolder(d.path))] : [];
      }),
    );
  }
  for (const raw of Object.values(data.boards)) {
    out.push(
      ...cached(raw, () => {
        const b = asBoard(raw);
        return (b?.lists ?? []).flatMap((l) =>
          l.tasks.map((x) =>
            item(
              'task',
              x.id,
              x.title,
              [x.description, ...x.checklist.map((c) => c.text)].join(' '),
              `${b!.name} · ${l.name}`,
            ),
          ),
        );
      }),
    );
  }
  for (const g of graphs) {
    if (g.kind !== 'story' && g.kind !== 'chapter') continue;
    out.push(
      ...cached(g, () =>
        (g.nodes ?? [])
          .map((raw) => asStory(raw as never))
          .filter((n) => n.kind !== 'sticker' && n.kind !== 'chapter' && (n.title || nodeText(n)))
          .map((n) => item('node', `${g.id}/${n.id}`, n.title ?? '', nodeText(n), g.id)),
      ),
    );
  }
  for (const path of assets) out.push(item('asset', path, path.slice(path.lastIndexOf('/') + 1), '', docFolder(path)));
  for (const v of listVariables(data)) out.push(item('variable', v.id, fullName(v, data), v.description ?? '', ''));
  for (const c of typesFile(data).catalogs) {
    for (const tag of c.tags) out.push(item('tag', `${c.id}/${tag.id}`, tag.name, tag.description, c.name));
  }
  return out;
}

const WORD_START = /[\s\-_.,:;!?«»"'()[\]/]/;

/** The best matches first: names that start with the query, then words of names, names, texts. */
export function search(index: readonly SearchItem[], query: string, limit = 50): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const ranks: SearchHit[][] = [[], [], [], []];
  for (const it of index) {
    const at = it.nameKey.indexOf(q);
    if (at === 0) ranks[0].push({ item: it, rank: 0, at: -1 });
    else if (at > 0) {
      const word =
        WORD_START.test(it.nameKey[at - 1]) ||
        // A word inside the name that starts further on: "Старая мельница" for "мель".
        it.nameKey.split(WORD_START).some((w) => w.startsWith(q));
      ranks[word ? 1 : 2].push({ item: it, rank: word ? 1 : 2, at: -1 });
    } else if (ranks[0].length + ranks[1].length + ranks[2].length < limit) {
      const t = it.textKey.indexOf(q);
      if (t >= 0) ranks[3].push({ item: it, rank: 3, at: t });
    }
  }
  const byKind = (a: SearchHit, b: SearchHit) =>
    SEARCH_KINDS.indexOf(a.item.kind) - SEARCH_KINDS.indexOf(b.item.kind) || a.item.name.length - b.item.name.length;
  return ranks.flatMap((r) => r.sort(byKind)).slice(0, limit);
}

/** A piece of text around where it matched, for the list of results. */
export function excerpt(text: string, at: number, length: number, width = 80): string {
  if (at < 0 || !text) return '';
  const from = Math.max(0, at - Math.floor((width - length) / 2));
  const to = Math.min(text.length, from + width);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}
