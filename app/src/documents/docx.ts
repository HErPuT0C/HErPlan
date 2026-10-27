// A document as Word (.docx, 0.7.4): headings Word knows as headings (its navigation pane and contents work),
// paragraphs with their bold, italic, underline, strike-through, colour and font, lists, quotes, code, tables,
// pictures, rules and page breaks; A4 with margins of 2 cm and page numbers. Links to project objects and live
// fields are written as what they show now; web links stay links.

import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { TEXT_COLORS, type LinkKind } from './markdown';

export interface DocxPicture {
  /** PNG or JPEG bytes (other pictures are drawn into PNG before). */
  data: Uint8Array;
  type: 'png' | 'jpg';
  width: number;
  height: number;
}

export interface DocxInput {
  title: string;
  doc: JSONContent;
  /** "Page {page} of {pages}" cut where the numbers go: the words before, between and after them. */
  page: [string, string, string];
  pictures: Map<string, DocxPicture>;
  label: (kind: LinkKind, ref: string) => string | null;
  field: (entity: string, field: string) => string | null;
}

const ACCENT = '1D5FD1';
const MUTED = '5B6270';
const LINE = 'C4C9D2';
const CODE = 'EEF0F3';
/** A4 with margins of 2 cm, in twentieths of a point; the text is 17 cm wide, 642 pixels. */
const A4 = { width: 11906, height: 16838, margin: 1134 };
const TEXT_PX = 642;
const FONTS: Record<string, string> = { serif: 'Times New Roman', mono: 'Consolas' };

interface Style {
  bold?: boolean;
  italics?: boolean;
  underline?: Record<string, never>;
  strike?: boolean;
  color?: string;
  font?: string;
  shading?: { type: (typeof ShadingType)[keyof typeof ShadingType]; fill: string; color: string };
}

function runs(nodes: JSONContent[] | undefined, input: DocxInput, base: Style = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    const style: Style = { ...base };
    let href: string | null = null;
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') style.bold = true;
      if (m.type === 'italic') style.italics = true;
      if (m.type === 'underline') style.underline = {};
      if (m.type === 'strike') style.strike = true;
      if (m.type === 'textColor') {
        const color = TEXT_COLORS[String(m.attrs?.color)];
        if (color) style.color = color.replace('#', '');
      }
      if (m.type === 'textFont') style.font = FONTS[String(m.attrs?.font)];
      if (m.type === 'code') {
        style.font = FONTS.mono;
        style.shading = { type: ShadingType.CLEAR, fill: CODE, color: 'auto' };
      }
      if (m.type === 'link') href = String(m.attrs?.href ?? '');
    }
    let text: string | null = null;
    if (n.type === 'text') text = n.text ?? '';
    else if (n.type === 'objectLink') {
      const a = (n.attrs ?? {}) as { kind: LinkKind; ref: string; label: string };
      text = input.label(a.kind, a.ref) ?? a.label ?? '';
      style.color ??= ACCENT;
    } else if (n.type === 'liveField') {
      const a = (n.attrs ?? {}) as { entity: string; field: string };
      text = input.field(a.entity, a.field) ?? '';
    } else if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (text === null || text === '') continue;
    if (href)
      out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text, ...style, style: 'Hyperlink' })] }));
    else out.push(new TextRun({ text, ...style }));
  }
  return out;
}

type Block = Paragraph | Table;

interface Context {
  /** Depth of lists, for the indent of their items. */
  level: number;
  /** Lists met so far: each numbered list counts from 1. */
  lists: { count: number };
  quote: boolean;
}

function picture(n: JSONContent, input: DocxInput): Paragraph | null {
  const pic = input.pictures.get(String(n.attrs?.src ?? ''));
  if (!pic) return null;
  const scale = Math.min(1, TEXT_PX / pic.width, 480 / pic.height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 160 },
    children: [
      new ImageRun({
        type: pic.type,
        data: pic.data,
        transformation: { width: Math.round(pic.width * scale), height: Math.round(pic.height * scale) },
        altText: { name: String(n.attrs?.alt ?? ''), description: String(n.attrs?.alt ?? ''), title: '' },
      }),
    ],
  });
}

function blocks(nodes: JSONContent[] | undefined, input: DocxInput, ctx: Context): Block[] {
  const quote = ctx.quote
    ? {
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
      }
    : {};
  const muted: Style = ctx.quote ? { color: MUTED } : {};
  return (nodes ?? []).flatMap((n): Block[] => {
    switch (n.type) {
      case 'heading': {
        const level = Math.min(3, Number(n.attrs?.level) || 1);
        const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
        return [new Paragraph({ heading, keepNext: true, children: runs(n.content, input) })];
      }
      case 'paragraph':
        return [new Paragraph({ ...quote, children: runs(n.content, input, muted) })];
      case 'bulletList':
      case 'orderedList': {
        const instance = n.type === 'orderedList' ? ++ctx.lists.count : 0;
        return (n.content ?? []).flatMap((item) =>
          (item.content ?? []).flatMap((child, i) => {
            if (child.type === 'paragraph' && i === 0)
              return [
                new Paragraph({
                  numbering: {
                    reference: n.type === 'orderedList' ? 'numbers' : 'bullets',
                    level: Math.min(ctx.level, 8),
                    ...(instance ? { instance } : {}),
                  },
                  children: runs(child.content, input, muted),
                }),
              ];
            return blocks([child], input, { ...ctx, level: ctx.level + 1 });
          }),
        );
      }
      case 'blockquote':
        return blocks(n.content, input, { ...ctx, quote: true });
      case 'codeBlock':
        return (n.content ?? [])
          .map((t) => t.text ?? '')
          .join('')
          .split('\n')
          .map(
            (line) =>
              new Paragraph({
                shading: { type: ShadingType.CLEAR, fill: CODE, color: 'auto' },
                spacing: { after: 0 },
                children: [new TextRun({ text: line, font: FONTS.mono, size: 19 })],
              }),
          );
      case 'table': {
        const rows = n.content ?? [];
        const columns = Math.max(0, ...rows.map((r) => r.content?.length ?? 0));
        if (!columns) return [];
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows.map(
              (row, r) =>
                new TableRow({
                  tableHeader: r === 0,
                  children: Array.from({ length: columns }, (_, c) => {
                    const cell = row.content?.[c];
                    const inner = blocks(cell?.content, input, { ...ctx, quote: false });
                    return new TableCell({
                      width: { size: Math.floor(100 / columns), type: WidthType.PERCENTAGE },
                      ...(r === 0 ? { shading: { type: ShadingType.CLEAR, fill: CODE, color: 'auto' } } : {}),
                      children: inner.length ? inner : [new Paragraph('')],
                    });
                  }),
                }),
            ),
          }),
          new Paragraph(''),
        ];
      }
      case 'horizontalRule':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 1 } } })];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'image': {
        const p = picture(n, input);
        return p ? [p] : [];
      }
      default:
        return n.content ? blocks(n.content, input, ctx) : [];
    }
  });
}

const indent = (level: number) => ({ paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } });

/** The Word document as an object (tested without packing it). */
export function docxDocument(input: DocxInput): Document {
  // A page break at the very end would leave an empty page.
  const content = [...(input.doc.content ?? [])];
  while (content.at(-1)?.type === 'pageBreak') content.pop();
  const body = blocks(content, input, { level: 0, lists: { count: 0 }, quote: false });
  const [before, middle, after] = input.page;
  return new Document({
    title: input.title,
    creator: 'HErPlan',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } },
        heading1: {
          run: { size: 36, bold: true, color: '000000' },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading2: {
          run: { size: 30, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading3: {
          run: { size: 25, bold: true, color: '000000' },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪'][level % 3],
            alignment: AlignmentType.LEFT,
            style: indent(level),
          })),
        },
        {
          reference: 'numbers',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: indent(level),
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height },
            margin: { top: A4.margin, bottom: A4.margin, left: A4.margin, right: A4.margin },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [before, PageNumber.CURRENT, middle, PageNumber.TOTAL_PAGES, after],
                    size: 17,
                    color: MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        children: body.length ? body : [new Paragraph('')],
      },
    ],
  });
}

export async function renderDocx(input: DocxInput): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toArrayBuffer(docxDocument(input)));
}
