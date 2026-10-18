// Random-edit fuzzer for the Markdown round trip of the editor prototype.
// After every edit: markdown → fresh editor → markdown must be identical, and the document must not change.
// Usage: node scripts/fuzz-markdown.mjs <url> [runs] [stepsPerRun]
import { chromium } from 'playwright';

const [url = 'http://localhost:4173/', runs = '40', steps = '60'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.click('[data-tab="editor"]');
await page.waitForFunction(() => window.__herplanEditor && window.__herplanReparse);

const failures = await page.evaluate(
  async ({ runs, steps }) => {
    const editor = window.__herplanEditor;
    const sample = editor.getMarkdown();
    const texts = ['слово', ' ', '  ', 'a*b', '_x_', '[скобка]', '{{', '}}', '|', '# ', '- ', '> ', '1. ', '`код`', '~~', '\\', 'ё', '**', '<b>', '&amp;', '\t', 'Мира', 'http://x.ru'];
    const marks = ['bold', 'italic', 'strike', 'underline', 'code'];
    const out = [];

    for (let run = 0; run < runs; run++) {
      let seed = run * 7919 + 1;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      editor.commands.setContent(sample, { contentType: 'markdown' });
      const log = [];
      for (let s = 0; s < steps; s++) {
        const size = editor.state.doc.content.size;
        const a = 1 + Math.floor(rnd() * Math.max(1, size - 2));
        const b = Math.min(size - 1, a + Math.floor(rnd() * 12));
        const op = pick(['text', 'text', 'text', 'mark', 'mark', 'block', 'embed', 'split', 'delete']);
        try {
          const chain = editor.chain().setTextSelection({ from: a, to: Math.max(a, b) });
          if (op === 'text') { const t = pick(texts); chain.insertContent(t).run(); log.push(`text ${JSON.stringify(t)} @${a}`); }
          if (op === 'mark') { const m = pick(marks); chain.toggleMark(m).run(); log.push(`mark ${m} ${a}-${b}`); }
          if (op === 'block') {
            const k = pick(['h1', 'h2', 'bullet', 'ordered', 'quote', 'para']);
            ({ h1: () => chain.toggleHeading({ level: 1 }), h2: () => chain.toggleHeading({ level: 2 }), bullet: () => chain.toggleBulletList(), ordered: () => chain.toggleOrderedList(), quote: () => chain.toggleBlockquote(), para: () => chain.setParagraph() })[k]().run();
            log.push(`block ${k} @${a}`);
          }
          if (op === 'embed') {
            const n = rnd() < 0.5 ? { type: 'entityLink', attrs: { id: pick(['mira', 'boris', 'mill']), label: '' } } : { type: 'entityField', attrs: { id: 'mira', field: pick(['доверие', 'роль']) } };
            chain.insertContent(n).run();
            log.push(`embed ${n.type} @${a}`);
          }
          if (op === 'split') { chain.splitBlock().run(); log.push(`split @${a}`); }
          if (op === 'delete') { chain.deleteSelection().run(); log.push(`delete ${a}-${b}`); }
        } catch (e) {
          log.push(`(op failed: ${e.message})`);
        }
        const md1 = editor.getMarkdown();
        const re = window.__herplanReparse(md1);
        const md2 = re.md;
        const sameDoc = JSON.stringify(re.json) === JSON.stringify(editor.getJSON());
        if (md1 !== md2 || !sameDoc) {
          // First differing path in the document JSON, for classifying the loss.
          const firstDiff = (x, y, path) => {
            if (JSON.stringify(x) === JSON.stringify(y)) return null;
            if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return `${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`;
            for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
              const d = firstDiff(x[k], y[k], `${path}.${k}`);
              if (d) return d;
            }
            return null;
          };
          const jsonDiff = firstDiff(editor.getJSON(), re.json, 'doc');
          out.push({ run, step: s, lastOps: log.slice(-4), md1, md2, jsonDiff, kind: md1 !== md2 ? 'markdown changes on re-read' : 'document changes on re-read' });
          break;
        }
      }
    }
    return out;
  },
  { runs: Number(runs), steps: Number(steps) },
);
await browser.close();

console.log(`runs: ${runs}, steps per run: ${steps}, failing runs: ${failures.length}`);
const seen = new Set();
for (const f of failures) {
  const key = f.lastOps.at(-1).split(' ').slice(0, 2).join(' ') + '|' + f.kind;
  if (seen.has(key)) continue;
  seen.add(key);
  // Show only the differing lines.
  const a = f.md1.split('\n'), b = f.md2.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(`  - ${JSON.stringify(a[i])}\n  + ${JSON.stringify(b[i])}`);
  console.log(`\n[run ${f.run}, step ${f.step}] ${f.kind}; last ops: ${f.lastOps.join(' → ')}\n${diff.slice(0, 4).join('\n') || '  (markdown identical)'}\n  json: ${f.jsonDiff}`);
}
process.exit(failures.length ? 1 : 0);
