// Markdown (with HErPlan embeds) → PDF via pdfmake: table of contents, Cyrillic, tables, images,
// page numbers, no heading stranded at the bottom of a page.
// Usage: node make-pdf.mjs <input.md> <output.pdf>
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { marked } from 'marked';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');
// Only the bundled fonts and files next to the document may be read; no network access.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);
const fontDir = dirname(require.resolve('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf'));
pdfmake.setFonts({
  Roboto: {
    normal: `${fontDir}/Roboto-Regular.ttf`,
    bold: `${fontDir}/Roboto-Medium.ttf`,
    italics: `${fontDir}/Roboto-Italic.ttf`,
    bolditalics: `${fontDir}/Roboto-MediumItalic.ttf`,
  },
});

// Stand-in for the project database: embeds are resolved to current values at export time.
const ENTITIES = {
  mira: { name: 'Мира', fields: { доверие: 3, роль: 'Травница' } },
  boris: { name: 'Борис', fields: { доверие: 1, роль: 'Кузнец' } },
};
const resolveEmbeds = (text) =>
  text
    .replace(/\[\[ent:([\w-]+)(?:\|([^\]\n]*))?\]\]/g, (_, id, label) => ENTITIES[id]?.name ?? label ?? id)
    .replace(/\{\{ent:([\w-]+)\.([^}\s]+)\}\}/g, (_, id, f) => String(ENTITIES[id]?.fields[f] ?? '?'));

const [input = 'sample.md', output = 'out/sample.pdf'] = process.argv.slice(2);
const baseDir = dirname(resolve(input));

function inline(tokens, style = {}) {
  const out = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text':
        if (t.tokens) out.push(...inline(t.tokens, style));
        else out.push({ text: resolveEmbeds(t.text), ...style });
        break;
      case 'escape': out.push({ text: t.text, ...style }); break;
      case 'strong': out.push(...inline(t.tokens, { ...style, bold: true })); break;
      case 'em': out.push(...inline(t.tokens, { ...style, italics: true })); break;
      case 'del': out.push(...inline(t.tokens, { ...style, decoration: 'lineThrough' })); break;
      case 'codespan': out.push({ text: t.text, ...style, background: '#eef0f3' }); break;
      case 'link': out.push(...inline(t.tokens, { ...style, link: t.href, color: '#1d5fd1', decoration: 'underline' })); break;
      case 'br': out.push({ text: '\n' }); break;
      default: out.push({ text: resolveEmbeds(t.raw ?? ''), ...style });
    }
  }
  return out;
}

function block(t) {
  switch (t.type) {
    case 'heading':
      return { text: inline(t.tokens), style: `h${t.depth}`, headlineLevel: t.depth, tocItem: t.depth <= 2, tocMargin: [(t.depth - 1) * 14, 0, 0, 0] };
    case 'paragraph': {
      const img = t.tokens.length === 1 && t.tokens[0].type === 'image' ? t.tokens[0] : null;
      if (img) return { image: resolve(baseDir, img.href), fit: [300, 200], alignment: 'center', margin: [0, 6, 0, 10] };
      return { text: inline(t.tokens), style: 'p' };
    }
    case 'list': {
      const items = t.items.map((it) => it.tokens.map(block).filter(Boolean));
      return t.ordered ? { ol: items, style: 'list' } : { ul: items, style: 'list' };
    }
    case 'text': return { text: inline(t.tokens ?? [{ type: 'text', text: t.text }]) };
    case 'blockquote':
      return {
        table: { widths: ['*'], body: [[{ stack: t.tokens.map(block).filter(Boolean), color: '#4a5260' }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => '#3b82f6', paddingLeft: () => 12 },
        margin: [0, 4, 0, 10],
      };
    case 'table':
      return {
        table: {
          headerRows: 1,
          widths: t.header.map(() => '*'),
          body: [
            t.header.map((c) => ({ text: inline(c.tokens), bold: true, fillColor: '#eef0f3' })),
            ...t.rows.map((r) => r.map((c) => ({ text: inline(c.tokens) }))),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 4, 0, 12],
      };
    case 'hr':
      return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#c4c9d2' }], margin: [0, 8, 0, 8] };
    case 'space': return null;
    default: return { text: resolveEmbeds(t.raw ?? ''), style: 'p' };
  }
}

const tokens = marked.lexer(readFileSync(input, 'utf8'));
const title = tokens.find((t) => t.type === 'heading' && t.depth === 1)?.text ?? 'Документ';
const doc = {
  info: { title: resolveEmbeds(title), creator: 'HErPlan prototype' },
  pageSize: 'A4',
  pageMargins: [40, 50, 40, 50],
  defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
  styles: {
    h1: { fontSize: 20, bold: true, margin: [0, 14, 0, 8] },
    h2: { fontSize: 15, bold: true, margin: [0, 12, 0, 6] },
    h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
    p: { margin: [0, 0, 0, 7] },
    list: { margin: [0, 0, 0, 8] },
    tocTitle: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
  },
  footer: (page, pages) => ({ text: `Страница ${page} из ${pages}`, alignment: 'center', fontSize: 8.5, color: '#7a8190', margin: [0, 20, 0, 0] }),
  // Never leave a heading as the last thing on a page.
  pageBreakBefore: (node, ctx) =>
    Boolean(node.headlineLevel) && ctx.getFollowingNodesOnPage().filter((n) => !n.headlineLevel).length === 0,
  content: [
    { toc: { title: { text: 'Оглавление', style: 'tocTitle' } } },
    { text: '', pageBreak: 'after' },
    ...tokens.map(block).filter(Boolean),
  ],
};

mkdirSync(dirname(resolve(output)), { recursive: true });
const started = performance.now();
await pdfmake.createPdf(doc).write(output);
console.log(`${output}: ${Math.round(performance.now() - started)} ms`);
