// Links from documents to project objects (F5-04): read from the Markdown text, so "where used" and the
// backlinks of a document need no index of their own and stay right after any change.

import type { ProjectData } from '../core/project/types';
import type { LinkKind } from './markdown';
import { listDocuments, type DocumentFile } from './model';

export interface DocLink {
  kind: LinkKind;
  ref: string;
  /** A live field of an entity (`{{ent:id.field}}`) rather than a link. */
  field?: string;
  /** Where a click leads, when not to the object's own place (see places.ts). */
  place?: string;
}

const LINK = /\[\[(ent|node|doc|asset):([^|\]\n]+)(?:\|[^|\]\n]*)?(?:\|([^|\]\n]+))?\]\]/g;
const FIELD = /\{\{ent:([^.}\s]+)\.([^}\s]+)\}\}/g;
const HTML_LINK = /data-link="(ent|node|doc|asset):([^"]+)"(?: data-place="([^"]+)")?/g;
const HTML_FIELD = /data-field="([^".]+)\.([^"]+)"/g;

/** Text of an HTML attribute as written by the Markdown save. */
const unattr = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** Every link and live field in a document's text, in order, repeated ones included. */
export function linksIn(body: string): DocLink[] {
  const out: DocLink[] = [];
  for (const m of body.matchAll(LINK))
    out.push({ kind: m[1] as LinkKind, ref: m[2], ...(m[3] ? { place: m[3] } : {}) });
  for (const m of body.matchAll(HTML_LINK))
    out.push({ kind: m[1] as LinkKind, ref: unattr(m[2]), ...(m[3] ? { place: unattr(m[3]) } : {}) });
  for (const m of body.matchAll(FIELD)) out.push({ kind: 'ent', ref: m[1], field: m[2] });
  for (const m of body.matchAll(HTML_FIELD)) out.push({ kind: 'ent', ref: m[1], field: m[2] });
  return out;
}

/** Documents (not in the trash) that link to an object or show a field of it, with how many times. */
export function documentsLinkingTo(
  data: Pick<ProjectData, 'documents'>,
  kind: LinkKind,
  ref: string,
): { doc: DocumentFile; count: number }[] {
  return listDocuments(data)
    .map((doc) => ({ doc, count: linksIn(doc.body).filter((l) => l.kind === kind && l.ref === ref).length }))
    .filter((x) => x.count > 0);
}
