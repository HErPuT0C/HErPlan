import { Node, type MarkdownToken } from '@tiptap/core';
import { entities } from './entities';

// Candidate Markdown syntax (to be fixed in ADR-004):
//   [[ent:mira|Мира]]      link to an entity; the alias keeps the file readable in Obsidian and other editors
//   {{ent:mira.доверие}}   live field value

const LINK_RE = /^\[\[ent:([\w-]+)(?:\|([^\]\n]*))?\]\]/;
const FIELD_RE = /^\{\{ent:([\w-]+)\.([^}\s]+)\}\}/;

// The Markdown serializer only wraps text nodes in mark delimiters; embeds wrap themselves.
const MARK_DELIMITERS: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  underline: ['<u>', '</u>'],
};

function withMarks(node: { marks?: { type: string }[] }, text: string): string {
  let out = text;
  for (const m of node.marks ?? []) {
    const d = MARK_DELIMITERS[m.type];
    if (d) out = d[0] + out + d[1];
  }
  return out;
}

function liveText(el: HTMLElement, compute: () => string): () => void {
  const update = () => {
    el.textContent = compute();
  };
  update();
  return entities.subscribe(update);
}

export const EntityLink = Node.create({
  name: 'entityLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { id: { default: '' }, label: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-link]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.entityLink }) }];
  },

  renderHTML({ node }) {
    return ['span', { 'data-entity-link': node.attrs.id, class: 'embed embed-link' }, entities.get(node.attrs.id)?.name ?? node.attrs.label];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'embed embed-link';
      dom.dataset.entityLink = node.attrs.id;
      const stop = liveText(dom, () => entities.get(node.attrs.id)?.name ?? `? ${node.attrs.id}`);
      return { dom, destroy: stop };
    };
  },

  markdownTokenizer: {
    name: 'entityLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[[ent:'),
    tokenize(src: string) {
      const m = LINK_RE.exec(src);
      if (!m) return undefined;
      return { type: 'entityLink', raw: m[0], id: m[1], label: m[2] ?? '' } as MarkdownToken;
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('entityLink', { id: token.id, label: token.label });
  },

  renderMarkdown(node) {
    const id = node.attrs?.id ?? '';
    const name = entities.get(id)?.name ?? node.attrs?.label ?? '';
    return withMarks(node, `[[ent:${id}|${name}]]`);
  },
});

export const EntityField = Node.create({
  name: 'entityField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { id: { default: '' }, field: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-entity-field]' }];
  },

  renderHTML({ node }) {
    const value = entities.get(node.attrs.id)?.fields[node.attrs.field] ?? '';
    return ['span', { 'data-entity-field': `${node.attrs.id}.${node.attrs.field}`, class: 'embed embed-field' }, String(value)];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'embed embed-field';
      dom.title = `${node.attrs.id}.${node.attrs.field}`;
      const stop = liveText(dom, () => String(entities.get(node.attrs.id)?.fields[node.attrs.field] ?? `? ${node.attrs.field}`));
      return { dom, destroy: stop };
    };
  },

  markdownTokenizer: {
    name: 'entityField',
    level: 'inline',
    start: (src: string) => src.indexOf('{{ent:'),
    tokenize(src: string) {
      const m = FIELD_RE.exec(src);
      if (!m) return undefined;
      return { type: 'entityField', raw: m[0], id: m[1], field: m[2] } as MarkdownToken;
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('entityField', { id: token.id, field: token.field });
  },

  renderMarkdown(node) {
    return withMarks(node, `{{ent:${node.attrs?.id}.${node.attrs?.field}}}`);
  },
});
