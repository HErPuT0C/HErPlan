import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { canonicalBlocks, parseMarkdown, writeMarkdown } from './markdown';

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (t: string, ...marks: (string | { type: string; attrs: Record<string, unknown> })[]): JSONContent => ({
  type: 'text',
  text: t,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}),
});
const link = (ref: string, ...marks: string[]): JSONContent => ({
  type: 'objectLink',
  attrs: { kind: 'ent', ref, label: 'Мира' },
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});

/** Written and read back: the same document (as compared, see canonicalBlocks). */
function roundTrip(...blocks: JSONContent[]) {
  const doc = { type: 'doc', content: blocks };
  const written = writeMarkdown(doc);
  expect(written.exact, written.text).toBe(true);
  expect(canonicalBlocks(parseMarkdown(written.text).content ?? [])).toEqual(canonicalBlocks(blocks));
  return written.text;
}

describe('the self-checking Markdown save (F5-10)', () => {
  it('keeps page breaks as an HTML comment, between any blocks and at the ends (0.7.4)', () => {
    const brk: JSONContent = { type: 'pageBreak' };
    const h = (t: string): JSONContent => ({ type: 'heading', attrs: { level: 1 }, content: [text(t)] });
    expect(roundTrip(h('Глава'), p(text('Раз')), brk, h('Вторая'), brk, p(text('Два')))).toBe(
      '# Глава\n\nРаз\n\n<!-- pagebreak -->\n\n# Вторая\n\n<!-- pagebreak -->\n\nДва\n',
    );
    roundTrip(brk, p(text('после')));
    roundTrip(p(text('до')), brk);
    roundTrip({ type: 'bulletList', content: [{ type: 'listItem', content: [p(text('пункт'))] }] }, brk, brk);
    // A heading in a list item with lines after it (found by the fuzzer).
    const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
    roundTrip({ type: 'bulletList', content: [item(p(text('раз')), h('заг'), p(text('два'))), item(p(text('три')))] });
    // …with marks that only inline HTML keeps (a link right after bold text): a blank line before the heading
    // makes the list loose, so they are read back too.
    const written = roundTrip({
      type: 'bulletList',
      content: [
        item(
          p(text('раз')),
          h('заг'),
          p(text('ё', 'italic'), text('щ', 'bold'), link('ent-mira', 'bold'), text(' хвост', 'strike')),
        ),
      ],
    });
    expect(written).toContain('\n\n  # заг');
    // Other comments are left as they were.
    expect(parseMarkdown('<!-- note -->\n\nтекст').content?.some((b) => b.type === 'pageBreak')).toBe(false);
  });

  it('writes ordinary Markdown when it reads back the same', () => {
    expect(roundTrip(p(text('Мира', 'bold'), text(' пришла к '), text('мельнице', 'italic')))).toBe(
      '**Мира** пришла к *мельнице*\n',
    );
    expect(roundTrip(p(link('ent-mira', 'bold'), text(' пришла')))).toBe('**[[ent:ent-mira|Мира]]** пришла\n');
    // Text that looks like an embed is not taken for one.
    expect(roundTrip(p(link('ent-mira', 'bold'), text(' и {{ent:x.y}} как текст')))).toContain('&#123;&#123;');
  });

  it('falls back to tags where Markdown is ambiguous, and keeps the text exactly', () => {
    // Class A of ADR-003: formatting at the edge of a word or a sign.
    roundTrip(p(text('Ме'), text('льница: …—', 'bold'), text('*')));
    roundTrip(p(text('*—*'), text('a', 'italic'), text('—*', 'bold', 'italic')));
    // Spaces next to a link inside one tag, a backslash, characters that look like syntax.
    roundTrip(p(text('см.'), text(' ', 'underline'), link('ent-mira', 'underline'), text('.', 'underline')));
    roundTrip(p(text('a\\\\b [[ent:x|y]] {{ <b> &amp; 1) '), text('x', 'strike')));
  });

  it('keeps colours and fonts', () => {
    const red = { type: 'textColor', attrs: { color: 'red' } };
    const serif = { type: 'textFont', attrs: { font: 'serif' } };
    const out = roundTrip(
      p(text('красный ', red), text('жирный', red, 'bold'), text(' и '), text('с засечками', serif)),
    );
    expect(out).toContain('<font color="red">');
    expect(out).toContain('<font face="serif">');
  });

  it('keeps empty paragraphs, empty headings and lists written one after another', () => {
    roundTrip(p(text('a')), { type: 'paragraph' }, { type: 'paragraph' }, p(text('b')));
    roundTrip({ type: 'heading', attrs: { level: 2 } }, p(text('после')));
    const item = (t: string): JSONContent => ({ type: 'listItem', content: [p(text(t))] });
    const out = roundTrip(
      { type: 'bulletList', content: [item('a')] },
      { type: 'bulletList', content: [item('b')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
    );
    expect(out).toContain('* b');
  });

  it('keeps pictures with spaces in their paths', () => {
    const out = roundTrip(p(text('карта:')), {
      type: 'image',
      attrs: { src: 'assets/карты/лес и река.png', alt: 'лес [1]' },
    });
    expect(out).toContain('(<assets/карты/лес и река.png>)');
  });
});
