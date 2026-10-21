// The Markdown fuzzer (F5-10, F5-11; ADR-003): random edits, and after each one the document is written,
// read back and compared. Any difference fails the test, so CI is red on a loss of formatting or text.

import { Editor, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { canonicalBlocks, documentExtensions, parseMarkdown, writeMarkdown } from './markdown';

const SAMPLE = `# Глава 1. Мельница

**[[ent:mira|Мира]]** приходит к *старой мельнице* на рассвете. Её доверие к герою: {{ent:mira.f-trust}}.

## Что известно

- Мельница: [[ent:mill|Старая мельница]], угроза — {{ent:mill.f-threat}}.
- Кузнец [[ent:boris|Борис]] обещал помочь, см. [[doc:d-plan|План]].

> На стене висит ружьё. Оно ещё выстрелит в [[node:g-ch1/a-gun|сцене]].

| Персонаж | Роль |
| --- | --- |
| Мира | Травница |
| Борис | Кузнец |
`;

const TEXTS = [
  'слово',
  ' ',
  '  ',
  'a*b',
  '_x_',
  '[скобка]',
  '{{',
  '}}',
  '|',
  '# ',
  '- ',
  '> ',
  '1. ',
  '`код`',
  '~~',
  '\\\\',
  'ё',
  '**',
  '<b>',
  '&amp;',
  'Мира',
  'http://x.ru',
  '[[ent:boris|Борис]]',
  '<u>',
  '—',
  '…',
  '*—*',
  '+',
  '1)',
];
const MARKS = ['bold', 'italic', 'strike', 'underline', 'code', 'textColor', 'textFont'];

const canon = (doc: JSONContent) => canonicalBlocks(doc.content ?? []);

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function firstDiff(x: unknown, y: unknown, path = 'doc'): string | null {
  if (JSON.stringify(x) === JSON.stringify(y)) return null;
  if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) {
    return `${path}: ${JSON.stringify(x)?.slice(0, 120)} → ${JSON.stringify(y)?.slice(0, 120)}`;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const d = firstDiff((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Runs `runs` series of `steps` random edits; returns the failures found. */
export function fuzz(runs: number, steps: number, trace?: (line: string) => void) {
  const editor = new Editor({ extensions: documentExtensions(), content: parseMarkdown(SAMPLE) });
  const failures: { run: number; step: number; ops: string[]; text: string; diff: string | null; blocks: string[] }[] =
    [];
  for (let run = 0; run < runs; run++) {
    const rnd = rng(run * 7919 + 1);
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    editor.commands.setContent(parseMarkdown(SAMPLE));
    const ops: string[] = [];
    for (let step = 0; step < steps; step++) {
      const size = editor.state.doc.content.size;
      const a = 1 + Math.floor(rnd() * Math.max(1, size - 2));
      const b = Math.min(size - 1, a + Math.floor(rnd() * 12));
      const op = pick(['text', 'text', 'text', 'mark', 'mark', 'block', 'embed', 'split', 'delete']);
      try {
        const chain = editor.chain().setTextSelection({ from: a, to: Math.max(a, b) });
        if (op === 'text') {
          const t = pick(TEXTS);
          chain.insertContent({ type: 'text', text: t }).run();
          ops.push(`text ${JSON.stringify(t)} @${a}`);
        } else if (op === 'mark') {
          const m = pick(MARKS);
          const attrs =
            m === 'textColor'
              ? { color: pick(['red', 'blue']) }
              : m === 'textFont'
                ? { font: pick(['serif', 'mono']) }
                : {};
          chain.toggleMark(m, attrs).run();
          ops.push(`mark ${m} ${a}-${b}`);
        } else if (op === 'block') {
          const k = pick(['h1', 'h2', 'bullet', 'ordered', 'quote', 'para']);
          const c = chain as unknown as Record<string, (x?: unknown) => { run: () => boolean }>;
          const blocks: Record<string, () => { run: () => boolean }> = {
            h1: () => c.toggleHeading({ level: 1 }),
            h2: () => c.toggleHeading({ level: 2 }),
            bullet: () => c.toggleBulletList(),
            ordered: () => c.toggleOrderedList(),
            quote: () => c.toggleBlockquote(),
            para: () => c.setParagraph(),
          };
          blocks[k]().run();
          ops.push(`block ${k} @${a}`);
        } else if (op === 'embed') {
          const n: JSONContent =
            rnd() < 0.5
              ? {
                  type: 'objectLink',
                  attrs: {
                    ...pick([
                      { kind: 'ent', ref: 'mira' },
                      { kind: 'doc', ref: 'd-1' },
                      { kind: 'node', ref: 'g/n' },
                      { kind: 'asset', ref: pick(['assets/a.png', 'assets/лес и река [2].png']) },
                    ]),
                    label: 'X',
                    // Since 0.5 a link can lead elsewhere than the object's own place.
                    place: pick(['', '', 'map:n-1', 'story:g/n', 'assets:assets/a b.png']),
                  },
                }
              : { type: 'liveField', attrs: { entity: 'mira', field: pick(['f-trust', 'name']) } };
          chain.insertContent(n).run();
          ops.push(`embed ${n.type} @${a}`);
        } else if (op === 'split') {
          chain.splitBlock().run();
          ops.push(`split @${a}`);
        } else {
          chain.deleteSelection().run();
          ops.push(`delete ${a}-${b}`);
        }
      } catch (e) {
        ops.push(`(op failed: ${(e as Error).message})`);
      }
      const doc = editor.getJSON();
      trace?.(`run ${run} step ${step} ${ops.at(-1)}`);
      const written = writeMarkdown(doc);
      if (!written.exact) {
        failures.push({
          run,
          step,
          ops: ops.slice(-4),
          text: written.text,
          diff: firstDiff(canon(doc), canon(parseMarkdown(written.text))),
          blocks: [JSON.stringify(canon(doc)), JSON.stringify(canon(parseMarkdown(written.text)))],
        });
        break;
      }
    }
  }
  editor.destroy();
  return failures;
}

describe('Markdown round trip under random edits (F5-10)', () => {
  it('40 series of 60 edits lose nothing', () => {
    const failures = fuzz(40, 60);
    expect(failures.map((f) => `run ${f.run} step ${f.step}: ${f.ops.join(' → ')}\n${f.diff}\n${f.text}`)).toEqual([]);
  });
});
