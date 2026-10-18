import { MarkdownManager } from '@tiptap/markdown';

// @tiptap/markdown 3.32 applies inline marks (bold, italic…) only to text nodes, so `**[[ent:x|X]]**`
// loses its bold on custom inline embeds. Extend the behaviour to inline leaf nodes (our embeds).
const LEAF_EMBEDS = new Set(['entityLink', 'entityField']);
type Json = { type?: string; marks?: unknown[]; content?: Json[] };
const proto = MarkdownManager.prototype as unknown as {
  applyMarkToContent(markType: string, content: Json[], attrs?: unknown): Json[];
};
const original = proto.applyMarkToContent;
proto.applyMarkToContent = function (markType, content, attrs) {
  const mark = attrs ? { type: markType, attrs } : { type: markType };
  return original.call(
    this,
    markType,
    content.map((n) => (n.type && LEAF_EMBEDS.has(n.type) ? { ...n, marks: [...(n.marks ?? []), mark] } : n)),
    attrs,
  );
};
