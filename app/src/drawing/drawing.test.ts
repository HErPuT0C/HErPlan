import { describe, expect, it } from 'vitest';
import {
  drawingOnPicture,
  emptyDrawing,
  hitsItem,
  itemAt,
  itemBounds,
  movedItem,
  parseDrawing,
  simplify,
  snapAngle,
  type Drawing,
  type StrokeItem,
} from './model';
import { crc32, drawingOf, isPng, pngSize, withDrawing } from './png';

/** A PNG of chunks only (the picture data is not a real image: nothing here decodes it). */
function png(w: number, h: number): Uint8Array {
  const parts: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (type: string, data: number[]) => {
    const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat(data));
    const len = data.length;
    const crc = crc32(body);
    parts.push((len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body);
    parts.push((crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255);
  };
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  chunk('IHDR', [...be(w), ...be(h), 8, 6, 0, 0, 0]);
  chunk('IDAT', [1, 2, 3, 4]);
  chunk('IEND', []);
  return new Uint8Array(parts);
}

const stroke = (points: number[], mode: StrokeItem['mode'] = 'pen'): StrokeItem => ({
  kind: 'stroke',
  id: `s${points.join('-')}`,
  mode,
  points,
  color: '#e03131',
  width: 4,
});

describe('drawings (0.9)', () => {
  it('a PNG carries the source of its drawing, and gives it back', () => {
    // The CRC of an empty IEND, as every PNG has it.
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    const bytes = png(320, 200);
    expect(isPng(bytes)).toBe(true);
    expect(pngSize(bytes)).toEqual({ w: 320, h: 200 });
    expect(drawingOf(bytes)).toBeNull();
    const d: Drawing = {
      ...emptyDrawing(320, 200),
      items: [
        stroke([10, 10, 50, 60]),
        { kind: 'text', id: 't', x: 5, y: 5, text: 'Привет, «мир»', color: '#1f1f1f', size: 20 },
      ],
    };
    const saved = withDrawing(bytes, d);
    expect(pngSize(saved)).toEqual({ w: 320, h: 200 });
    expect(drawingOf(saved)).toEqual(d);
    // Saved again: one source, the newest.
    const again = withDrawing(saved, { ...d, items: [] });
    expect(drawingOf(again)?.items).toEqual([]);
    expect(again.length).toBeLessThan(saved.length);
    // The chunk goes before the end of the file.
    const tail = new TextDecoder().decode(again.subarray(again.length - 8, again.length - 4));
    expect(tail).toBe('IEND');
  });

  it('what is read is checked: unknown items go, sizes and colours are kept sane', () => {
    expect(parseDrawing({ v: 2, w: 10, h: 10 })).toBeNull();
    expect(parseDrawing({ v: 1, w: 0, h: 10 })).toBeNull();
    const d = parseDrawing({
      v: 1,
      w: 99999,
      h: 50,
      bg: 'red',
      background: '../x.png',
      items: [
        { kind: 'stroke', points: [1, 2, 3] },
        { kind: 'blob' },
        { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 5, color: '#ABCDEF', width: -3, arrow: true },
        { kind: 'text', x: 1, y: 1, text: '' },
      ],
    })!;
    expect(d.w).toBe(4096);
    expect(d.bg).toBe('#ffffff');
    expect(d.background).toBeUndefined();
    expect(d.items).toHaveLength(2);
    expect(d.items[0]).toMatchObject({ kind: 'stroke', points: [1, 2], mode: 'pen' });
    expect(d.items[1]).toMatchObject({ kind: 'line', color: '#abcdef', width: 2, arrow: true });
    expect(drawingOnPicture('assets/лес.png', 8000, 4000)).toMatchObject({
      w: 4096,
      h: 2048,
      bg: '',
      background: 'assets/лес.png',
    });
  });

  it('a stroke keeps the points that make its shape', () => {
    const straight = [0, 0, 1, 0.1, 2, -0.1, 3, 0, 4, 0.05, 5, 0];
    expect(simplify(straight)).toEqual([0, 0, 5, 0]);
    const corner = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10];
    expect(simplify(corner)).toEqual([0, 0, 10, 0, 10, 10]);
    // A closed stroke ends where it began: still a ring, not a dot.
    const ring = Array.from({ length: 41 }, (_, k) => [
      Math.round(Math.cos((k / 40) * Math.PI * 2) * 100),
      Math.round(Math.sin((k / 40) * Math.PI * 2) * 100),
    ]).flat();
    const kept = simplify(ring);
    expect(kept.length / 2).toBeGreaterThan(8);
    expect(Math.max(...kept.filter((_, i) => i % 2 === 0))).toBe(100);
    expect(Math.min(...kept.filter((_, i) => i % 2 === 0))).toBe(-100);
  });

  it('things are picked where they are drawn; an eraser stroke is never picked', () => {
    const d: Drawing = {
      ...emptyDrawing(200, 200),
      items: [
        { kind: 'rect', id: 'r', x: 10, y: 10, w: 100, h: 50, color: '#1f1f1f', width: 2 },
        { kind: 'ellipse', id: 'e', x: 120, y: 120, w: -60, h: -40, color: '#1f1f1f', width: 2, fill: true },
        stroke([0, 150, 50, 150]),
        stroke([0, 100, 200, 100], 'erase'),
      ],
    };
    expect(itemAt(d, 10, 30)?.id).toBe('r');
    // The inside of an outlined box is empty; a filled oval is picked inside.
    expect(itemAt(d, 60, 35)).toBeNull();
    expect(itemAt(d, 90, 100)?.id).toBe('e');
    expect(itemAt(d, 25, 151)?.id).toBe(stroke([0, 150, 50, 150]).id);
    expect(itemAt(d, 150, 100)).toBeNull();
    expect(hitsItem({ kind: 'text', id: 't', x: 0, y: 0, text: 'abc', color: '#000000', size: 20 }, 30, 10)).toBe(true);
    // Moving makes a new item; the bounds take the width in.
    const moved = movedItem(d.items[2], 10, -5);
    expect(moved).toMatchObject({ points: [10, 145, 60, 145] });
    expect(itemBounds(d.items[0])).toEqual({ x: 9, y: 9, w: 102, h: 52 });
    expect(snapAngle(0, 0, 10, 1)).toEqual({ x: expect.closeTo(10.05, 1), y: expect.closeTo(0, 5) });
  });
});
