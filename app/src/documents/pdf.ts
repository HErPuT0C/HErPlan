// PDF of a document (F5-07, ADR-006): pdfmake with Roboto (Cyrillic included), A4 with margins, page numbers,
// a table of contents when there are headings to list, no heading left alone at the bottom of a page. Links
// and live fields are printed as what they show now. The PDF reads nothing from the network.

import type { JSONContent } from '@tiptap/core';
import { TEXT_COLORS, type LinkKind } from './markdown';

export interface PdfWords {
  contents: string;
  page: (page: number, pages: number) => string;
}

export interface PdfInput {
  title: string;
  doc: JSONContent;
  words: PdfWords;
  /** Pictures as data URLs, by the path written in the document; missing ones are left out. */
  images: Map<string, string>;
  label: (kind: LinkKind, ref: string) => string | null;
  field: (entity: string, field: string) => string | null;
}

type Pdf = Record<string, unknown>;

const ACCENT = '#1d5fd1';
const MUTED = '#5b6270';
const LINE = '#c4c9d2';
/** Margins of 2 cm, as the editor's sheets (0.7.4). */
const MARGIN = 57;
const PAGE_WIDTH = 595 - 2 * MARGIN; // A4 minus the margins

function runs(nodes: JSONContent[] | undefined, input: PdfInput): Pdf[] {
  const out: Pdf[] = [];
  for (const n of nodes ?? []) {
    const style: Pdf = {};
    const decorations: string[] = [];
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') style.bold = true;
      if (m.type === 'italic') style.italics = true;
      if (m.type === 'underline') decorations.push('underline');
      if (m.type === 'strike') decorations.push('lineThrough');
      if (m.type === 'code') style.background = '#eef0f3';
      if (m.type === 'textColor') style.color = TEXT_COLORS[String(m.attrs?.color)] ?? undefined;
      if (m.type === 'link') {
        style.link = String(m.attrs?.href ?? '');
        style.color = ACCENT;
      }
    }
    // pdfmake draws one decoration per piece of text: underline wins over strike-through.
    if (decorations.length) style.decoration = decorations[0];
    if (n.type === 'text') out.push({ text: n.text ?? '', ...style });
    else if (n.type === 'hardBreak') out.push({ text: '\n' });
    else if (n.type === 'objectLink') {
      const a = (n.attrs ?? {}) as { kind: LinkKind; ref: string; label: string };
      out.push({ text: input.label(a.kind, a.ref) ?? a.label ?? '', color: ACCENT, ...style });
    } else if (n.type === 'liveField') {
      const a = (n.attrs ?? {}) as { entity: string; field: string };
      out.push({ text: input.field(a.entity, a.field) ?? '', ...style });
    }
  }
  // An empty paragraph keeps its line.
  return out.length ? out : [{ text: ' ' }];
}

function blocks(nodes: JSONContent[] | undefined, input: PdfInput): Pdf[] {
  return (nodes ?? []).map((n) => block(n, input)).filter((b): b is Pdf => b !== null);
}

function block(n: JSONContent, input: PdfInput): Pdf | null {
  switch (n.type) {
    case 'heading': {
      const level = Math.min(3, Number(n.attrs?.level) || 1);
      return {
        text: runs(n.content, input),
        style: `h${level}`,
        headlineLevel: level,
        tocItem: level <= 2,
        tocMargin: [(level - 1) * 14, 0, 0, 2],
      };
    }
    case 'paragraph':
      return { text: runs(n.content, input), style: 'p' };
    case 'bulletList':
    case 'orderedList': {
      const items = (n.content ?? []).map((item) => ({ stack: blocks(item.content, input) }));
      return n.type === 'orderedList'
        ? { ol: items, start: Number(n.attrs?.start) || 1, style: 'list' }
        : { ul: items, style: 'list' };
    }
    case 'blockquote':
      return {
        table: { widths: ['*'], body: [[{ stack: blocks(n.content, input), color: MUTED }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: (i: number) => (i === 0 ? 3 : 0),
          vLineColor: () => ACCENT,
          paddingLeft: () => 12,
        },
        margin: [0, 4, 0, 10],
      };
    case 'codeBlock':
      return {
        table: {
          widths: ['*'],
          body: [
            [{ text: (n.content ?? []).map((t) => t.text ?? '').join(''), fontSize: 9.5, preserveLeadingSpaces: true }],
          ],
        },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#eef0f3', paddingLeft: () => 8 },
        margin: [0, 4, 0, 10],
      };
    case 'table': {
      const rows = (n.content ?? []).map((row) =>
        (row.content ?? []).map((cell) => ({ stack: blocks(cell.content, input) })),
      );
      const columns = Math.max(0, ...rows.map((r) => r.length));
      if (!columns) return null;
      const body = rows.map((r, i) =>
        Array.from({ length: columns }, (_, c) => ({
          ...(r[c] ?? { text: '' }),
          ...(i === 0 ? { bold: true, fillColor: '#eef0f3' } : {}),
        })),
      );
      return {
        table: { headerRows: 1, widths: Array.from({ length: columns }, () => '*'), body, dontBreakRows: true },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 12],
      };
    }
    case 'horizontalRule':
      return {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH, y2: 0, lineWidth: 0.5, lineColor: LINE }],
        margin: [0, 8, 0, 8],
      };
    // A page break (0.7.4): what follows starts a new page.
    case 'pageBreak':
      return { text: '', pageBreak: 'after' };
    case 'image': {
      const data = input.images.get(String(n.attrs?.src ?? ''));
      return data ? { image: data, fit: [PAGE_WIDTH, 360], alignment: 'center', margin: [0, 6, 0, 10] } : null;
    }
    default:
      return n.content ? { stack: blocks(n.content, input) } : null;
  }
}

/** The description of the PDF for pdfmake (a plain object; tested without drawing it). */
export function pdfDefinition(input: PdfInput): Pdf {
  const body = blocks(input.doc.content, input);
  // A page break at the very end would leave an empty page.
  while (body.at(-1)?.pageBreak) body.pop();
  const headings = body.filter((b) => b.tocItem).length;
  return {
    info: { title: input.title, creator: 'HErPlan' },
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 14, 0, 8] },
      h2: { fontSize: 15, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
      p: { margin: [0, 0, 0, 7] },
      list: { margin: [0, 0, 0, 8] },
      tocTitle: { fontSize: 16, bold: true, margin: [0, 0, 0, 10] },
    },
    footer: (page: number, pages: number) => ({
      text: input.words.page(page, pages),
      alignment: 'center',
      fontSize: 8.5,
      color: MUTED,
      margin: [0, 24, 0, 0],
    }),
    // A heading never stays the last thing on a page.
    pageBreakBefore: (
      node: { headlineLevel?: number },
      ctx: { getFollowingNodesOnPage: () => { headlineLevel?: number }[] },
    ) => Boolean(node.headlineLevel) && ctx.getFollowingNodesOnPage().filter((x) => !x.headlineLevel).length === 0,
    // Contents only when there is something to list; it shares the first page with the text.
    content: [
      ...(headings >= 2
        ? [
            { toc: { title: { text: input.words.contents, style: 'tocTitle' } } },
            {
              canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_WIDTH, y2: 0, lineWidth: 0.5, lineColor: LINE }],
              margin: [0, 10, 0, 10],
            },
          ]
        : []),
      ...body,
    ],
  };
}

interface PdfMake {
  addVirtualFileSystem(vfs: unknown): void;
  setUrlAccessPolicy(policy: (url: string) => boolean): void;
  createPdf(definition: Pdf): { getBuffer(): Promise<Uint8Array> };
}

let maker: Promise<PdfMake> | null = null;

/** pdfmake and its fonts are loaded on the first export only: they are large. */
function pdfMake(): Promise<PdfMake> {
  maker ??= Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]).then(([lib, fonts]) => {
    const m = ((lib as { default?: unknown }).default ?? lib) as PdfMake;
    m.addVirtualFileSystem((fonts as { default?: unknown }).default ?? fonts);
    m.setUrlAccessPolicy(() => false);
    return m;
  });
  return maker;
}

export async function renderPdf(input: PdfInput): Promise<Uint8Array> {
  const m = await pdfMake();
  const buffer = await m.createPdf(pdfDefinition(input)).getBuffer();
  return new Uint8Array(buffer);
}
