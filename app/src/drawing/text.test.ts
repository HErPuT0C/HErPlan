import { describe, expect, it } from 'vitest';
import { parseDrawing, type TextItem, type TextRun } from './model';
import { defaultLook, layoutText, mapRange, restyle, retype, runsOf, runsText, textBounds, withRuns } from './text';

// 0.9.1: texts of drawings — parts with colours and looks of their own, typed into, laid out in lines.

const red = { color: '#e03131' };
const green = { color: '#2f9e44' };
const outline = { kind: 'outline' as const, color: '#1f1f1f' };

const text = (over: Partial<TextItem> = {}): TextItem => ({
  kind: 'text',
  id: 't',
  x: 10,
  y: 20,
  text: 'Привет мир',
  color: '#e03131',
  size: 20,
  ...over,
});

describe('parts of a text', () => {
  it('go on in the style of the sign before the caret, at the start in the style of the first', () => {
    let runs: TextRun[] = [];
    runs = retype(runs, 'Привет', red);
    expect(runs).toEqual([{ text: 'Привет', ...red }]);
    runs = restyle(retype(runs, 'Привет мир', red), 7, 10, { ...green, look: outline });
    expect(runs).toEqual([
      { text: 'Привет ', ...red },
      { text: 'мир', ...green, look: outline },
    ]);
    // Typed at the end: green with the contour; at the start: red; in the middle of the green word: green.
    runs = retype(runs, 'Привет мир!', red);
    runs = retype(runs, '«Привет мир!', red);
    runs = retype(runs, '«Привет миир!', red);
    expect(runs).toEqual([
      { text: '«Привет ', ...red },
      { text: 'миир!', ...green, look: outline },
    ]);
    // A word typed over a selected one takes its style; cut text takes its style with it.
    runs = retype(runs, '«Привет друг!', red);
    expect(runsText(runs)).toBe('«Привет друг!');
    expect(runs[1]).toEqual({ text: 'друг!', ...green, look: outline });
    runs = retype(runs, '«Привет', red);
    expect(runs).toEqual([{ text: '«Привет', ...red }]);
  });

  it('are kept plainly when the text has one colour and look, as parts when it has more', () => {
    const plain = withRuns(text(), [{ text: 'Привет мир', ...green, look: outline }]);
    expect(plain).toEqual(text({ color: '#2f9e44', look: outline }));
    expect(runsOf(plain)).toEqual([{ text: 'Привет мир', ...green, look: outline }]);
    const mixed = withRuns(text(), restyle(runsOf(text()), 7, 10, green));
    expect(mixed.runs).toEqual([
      { text: 'Привет ', ...red },
      { text: 'мир', ...green },
    ]);
    expect(mixed.color).toBe('#e03131');
    // A colour of a look changes the looks the parts have, not their kinds.
    const looks = mapRange(
      [
        { text: 'a', ...red, look: outline },
        { text: 'b', ...red, look: { kind: 'plate', color: '#ffffff' } },
        { text: 'c', ...red },
      ],
      0,
      3,
      (r) => (r.look ? { ...r, look: { ...r.look, color: '#1c7ed6' } } : r),
    );
    expect(looks.map((r) => r.look)).toEqual([
      { kind: 'outline', color: '#1c7ed6' },
      { kind: 'plate', color: '#1c7ed6' },
      undefined,
    ]);
  });

  it('are read back from a drawing only when they make up its text', () => {
    const d = parseDrawing({
      v: 1,
      w: 100,
      h: 100,
      bg: '#ffffff',
      items: [
        {
          kind: 'text',
          id: 'a',
          x: 1,
          y: 2,
          text: 'ab',
          color: '#E03131',
          size: 30,
          font: 'hand',
          bold: true,
          look: { kind: 'outline', color: '#000000', thick: true },
          runs: [
            { text: 'a', color: '#e03131' },
            { text: 'b', color: '#2f9e44', look: { kind: 'glow', color: '#f5d000' } },
          ],
        },
        {
          kind: 'text',
          id: 'b',
          x: 1,
          y: 2,
          text: 'xy',
          color: '#e03131',
          size: 30,
          runs: [{ text: 'x', color: '#000000' }],
        },
        {
          kind: 'text',
          id: 'c',
          x: 1,
          y: 2,
          text: 'z',
          color: '#e03131',
          size: 30,
          font: 'comic',
          look: { kind: 'fire' },
        },
      ],
    })!;
    expect(d.items[0]).toEqual({
      kind: 'text',
      id: 'a',
      x: 1,
      y: 2,
      text: 'ab',
      color: '#e03131',
      size: 30,
      font: 'hand',
      bold: true,
      look: { kind: 'outline', color: '#000000', thick: true },
      runs: [
        { text: 'a', color: '#e03131' },
        { text: 'b', color: '#2f9e44', look: { kind: 'glow', color: '#f5d000' } },
      ],
    });
    expect((d.items[1] as TextItem).runs).toBeUndefined();
    expect(d.items[2]).toEqual({ kind: 'text', id: 'c', x: 1, y: 2, text: 'z', color: '#e03131', size: 30 });
  });
});

describe('lines of a text', () => {
  it('stand where the text field puts them: parts one after another, lines one under another', () => {
    const t = withRuns(text({ text: '' }), [
      { text: 'ab', ...red },
      { text: 'c\nd', ...green },
    ]);
    const l = layoutText(t);
    // About 0.58 em a sign without a canvas; lines 1.25 em apart.
    expect(l.lines.map((line) => line.segments.map((s) => [s.text, Math.round(s.x * 10) / 10]))).toEqual([
      [
        ['ab', 10],
        ['c', 33.2],
      ],
      [['d', 10]],
    ]);
    expect(l.lines.map((line) => line.top)).toEqual([20, 45]);
    expect(l.h).toBe(50);
    // A look takes room around the letters.
    expect(textBounds(t)).toEqual({ x: 10, y: 20, w: l.w, h: 50 });
    expect(
      textBounds(
        withRuns(
          t,
          runsOf(t).map((r) => ({ ...r, look: outline })),
        ),
      ).x,
    ).toBeLessThan(10);
  });

  it('get looks that stand out against their letters', () => {
    expect(defaultLook('outline', '#ffffff').color).toBe('#1f1f1f');
    expect(defaultLook('outline', '#e03131').color).toBe('#ffffff');
    expect(defaultLook('shadow', '#1f1f1f').color).toBe('#868e96');
  });
});
