// Markdown export for Obsidian (F5-08): every document as a note in its folder, and the cards of the world
// database as notes of their own, so links between them work. Links to cards and documents become Obsidian
// links ([[Folder/Note|Label]]), links to story nodes and files their titles, live fields their current values.

import type { ProjectData } from '../core/project/types';
import type { FileText } from '../platform/types';
import { asEntity, listEntities } from '../story/entities';
import { relationsOf } from '../world/entityOps';
import { cardFields, typesFile } from '../world/schema';
import { coerceValue, isEmptyValue } from '../world/values';
import { linkLabel, fieldText } from './lookups';
import type { LinkKind } from './markdown';
import { cleanName, listDocuments } from './model';

export interface ExportWords {
  /** Folder of the cards ("Карточки"). */
  cards: string;
  fields: string;
  relations: string;
  untitled: string;
  /** The name of a type for its folder. */
  typeName: (typeId: string) => string;
}

/** Text put into Markdown as plain text: characters that would mean formatting are escaped. */
const plain = (text: string) => text.replace(/([\\`*_[\]~<>|])/g, '\\$1').replace(/\n/g, ' ');
/** A label of an Obsidian link: no "|" or "]" in it. */
const label = (text: string) => text.replace(/[|\]\n]/g, ' ').trim();

export function obsidianExport(data: ProjectData, words: ExportWords): FileText[] {
  const docs = listDocuments(data);
  const docFolders = new Set(docs.map((d) => d.path.split('/')[0].toLowerCase()));
  let cardsDir = cleanName(words.cards) || 'Cards';
  for (let i = 2; docFolders.has(cardsDir.toLowerCase()); i++) cardsDir = `${cleanName(words.cards)} (${i})`;

  // A note for every card, unique within its type's folder.
  const notes = new Map<string, string>();
  const taken = new Set<string>();
  for (const e of listEntities(data)) {
    const folder = `${cardsDir}/${cleanName(words.typeName(e.type)) || 'Type'}`;
    const base = cleanName(e.name) || words.untitled;
    let path = `${folder}/${base}`;
    for (let i = 2; taken.has(path.toLowerCase()); i++) path = `${folder}/${base} (${i})`;
    taken.add(path.toLowerCase());
    notes.set(e.id, path);
  }
  const docPath = new Map(docs.map((d) => [d.id, d.path]));

  const link = (kind: string, ref: string, shown: string): string => {
    const text = label(shown);
    const target = kind === 'ent' ? notes.get(ref) : kind === 'doc' ? docPath.get(ref) : undefined;
    return target ? `[[${target}|${text || target.split('/').pop()}]]` : plain(text);
  };
  const current = (kind: string, ref: string, stored: string) => linkLabel(data, kind as LinkKind, ref) ?? stored;

  // Where a link leads in the editor (a place) means nothing in Obsidian: the link goes to the note.
  const convert = (body: string) =>
    body
      .replace(
        /\[\[(ent|node|doc|asset):([^|\]\n]+)(?:\|([^|\]\n]*))?(?:\|[^|\]\n]+)?\]\]/g,
        (_, kind: string, ref: string, stored = '') => link(kind, ref, current(kind, ref, stored)),
      )
      .replace(
        /<span data-link="(ent|node|doc|asset):([^"]+)"(?: data-place="[^"]*")?>([^<]*)<\/span>/g,
        (_, kind: string, ref: string, stored: string) => link(kind, ref, current(kind, ref, stored)),
      )
      .replace(/\{\{ent:([^.}\s]+)\.([^}\s]+)\}\}/g, (_, entity: string, field: string) =>
        plain(fieldText(data, entity, field) ?? ''),
      )
      .replace(/<span data-field="([^".]+)\.([^"]+)"><\/span>/g, (_, entity: string, field: string) =>
        plain(fieldText(data, entity, field) ?? ''),
      );

  const files: FileText[] = docs.map((d) => ({
    path: `${d.path}.md`,
    text: (d.front.length ? `---\n${d.front.join('\n')}\n---\n` : '') + convert(d.body),
  }));

  const schema = typesFile(data);
  for (const e of listEntities(data)) {
    const lines = [`# ${plain(e.name || words.untitled)}`, '', `*${plain(words.typeName(e.type))}*`, ''];
    if (e.description.trim()) lines.push(plain(e.description), '');
    const values = cardFields(schema, e)
      .map(({ field }) => ({ field, v: coerceValue(field, e.values[field.id]) }))
      .filter(({ field, v }) => !isEmptyValue(v) && field.type !== 'table');
    if (values.length) {
      lines.push(`## ${words.fields}`, '');
      for (const { field } of values) {
        const v = coerceValue(field, e.values[field.id]);
        const shown =
          field.type === 'ref'
            ? link('ent', v as string, linkLabel(data, 'ent', v as string) ?? '')
            : field.type === 'refList'
              ? (v as string[]).map((id) => link('ent', id, linkLabel(data, 'ent', id) ?? '')).join(', ')
              : field.type === 'image'
                ? `![](${String(v)})`
                : plain(fieldText(data, e.id, field.id) ?? '');
        lines.push(`- **${plain(field.label)}:** ${shown}`);
      }
      lines.push('');
    }
    const relations = relationsOf(data, e.id);
    if (relations.length) {
      lines.push(`## ${words.relations}`, '');
      for (const r of relations) {
        const other = asEntity(data.entities[r.other]);
        lines.push(`- ${plain(r.label || '—')}: ${link('ent', r.other, other?.name ?? '')}`);
      }
      lines.push('');
    }
    files.push({ path: `${notes.get(e.id)}.md`, text: `${lines.join('\n').trimEnd()}\n` });
  }
  return files;
}
