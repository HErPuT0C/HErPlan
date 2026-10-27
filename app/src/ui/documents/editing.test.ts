import { Editor, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { documentExtensions } from '../../documents/markdown';
import { SelectionHeading } from './editing';

function editorWith(text: string) {
  return new Editor({
    extensions: documentExtensions([SelectionHeading]),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  });
}

/** The blocks of the text; the editor keeps an empty paragraph after a heading at the end, left out here. */
const blocks = (e: Editor) => {
  const out = (e.getJSON().content ?? []).map(
    (b: JSONContent) => `${b.type}${b.attrs?.level ?? ''}:${b.content?.[0]?.text ?? ''}`,
  );
  return out.at(-1) === 'paragraph:' && out.length > 1 ? out.slice(0, -1) : out;
};

describe('a heading made from a selection (0.7.4)', () => {
  it('words selected in the middle of a paragraph become a heading of their own; the spaces at the cuts go', () => {
    const e = editorWith('Первое второе третье слово');
    // "второе " as a double click selects it, with the space after the word.
    e.chain().setTextSelection({ from: 8, to: 15 }).headingOfSelection(2).run();
    expect(blocks(e)).toEqual(['paragraph:Первое', 'heading2:второе', 'paragraph:третье слово']);
    expect(e.state.selection.empty).toBe(false);
    e.destroy();
  });

  it('at the start or the end of a paragraph it cuts once; a whole paragraph or a cursor works as before', () => {
    const start = editorWith('Глава первая. Текст');
    start.chain().setTextSelection({ from: 1, to: 14 }).headingOfSelection(1).run();
    expect(blocks(start)).toEqual(['heading1:Глава первая.', 'paragraph:Текст']);
    const end = editorWith('Текст и Итог');
    end.chain().setTextSelection({ from: 9, to: 13 }).headingOfSelection(3).run();
    expect(blocks(end)).toEqual(['paragraph:Текст и', 'heading3:Итог']);
    const cursor = editorWith('Весь абзац');
    cursor.chain().setTextSelection(3).headingOfSelection(1).run();
    expect(blocks(cursor)).toEqual(['heading1:Весь абзац']);
    for (const e of [start, end, cursor]) e.destroy();
  });
});

describe('a page break (0.7.4)', () => {
  const make = (content: JSONContent[]) =>
    new Editor({ extensions: documentExtensions([SelectionHeading]), content: { type: 'doc', content } });
  const para = (t: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

  it('cuts a paragraph where the cursor is and leaves the cursor after it', () => {
    const e = make([para('раздва')]);
    e.chain().setTextSelection(4).setPageBreak().run();
    e.commands.insertContent('Х');
    expect((e.getJSON().content ?? []).map((b) => b.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(e.getText()).toContain('Хдва');
    e.destroy();
  });

  it('in a list goes after the list; in a table it is not put', () => {
    const list = make([
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('пункт')] }] },
      para('после'),
    ]);
    list.chain().setTextSelection(4).setPageBreak().run();
    expect((list.getJSON().content ?? []).map((b) => b.type)).toEqual(['bulletList', 'pageBreak', 'paragraph']);
    const table = make([]);
    table.commands.insertTable({ rows: 2, cols: 2 });
    expect(table.commands.setPageBreak()).toBe(false);
    expect(JSON.stringify(table.getJSON())).not.toContain('pageBreak');
    for (const e of [list, table]) e.destroy();
  });
});
