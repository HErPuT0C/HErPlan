// Documents are Markdown files (ADR-003, ADR-004). This module holds the editor's schema (TipTap extensions)
// and the self-checking save (F5-10): every top-level block is written as ordinary Markdown, read back and
// compared; a block that would not come back the same is written again with its formatting as HTML tags
// (<strong>, <em>, <s>, <u>, <a>), which the reader takes back exactly. Underline is always <u>: Markdown has
// no underline and Obsidian reads the tag.

import {
  elementFromString,
  getSchema,
  Mark,
  Node,
  type AnyExtension,
  type JSONContent,
  type MarkdownToken,
} from '@tiptap/core';
import { DOMParser as PmDOMParser, Node as PmNode, type Schema } from '@tiptap/pm/model';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Strike from '@tiptap/extension-strike';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import Heading from '@tiptap/extension-heading';
import Paragraph from '@tiptap/extension-paragraph';
import StarterKit from '@tiptap/starter-kit';

// ---------- what embeds show ----------

/** What a link points at: a card, a story node, a document, or (since 0.5) a file of the assets. */
export type LinkKind = 'ent' | 'node' | 'doc' | 'asset';

/** Names and values the embeds show; the interface sets it to read the open project. */
export interface EmbedLookup {
  /** Text of a link: an entity's name, a node's title, a document's title; null when it is gone. */
  linkLabel(kind: LinkKind, ref: string): string | null;
  /** Current value of a field of an entity as text ("name", "description" or a field id); null when gone. */
  fieldText(entity: string, field: string): string | null;
  /** A tooltip of a link: where a click on it leads. */
  linkHint?(kind: LinkKind, ref: string, place: string): string;
}

let lookup: EmbedLookup = { linkLabel: () => null, fieldText: () => null };
const listeners = new Set<() => void>();

export function setEmbedLookup(next: EmbedLookup): void {
  lookup = next;
  written.clear();
  listeners.forEach((f) => f());
}
export const embedLookup = (): EmbedLookup => lookup;
/** Called whenever the lookup changes (the project's data changed): live embeds redraw. */
export function onEmbedLookup(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** How the editor shows a picture of the project ("assets/…" → a URL the window can load). */
let assetUrl: (path: string) => Promise<string> = async (path) => path;
export function setAssetResolver(f: (path: string) => Promise<string>): void {
  assetUrl = f;
}

/** An embed in the editor: its text follows the project as it changes. */
function liveView(
  className: string,
  attrName: string,
  value: (attrs: Record<string, string>) => string,
  text: (attrs: Record<string, string>) => string,
  hint?: (attrs: Record<string, string>) => string,
) {
  return ({ node }: { node: { attrs: Record<string, string>; type: { name: string } } }) => {
    let attrs = node.attrs;
    const dom = document.createElement('span');
    dom.className = `doc-embed ${className}`;
    dom.setAttribute(attrName, value(attrs));
    const draw = () => {
      const shown = text(attrs);
      dom.textContent = shown || '?';
      dom.classList.toggle('doc-embed-missing', !shown);
      if (attrs.place) dom.dataset.place = attrs.place;
      else delete dom.dataset.place;
      if (hint) dom.title = hint(attrs);
    };
    draw();
    const stop = onEmbedLookup(draw);
    return {
      dom,
      update: (next: { attrs: Record<string, string>; type: { name: string } }) => {
        if (next.type.name !== node.type.name) return false;
        attrs = next.attrs;
        dom.setAttribute(attrName, value(attrs));
        draw();
        return true;
      },
      destroy: stop,
    };
  };
}

// ---------- marks written as HTML when Markdown is ambiguous ----------

/** True while a block is written in "safe" form: marks as HTML tags. */
let htmlMarks = false;

const SafeBold = Bold.extend({
  renderMarkdown: (node, h) =>
    htmlMarks ? `<strong>${h.renderChildren(node)}</strong>` : `**${h.renderChildren(node)}**`,
});
const SafeItalic = Italic.extend({
  renderMarkdown: (node, h) => (htmlMarks ? `<em>${h.renderChildren(node)}</em>` : `*${h.renderChildren(node)}*`),
});
const SafeStrike = Strike.extend({
  renderMarkdown: (node, h) => (htmlMarks ? `<s>${h.renderChildren(node)}</s>` : `~~${h.renderChildren(node)}~~`),
});

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const SafeLink = Link.extend({
  renderMarkdown: (node, h) => {
    const href = String(node.attrs?.href ?? '');
    return htmlMarks || /[\s()<>]/.test(href)
      ? `<a href="${attr(href)}">${h.renderChildren(node)}</a>`
      : `[${h.renderChildren(node)}](${href})`;
  },
}).configure({ openOnClick: false, autolink: false, linkOnPaste: true });

/** Underline: <u>…</u> always ("++text++" is not Markdown and Obsidian shows it as is). */
const HtmlUnderline = Mark.create({
  name: 'underline',
  parseHTML: () => [
    { tag: 'u' },
    { style: 'text-decoration', getAttrs: (v) => (v.includes('underline') ? {} : false) },
  ],
  renderHTML: () => ['u', 0],
  renderMarkdown: (node, h) => `<u>${h.renderChildren(node)}</u>`,
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleMark(this.name) };
  },
});

/** Colours a text can have: names kept in the file, so the palette can change without touching documents. */
export const TEXT_COLORS: Record<string, string> = {
  red: '#d64545',
  orange: '#d9822b',
  green: '#2f9e5b',
  blue: '#3b74d1',
  violet: '#7b5cd6',
  grey: '#7a8190',
};
export type TextFont = 'serif' | 'mono';

const FONT_FACES: Record<TextFont, string> = { serif: 'serif', mono: 'monospace' };

/** `<font color face>`: a tag no embed uses, so it can hold links and fields (the reader does not count nesting). */
function fontTag(color: string | null, font: string | null, inner: string): string {
  const attrs = [
    color ? ` color="${attr(color)}"` : '',
    font ? ` face="${attr(FONT_FACES[font as TextFont] ?? font)}"` : '',
  ].join('');
  return attrs ? `<font${attrs}>${inner}</font>` : inner;
}

/** Colour of text: `<font color="red">` in the file (Obsidian shows it coloured too). */
const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: 'red' } }),
  parseHTML: () => [
    {
      tag: 'font[color]',
      // The same tag may carry the font as well.
      consuming: false,
      getAttrs: (el) => {
        const color = (el as HTMLElement).getAttribute('color') ?? '';
        return color in TEXT_COLORS ? { color } : false;
      },
    },
  ],
  renderHTML: ({ mark }) => [
    'span',
    { 'data-color': mark.attrs.color, style: `color: ${TEXT_COLORS[String(mark.attrs.color)] ?? 'inherit'}` },
    0,
  ],
  renderMarkdown: (node, h) => fontTag(String(node.attrs?.color ?? ''), null, h.renderChildren(node)),
});

/** Font of text: `<font face="serif">` or `<font face="monospace">`; the document's own font is the default. */
const TextFontMark = Mark.create({
  name: 'textFont',
  addAttributes: () => ({ font: { default: 'serif' } }),
  parseHTML: () => [
    {
      tag: 'font[face]',
      consuming: false,
      getAttrs: (el) => {
        const face = (el as HTMLElement).getAttribute('face');
        return face === 'serif' ? { font: 'serif' } : face === 'monospace' ? { font: 'mono' } : false;
      },
    },
  ],
  renderHTML: ({ mark }) => ['span', { 'data-font': mark.attrs.font, class: `doc-font-${mark.attrs.font}` }, 0],
  renderMarkdown: (node, h) => fontTag(null, String(node.attrs?.font ?? ''), h.renderChildren(node)),
});

// ---------- embeds: links to objects and live fields ----------

const MARK_SYNTAX: Record<string, [string, string, string, string]> = {
  bold: ['**', '**', '<strong>', '</strong>'],
  italic: ['*', '*', '<em>', '</em>'],
  strike: ['~~', '~~', '<s>', '</s>'],
  underline: ['<u>', '</u>', '<u>', '</u>'],
};

/** The serializer writes marks around text only; an embed writes its own marks around itself. */
function withMarks(node: JSONContent, text: string): string {
  let out = text;
  for (const m of node.marks ?? []) {
    const syntax = MARK_SYNTAX[m.type];
    if (syntax) out = htmlMarks ? syntax[2] + out + syntax[3] : syntax[0] + out + syntax[1];
  }
  return out;
}

const LINK_RE = /^\[\[(ent|node|doc|asset):([^|\]\n]+)(?:\|([^|\]\n]*))?(?:\|([^|\]\n]+))?\]\]/;
const FIELD_RE = /^\{\{ent:([^.}\s]+)\.([^}\s]+)\}\}/;

/** Label for the file: what the object is called now, or the label read from the file when it is gone. */
const labelFor = (kind: LinkKind, ref: string, stored: string) =>
  (lookup.linkLabel(kind, ref) ?? stored).replace(/[|\]\n]/g, ' ');

/**
 * `[[ent:<id>|Name]]`, `[[node:<graph>/<node>|Title]]`, `[[doc:<id>|Title]]`, `[[asset:<path>|file.png]]` — a link
 * to a project object. Since 0.5 a third part says where a click leads when the object is in several places:
 * `[[ent:<id>|Name|map:<node>]]` opens the card on the project map instead of the database (see places.ts).
 */
export const ObjectLink = Node.create({
  name: 'objectLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'ent' }, ref: { default: '' }, label: { default: '' }, place: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-link]',
        getAttrs: (el) => {
          const [kind, ...rest] = ((el as HTMLElement).dataset.link ?? '').split(':');
          return {
            kind,
            ref: rest.join(':'),
            label: (el as HTMLElement).textContent ?? '',
            place: (el as HTMLElement).dataset.place ?? '',
          };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const { kind, ref, label, place } = node.attrs as { kind: LinkKind; ref: string; label: string; place: string };
    return [
      'span',
      { 'data-link': `${kind}:${ref}`, ...(place ? { 'data-place': place } : {}), class: 'doc-embed doc-link' },
      labelFor(kind, ref, label),
    ];
  },
  addNodeView() {
    return liveView(
      'doc-link',
      'data-link',
      (a) => `${a.kind}:${a.ref}`,
      (a) => lookup.linkLabel(a.kind as LinkKind, a.ref) ?? '',
      (a) => lookup.linkHint?.(a.kind as LinkKind, a.ref, a.place ?? '') ?? '',
    ) as never;
  },
  markdownTokenizer: {
    name: 'objectLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const m = LINK_RE.exec(src);
      if (!m) return undefined;
      return {
        type: 'objectLink',
        raw: m[0],
        kind: m[1],
        ref: m[2],
        label: m[3] ?? '',
        place: m[4] ?? '',
      } as MarkdownToken;
    },
  },
  parseMarkdown: (token, h) =>
    h.createNode('objectLink', { kind: token.kind, ref: token.ref, label: token.label, place: token.place ?? '' }),
  renderMarkdown: (node) => {
    const { kind, ref, label, place } = (node.attrs ?? {}) as {
      kind: LinkKind;
      ref: string;
      label: string;
      place?: string;
    };
    return withMarks(
      node,
      htmlMarks
        ? `<span data-link="${attr(`${kind}:${ref}`)}"${place ? ` data-place="${attr(place)}"` : ''}>${attr(labelFor(kind, ref, label))}</span>`
        : `[[${kind}:${ref}|${labelFor(kind, ref, label)}${place ? `|${place}` : ''}]]`,
    );
  },
});

/** `{{ent:<id>.<field>}}` — the current value of a field of an entity. */
export const LiveField = Node.create({
  name: 'liveField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { entity: { default: '' }, field: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-field]',
        getAttrs: (el) => {
          const [entity, field] = ((el as HTMLElement).dataset.field ?? '').split('.');
          return { entity, field };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const { entity, field } = node.attrs as { entity: string; field: string };
    return [
      'span',
      { 'data-field': `${entity}.${field}`, class: 'doc-embed doc-field' },
      lookup.fieldText(entity, field) ?? '',
    ];
  },
  addNodeView() {
    return liveView(
      'doc-field',
      'data-field',
      (a) => `${a.entity}.${a.field}`,
      (a) => lookup.fieldText(a.entity, a.field) ?? '',
    ) as never;
  },
  markdownTokenizer: {
    name: 'liveField',
    level: 'inline',
    start: (src: string) => src.indexOf('{{ent:'),
    tokenize(src: string) {
      const m = FIELD_RE.exec(src);
      if (!m) return undefined;
      return { type: 'liveField', raw: m[0], entity: m[1], field: m[2] } as MarkdownToken;
    },
  },
  parseMarkdown: (token, h) => h.createNode('liveField', { entity: token.entity, field: token.field }),
  renderMarkdown: (node) => {
    const { entity, field } = (node.attrs ?? {}) as { entity: string; field: string };
    return withMarks(
      node,
      htmlMarks ? `<span data-field="${attr(`${entity}.${field}`)}"></span>` : `{{ent:${entity}.${field}}}`,
    );
  },
});

// ---------- pictures ----------

/** A picture of the project is stored by its path ("assets/…") and shown through `assetUrl`. */
const ProjectImage = Image.extend({
  // A path with spaces or brackets ("assets/лес и река.png") is written in angle brackets; brackets in the
  // alt text are escaped.
  renderMarkdown: (node) => {
    const src = String(node.attrs?.src ?? '');
    const alt = String(node.attrs?.alt ?? '')
      .replace(/\n/g, ' ')
      .replace(/([\\[\]])/g, '\\$1');
    const title = String(node.attrs?.title ?? '').replace(/"/g, "'");
    const where = /[\s()<>]/.test(src) ? `<${src}>` : src;
    return title ? `![${alt}](${where} "${title}")` : `![${alt}](${where})`;
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.className = 'doc-image';
      const show = (src: string, alt: string) => {
        img.alt = alt;
        if (/^(https?:|data:|blob:)/.test(src)) img.src = src;
        else
          void assetUrl(src).then(
            (url) => (img.src = url),
            () => img.classList.add('doc-image-missing'),
          );
      };
      show(String(node.attrs.src ?? ''), String(node.attrs.alt ?? ''));
      return {
        dom: img,
        update: (next) => {
          if (next.type !== node.type) return false;
          show(String(next.attrs.src ?? ''), String(next.attrs.alt ?? ''));
          return true;
        },
      };
    };
  },
});

// ---------- empty blocks ----------

/**
 * An empty paragraph is written as "&#160;" (a no-break space), which `parseMarkdown` takes back as an empty
 * paragraph: as a blank line
 * it would vanish, and inside a list item it would end the list. An empty table cell stays empty.
 */
const IN_TABLES = new Set(['table', 'tableRow', 'tableCell', 'tableHeader']);
const KeptParagraph = Paragraph.extend({
  renderMarkdown: (node, h, ctx) =>
    node.content?.length ? h.renderChildren(node.content) : IN_TABLES.has(String(ctx.parentType)) ? '' : '&#160;',
});

/** An empty heading is "##" alone (the stock writer leaves it out, and the blocks after it shift). */
const KeptHeading = Heading.extend({
  renderMarkdown: (node, h) => {
    const hashes = '#'.repeat(Number(node.attrs?.level) || 1);
    return node.content?.length ? `${hashes} ${h.renderChildren(node.content)}` : hashes;
  },
});

// ---------- the schema ----------

/** Everything a document can hold, the same for the editor and for reading and writing files. */
export function documentExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      strike: false,
      underline: false,
      link: false,
      paragraph: false,
      heading: false,
    }),
    KeptParagraph,
    KeptHeading,
    SafeBold,
    SafeItalic,
    SafeStrike,
    HtmlUnderline,
    TextColor,
    TextFontMark,
    SafeLink,
    Table.configure({ resizable: false }),
    TableRow,
    // A Markdown table cell holds one line of text: no lists, quotes or several paragraphs (ADR-003, class C).
    TableHeader.extend({ content: 'paragraph' }),
    TableCell.extend({ content: 'paragraph' }),
    ProjectImage.configure({ inline: false, allowBase64: false }),
    ObjectLink,
    LiveField,
    Markdown,
    ...extra,
  ];
}

/**
 * @tiptap/markdown 3.32 puts marks read from `**…**` on text only, so `**[[ent:mira|Мира]]**` lost its bold
 * when the file was opened (found in the prototype, ADR-003). Our embeds take the marks too.
 */
function marksOnEmbeds(m: MarkdownManager): MarkdownManager {
  type Apply = (markType: string, content: JSONContent[], attrs?: Record<string, unknown>) => JSONContent[];
  const target = m as unknown as { applyMarkToContent: Apply };
  const original = target.applyMarkToContent.bind(m);
  target.applyMarkToContent = (markType, content, attrs) => {
    const mark = attrs ? { type: markType, attrs } : { type: markType };
    const marked = content.map((n) =>
      n.type === 'objectLink' || n.type === 'liveField' ? { ...n, marks: [...(n.marks ?? []), mark] } : n,
    );
    return original(markType, marked, attrs);
  };
  return m;
}

const TAGS: Record<string, [string, string]> = {
  bold: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'],
  strike: ['<s>', '</s>'],
  underline: ['<u>', '</u>'],
  code: ['<code>', '</code>'],
};
/** Marks that cannot be seen on spaces: spaces at their edges go outside the tags (the reader trims them). */
const INVISIBLE_ON_SPACES = new Set(['bold', 'italic']);
/** Marks that mean nothing on spaces alone (the reader drops them there). */
const NOTHING_ON_SPACES = new Set(['bold', 'italic', 'code']);

/**
 * Text in the safe form: characters Markdown or HTML would read as syntax become numeric entities. Inside
 * tags the reader takes text as HTML (backslash escapes would stay), outside as Markdown; entities work in both.
 */
const escapeText = (text: string) =>
  text
    .replace(/[&<>"`*_[\]~{}|\\#!]/g, (c) => `&#${c.charCodeAt(0)};`)
    // Addresses in plain text would be read as links (GFM autolinks).
    .replace(/:\/\//g, '&#58;//')
    .replace(/\bwww\./gi, (w) => `${w.slice(0, 3)}&#46;`)
    .replace(/@/g, '&#64;');

/** Marks of an inline node as a key: pieces with the same marks are written inside one set of tags. */
const markKey = (n: JSONContent) =>
  JSON.stringify(
    (n.marks ?? [])
      .filter((m) => !(n.type !== 'text' && m.type === 'code'))
      .map((m) => [m.type, m.attrs?.href ?? m.attrs?.color ?? m.attrs?.font ?? null])
      .sort(),
  );

/**
 * One run of inline content in the safe form: neighbouring pieces with the same marks share one set of tags
 * (a tag holding only a space would lose it on reading).
 */
function inlineHtml(nodes: JSONContent[], render: (node: JSONContent) => string): string {
  let out = '';
  for (let i = 0; i < nodes.length;) {
    if (nodes[i].type === 'hardBreak') {
      out += '<br>';
      i++;
      continue;
    }
    const key = markKey(nodes[i]);
    let j = i;
    while (j < nodes.length && nodes[j].type !== 'hardBreak' && markKey(nodes[j]) === key) j++;
    const group = nodes.slice(i, j);
    i = j;
    const marks = (group[0].marks ?? []).filter((m) => group[0].type === 'text' || m.type !== 'code');
    let inner = group.map((n) => (n.type === 'text' ? escapeText(n.text ?? '') : render({ ...n, marks: [] }))).join('');
    const onlySpaces = group.every((n) => n.type === 'text' && !n.text?.trim());
    const wrap = marks.filter((m) => !(onlySpaces && NOTHING_ON_SPACES.has(m.type)));
    let before = '';
    let after = '';
    if (wrap.length && wrap.every((m) => INVISIBLE_ON_SPACES.has(m.type))) {
      before = /^\s*/.exec(inner)![0];
      after = /\s*$/.exec(inner.slice(before.length))![0];
      inner = inner.slice(before.length, inner.length - after.length);
    }
    for (const m of wrap) {
      if (m.type === 'link') inner = `<a href="${attr(String(m.attrs?.href ?? ''))}">${inner}</a>`;
      else if (TAGS[m.type]) inner = TAGS[m.type][0] + inner + TAGS[m.type][1];
    }
    // Colour and font share one tag.
    const color = wrap.find((m) => m.type === 'textColor')?.attrs?.color;
    const font = wrap.find((m) => m.type === 'textFont')?.attrs?.font;
    inner = fontTag(color ? String(color) : null, font ? String(font) : null, inner);
    out += before + inner + after;
  }
  // Text that would start a list or a numbered list at the start of the line ("#" and ">" are entities already).
  return out
    .replace(/^(\s*)([-+])(\s|$)/, (_, lead: string, c: string, sp: string) => `${lead}&#${c.charCodeAt(0)};${sp}`)
    .replace(
      /^(\s*)(\d+)([.)])(\s|$)/,
      (_, lead: string, d: string, c: string, sp: string) => `${lead}${d}&#${c.charCodeAt(0)};${sp}`,
    );
}

/**
 * While a block is written in the safe form, its inline content is written by `inlineHtml`. Inline HTML is read
 * keeping its spaces (by default the HTML reader would squeeze "a  b" and trim "<u>word </u>").
 */
function safeInline(m: MarkdownManager): MarkdownManager {
  type Render = (nodes: JSONContent[], parent: JSONContent, separator?: string, level?: number) => string;
  type Token = { text?: string; raw?: string; block?: boolean };
  const target = m as unknown as {
    renderNodesWithMarkBoundaries: Render;
    renderNodeToMarkdown: (n: JSONContent) => string;
    parseHTMLToken: (token: Token) => unknown;
    isUnrecognizedHtml: (html: string) => boolean;
    toInlineContent: (content: JSONContent[]) => JSONContent[];
  };
  const originalParse = target.parseHTMLToken.bind(m);
  target.parseHTMLToken = (token) => {
    const html = token.text || token.raw || '';
    if (token.block || !html.trim() || typeof window === 'undefined' || target.isUnrecognizedHtml.call(m, html)) {
      return originalParse(token);
    }
    schema ??= getSchema(documentExtensions());
    const doc = PmDOMParser.fromSchema(schema).parse(elementFromString(html), { preserveWhitespace: 'full' });
    const inline = target.toInlineContent.call(m, (doc.toJSON() as JSONContent).content ?? []);
    return inline.length ? inline : null;
  };
  const original = target.renderNodesWithMarkBoundaries.bind(m);
  target.renderNodesWithMarkBoundaries = (nodes, parent, separator, level) =>
    htmlMarks && nodes.some((n) => n.type === 'text' || n.type === 'objectLink' || n.type === 'liveField')
      ? inlineHtml(nodes, (n) => target.renderNodeToMarkdown.call(m, n))
      : original(nodes, parent, separator, level);
  return m;
}

let manager: MarkdownManager | null = null;
function markdown(): MarkdownManager {
  return (manager ??= safeInline(marksOnEmbeds(new MarkdownManager({ extensions: documentExtensions() }))));
}

/** Markdown (without front matter) → the editor's document. */
export function parseMarkdown(text: string): JSONContent {
  const doc = emptyParagraphs(markdown().parse(text));
  return doc.content?.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** A paragraph holding a no-break space alone is how an empty paragraph is written (see KeptParagraph). */
function emptyParagraphs(node: JSONContent): JSONContent {
  if (!node.content) return node;
  if (node.type === 'paragraph' && node.content.length === 1 && node.content[0].type === 'text') {
    const text = node.content[0].text ?? '';
    if (text === '\u00a0' || text === '&nbsp;' || text === '&#160;') return { ...node, content: [] };
  }
  return { ...node, content: node.content.map(emptyParagraphs) };
}

/** Attributes at their defaults and empty lists do not count when two documents are compared. */
function normalize(node: JSONContent): JSONContent {
  const out: JSONContent = { type: node.type };
  if (node.attrs) {
    const attrs = Object.fromEntries(
      Object.entries(node.attrs).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );
    if (Object.keys(attrs).length) out.attrs = attrs;
  }
  if (node.marks?.length) {
    out.marks = node.marks
      .map((m) => normalize(m as JSONContent) as { type: string })
      .sort((a, b) => a.type.localeCompare(b.type));
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.content?.length) {
    // Neighbouring text with the same marks is one piece of text.
    const merged: JSONContent[] = [];
    for (const child of node.content.map(normalize).flatMap(splitSpaces)) {
      const last = merged.at(-1);
      if (
        last?.type === 'text' &&
        child.type === 'text' &&
        JSON.stringify(last.marks) === JSON.stringify(child.marks)
      ) {
        last.text = (last.text ?? '') + (child.text ?? '');
      } else merged.push(child);
    }
    out.content = merged;
  }
  // Labels of links are rewritten from the project on every save; they do not make a difference.
  if (node.type === 'objectLink' && out.attrs) delete out.attrs.label;
  // Inline code around a link or a value means nothing and Markdown cannot write it.
  if ((node.type === 'objectLink' || node.type === 'liveField') && out.marks) {
    out.marks = out.marks.filter((m) => m.type !== 'code');
    if (!out.marks.length) delete out.marks;
  }
  // Normalizations Markdown makes, documented in the help (ADR-003, classes B and D): spaces at the start
  // and end of a line go; the first row of a table is its header row and the others are not.
  if (out.content && TEXTBLOCKS.has(String(out.type))) {
    trimLines(out.content);
    if (!out.content.length) delete out.content;
  }
  // An empty line inside a list item or a quote, next to other blocks, is only spacing.
  if (out.content && CONTAINERS.has(String(out.type)) && out.content.length > 1) {
    const kept = out.content.filter((c) => !(c.type === 'paragraph' && !c.content?.length));
    out.content = kept.length ? kept : out.content.slice(0, 1);
  }
  // The table writer of TipTap squeezes several spaces in a cell into one.
  if ((out.type === 'tableCell' || out.type === 'tableHeader') && out.content) {
    for (const para of out.content)
      for (const t of para.content ?? []) if (t.text) t.text = t.text.replace(/\s{2,}/g, ' ');
  }
  if (out.type === 'table' && out.content) {
    out.content.forEach((row, i) =>
      row.content?.forEach((cell) => (cell.type = i === 0 ? 'tableHeader' : 'tableCell')),
    );
  }
  return out;
}

const TEXTBLOCKS = new Set(['paragraph', 'heading']);
const CONTAINERS = new Set(['listItem', 'blockquote']);

/** Bold or italic on spaces cannot be seen and Markdown cannot keep it: spaces at the edges count as plain. */
function splitSpaces(node: JSONContent): JSONContent[] {
  const marks = node.marks as { type: string }[] | undefined;
  if (node.type !== 'text' || !node.text || !marks?.length) return [node];
  // On spaces, bold, italic and code mean nothing; the other marks (underline, strike, colour) stay.
  const onSpaces = (text: string): JSONContent => {
    const kept = marks.filter((m) => !NOTHING_ON_SPACES.has(m.type));
    return kept.length ? { ...node, text, marks: kept } : { type: 'text', text };
  };
  if (!node.text.trim()) return [onSpaces(node.text)];
  const [, before, middle, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text)!;
  return [...(before ? [onSpaces(before)] : []), { ...node, text: middle }, ...(after ? [onSpaces(after)] : [])];
}

function trimLines(content: JSONContent[]): void {
  const edge = (i: number, side: 'start' | 'end') => {
    const n = content[i];
    if (n?.type !== 'text' || n.text === undefined) return;
    n.text = side === 'start' ? n.text.replace(/^[ \t\u00a0]+/, '') : n.text.replace(/[ \t\u00a0]+$/, '');
  };
  // Until nothing changes: a piece trimmed away leaves the next one at the edge of the line.
  for (let before = -1; before !== content.length;) {
    before = content.length;
    for (let i = 0; i < content.length; i++) {
      if (i === 0 || content[i - 1].type === 'hardBreak') edge(i, 'start');
      if (i === content.length - 1 || content[i + 1].type === 'hardBreak') edge(i, 'end');
    }
    for (let i = content.length - 1; i >= 0; i--)
      if (content[i].type === 'text' && !content[i].text) content.splice(i, 1);
  }
  // A break at the very end of a line shows nothing.
  while (content.at(-1)?.type === 'hardBreak') content.pop();
  for (let i = content.length - 1; i >= 0; i--)
    if (content[i].type === 'text' && !content[i].text) content.splice(i, 1);
}

let schema: Schema | null = null;

/**
 * Blocks as they are compared: through the schema (attributes left out and at their defaults look the same),
 * then with the normalizations Markdown is allowed to make.
 */
export function canonicalBlocks(blocks: JSONContent[]): JSONContent[] {
  schema ??= getSchema(documentExtensions());
  let out: JSONContent[];
  try {
    const doc = PmNode.fromJSON(schema, { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] });
    out = ((doc.toJSON() as JSONContent).content ?? []).map(normalize);
  } catch {
    out = blocks.map(normalize);
  }
  return joinLists(out);
}

/** Two numbered lists in a row are read as one (the list reader of TipTap 3.32 ignores "1." against "1)"). */
function joinLists(blocks: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const b of blocks) {
    const last = out.at(-1);
    if (last?.type === 'orderedList' && b.type === 'orderedList') {
      out[out.length - 1] = { ...last, content: [...(last.content ?? []), ...(b.content ?? [])] };
    } else out.push(b);
  }
  return out;
}

const canonical = (blocks: JSONContent[]) => JSON.stringify(canonicalBlocks(blocks));

const same = (a: JSONContent[], b: JSONContent[]) => canonical(a) === canonical(b);

function serialize(blocks: JSONContent[], html: boolean): string {
  htmlMarks = html;
  try {
    return markdown().serialize({ type: 'doc', content: blocks });
  } finally {
    htmlMarks = false;
  }
}

/**
 * Two lists in a row would be read as one; a list written with other markers ("*" instead of "-", "1)"
 * instead of "1.") starts a new one.
 */
function otherMarkers(block: JSONContent, text: string): string {
  if (block.type === 'bulletList') return text.replace(/^- /gm, '* ');
  if (block.type === 'orderedList') return text.replace(/^(\d+)\. /gm, '$1) ');
  return text;
}

export interface Written {
  text: string;
  /** Reading `text` back gives the same document (false only when even the safe form could not). */
  exact: boolean;
  /** Blocks written in the safe form. */
  safeBlocks: number;
}

/** The editor's document → Markdown that reads back as the same document (F5-10). */
/**
 * How each block was written last time, by the block itself: a pause in typing changes one block, and only that
 * one is written and read back again. Labels of links come from the project, so a new lookup clears it.
 */
const written = new Map<string, { text: string; safe: boolean }>();
const WRITTEN_LIMIT = 2000;

/** The editor's document → Markdown that reads back as the same document (F5-10). */
export function writeMarkdown(doc: JSONContent): Written {
  const blocks = doc.content ?? [];
  let safeBlocks = 0;
  const parts = blocks.map((original, i) => {
    const block = trimmed(headerRow(original));
    // Lists of one kind in a row alternate their markers ("-", "*", "-"…), so each starts a list of its own.
    let run = 0;
    while (blocks[i - run - 1]?.type === block.type) run++;
    const apart = (text: string) => (run % 2 === 1 ? otherMarkers(block, text) : text);
    const key = `${run % 2}${JSON.stringify(block)}`;
    const known = written.get(key);
    if (known) {
      if (known.safe) safeBlocks++;
      return known.text;
    }
    let text = apart(serialize([block], false).replace(/^\n+/, ''));
    const safe = !same(markdown().parse(text).content ?? [], [block]);
    if (safe) {
      safeBlocks++;
      text = apart(serialize([block], true).replace(/^\n+/, ''));
    }
    if (written.size > WRITTEN_LIMIT) written.clear();
    written.set(key, { text, safe });
    return text;
  });
  const text = parts.join('\n\n');
  const back = markdown().parse(text).content ?? [];
  return { text: text.endsWith('\n') || !text ? text : `${text}\n`, exact: same(back, blocks), safeBlocks };
}

/**
 * Spaces at the edges of lines are not kept by Markdown (class D); they are left out before writing, so that
 * "   text" after a list does not become part of the list (or code, with four spaces).
 */
function trimmed(node: JSONContent): JSONContent {
  if (!node.content) return node;
  if (TEXTBLOCKS.has(String(node.type))) {
    const content = node.content.map((c) => ({ ...c }));
    trimLines(content);
    return { ...node, content };
  }
  return { ...node, content: node.content.map(trimmed) };
}

/** A Markdown table always has a header row: the first row is written as one (ADR-003, class B). */
function headerRow(block: JSONContent): JSONContent {
  if (block.type !== 'table' || !block.content) return block;
  return {
    ...block,
    content: block.content.map((row, i) => ({
      ...row,
      content: row.content?.map((cell) => ({ ...cell, type: i === 0 ? 'tableHeader' : 'tableCell' })),
    })),
  };
}

/** For tests: is the text read back as this document. */
export function readsBackAs(text: string, doc: JSONContent): boolean {
  return same(markdown().parse(text).content ?? [], doc.content ?? []);
}
