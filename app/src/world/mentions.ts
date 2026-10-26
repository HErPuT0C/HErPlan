// Names in descriptions (0.7.3): a description of a card or a tag that names another card or a tag of a
// catalog shows that name as a link to it. Nothing is stored: the names are found in the plain text each
// time, so a renamed card is found under its new name and a deleted one is no longer a link.

import type { ProjectData } from '../core/project/types';
import { listEntities, type WorldEntity } from '../story/entities';
import { typesFile } from './schema';

export type MentionTarget =
  { kind: 'entity'; id: string; name: string } | { kind: 'tag'; id: string; catalog: string; name: string };

export interface Mention {
  start: number;
  end: number;
  target: MentionTarget;
}

/** Names shorter than this are not looked for: one letter would turn half of a text into links. */
const MIN_LENGTH = 2;

/** One character as it is compared: case and "ё" do not matter; the length stays (offsets stay right). */
function fold(c: string): string {
  const lower = c.toLocaleLowerCase();
  if (lower.length !== c.length) return c;
  return lower === 'ё' ? 'е' : lower;
}

const foldText = (text: string) => Array.from(text, fold).join('');

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);

/** Every card and every tag that can be named, cards first (a card wins over a tag of the same name). */
export function mentionTargets(data: Pick<ProjectData, 'entities' | 'types'>): MentionTarget[] {
  const out: MentionTarget[] = [];
  for (const e of listEntities(data)) if (e.name.trim()) out.push({ kind: 'entity', id: e.id, name: e.name.trim() });
  for (const c of typesFile(data).catalogs)
    for (const tag of c.tags)
      if (tag.name.trim()) out.push({ kind: 'tag', id: tag.id, catalog: c.id, name: tag.name.trim() });
  return out;
}

export interface MentionIndex {
  /** Names by their first folded character, longest first. */
  byFirst: Map<string, { name: string; target: MentionTarget }[]>;
}

export function mentionIndex(targets: readonly MentionTarget[]): MentionIndex {
  const byFirst = new Map<string, { name: string; target: MentionTarget }[]>();
  const seen = new Set<string>();
  for (const target of targets) {
    const name = foldText(target.name);
    if (name.length < MIN_LENGTH || seen.has(name)) continue;
    seen.add(name);
    const list = byFirst.get(name[0]) ?? [];
    list.push({ name, target });
    byFirst.set(name[0], list);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.name.length - a.name.length);
  return { byFirst };
}

const sameTarget = (a: MentionTarget, b: MentionTarget) => a.kind === b.kind && a.id === b.id;

/**
 * The names in `text`, as whole words, not overlapping, the longest one where several start at the same
 * place ("Old Yan" before "Yan"). `self` (the card or tag the text belongs to) is not a link to itself.
 */
export function findMentions(text: string, index: MentionIndex, self?: MentionTarget): Mention[] {
  const folded = foldText(text);
  const out: Mention[] = [];
  for (let i = 0; i < folded.length; i++) {
    if (isWord(folded[i - 1])) continue;
    const candidates = index.byFirst.get(folded[i]);
    if (!candidates) continue;
    const hit = candidates.find(
      (c) =>
        folded.startsWith(c.name, i) && !isWord(folded[i + c.name.length]) && !(self && sameTarget(c.target, self)),
    );
    if (!hit) continue;
    out.push({ start: i, end: i + hit.name.length, target: hit.target });
    i += hit.name.length - 1;
  }
  return out;
}

/**
 * All a card says about itself, for finding it by more than its name: the description, the values of its
 * fields (tags and linked cards by their names) and its relations.
 */
export function entitySearchText(data: Pick<ProjectData, 'entities' | 'types'>, e: WorldEntity): string {
  const names = new Map<string, string>();
  for (const x of listEntities(data)) names.set(x.id, x.name);
  for (const c of typesFile(data).catalogs) for (const tag of c.tags) names.set(tag.id, tag.name);
  const parts: string[] = [e.description];
  const add = (v: unknown): void => {
    if (typeof v === 'string') parts.push(names.get(v) ?? v);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(String(v));
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  Object.values(e.values).forEach(add);
  for (const r of e.relations) parts.push(r.label, names.get(r.to.id) ?? '', r.description);
  return parts.filter(Boolean).join('\n');
}
