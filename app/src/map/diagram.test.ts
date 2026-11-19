import { describe, expect, it } from 'vitest';
import { GraphIndex } from '../canvas/graphIndex';
import { inkHit, inkLocalPoints, inkOf, makeInk } from '../canvas/ink';
import { kindOf, portsOf } from '../canvas/kinds';
import { createNode, minSize, setRect } from '../canvas/ops';
import { emptyGraph, HEADER_H, type GraphNode } from '../canvas/model';
import { paraOffset, shapePath } from '../canvas/shapes';
import {
  addColumnAt,
  addRowAt,
  cellAt,
  chartOf,
  fitTable,
  niceTicks,
  removeColumnAt,
  removeRowAt,
  shapeKind,
  shapeOf,
  tableCells,
  tableLayout,
} from './diagram';

// 0.9: figures of flowcharts, tables, charts and pen strokes on the project map.

const table = (cells: unknown, w = 302): GraphNode => ({
  id: 't',
  kind: 'table',
  title: 'Таблица',
  x: 100,
  y: 100,
  w,
  h: 40,
  cells,
});

describe('figures', () => {
  it('are kinds of the map with words in the middle and arrows at the middles of their sides', () => {
    expect(shapeOf(shapeKind('diamond'))).toBe('diamond');
    expect(shapeOf('dialogue')).toBeNull();
    const diamond = kindOf('shape-diamond');
    expect(diamond.shape).toBe('diamond');
    expect(diamond.graphs).toEqual(['projectMap']);
    expect(diamond.menu?.group).toBe('diagram');
    // A new figure starts empty: its words are what it shows.
    const n = createNode('shape-diamond', 0, 0, '');
    expect(portsOf(n).map((p) => [p.face, p.x, p.y])).toEqual([
      ['left', 0, n.h / 2],
      ['top', n.w / 2, 0],
      ['right', n.w, n.h / 2],
      ['bottom', n.w / 2, n.h],
    ]);
    // On a parallelogram the side arrows meet its slanted sides, not its box.
    const p = createNode('shape-para', 0, 0, '');
    const ports = portsOf(p);
    expect(ports.find((x) => x.face === 'left')?.x).toBe(paraOffset(p.w, p.h) / 2);
    expect(ports.find((x) => x.face === 'right')?.x).toBe(p.w - paraOffset(p.w, p.h) / 2);
    // Figures can be made small.
    expect(minSize(n, false)).toEqual({ w: 40, h: 40 });
  });

  it('are outlined the same way up close', () => {
    expect(shapePath('diamond', 100, 60)).toBe('M50 0L100 30L50 60L0 30Z');
    expect(shapePath('para', 100, 50)).toBe('M20 0L100 0L80 50L0 50Z');
    expect(shapePath('ellipse', 100, 60)).toMatch(/^M0 30A50 30 /);
  });
});

describe('tables', () => {
  it('are made whole from what the file holds', () => {
    expect(tableCells(table(undefined))).toEqual([['']]);
    expect(tableCells(table([['a', 1], ['b'], 'x']))).toEqual([
      ['a', '1'],
      ['b', ''],
    ]);
  });

  it('are as tall as their text, rows growing with wrapped text, never shorter when made taller', () => {
    const n = table([
      ['Предмет', 'Цена'],
      ['Ключ', '5'],
    ]);
    fitTable(n, true);
    // The border, the header and two rows of one line each (18px of text, 5px above and below, a line under).
    expect(n.h).toBe(HEADER_H + 2 + 2 * 29);
    n.cells = [
      ['Предмет', 'Цена'],
      ['Очень длинное описание предмета, которое не помещается в одну строку', '5'],
    ];
    fitTable(n);
    expect(tableLayout(n, tableCells(n)).rows[1]).toBeGreaterThan(29);
    const tall = n.h + 100;
    n.h = tall;
    fitTable(n);
    expect(n.h).toBe(tall);
    // Extra height is shared by the rows.
    const layout = tableLayout(n, tableCells(n));
    expect(layout.rows.reduce((a, b) => a + b, 0) + HEADER_H + 2).toBeCloseTo(tall);
  });

  it('finds the cell under a point; rows and columns go in and out where asked', () => {
    const n = table([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    fitTable(n, true);
    expect(cellAt(n, 10, 10)).toBeNull();
    expect(cellAt(n, 10, HEADER_H + 5)).toEqual({ row: 0, col: 0 });
    expect(cellAt(n, 250, HEADER_H + 40)).toEqual({ row: 1, col: 2 });
    addRowAt(n, 1);
    expect(tableCells(n).map((r) => r[0])).toEqual(['a', '', 'd']);
    const w = n.w;
    addColumnAt(n, 0);
    expect(tableCells(n)[0]).toEqual(['', 'a', 'b', 'c']);
    // A new column makes the table wider by one, the others keep their width.
    expect(n.w).toBe(w + 100);
    removeColumnAt(n, 2);
    expect(tableCells(n)[0]).toEqual(['', 'a', 'c']);
    expect(n.w).toBe(w);
    removeRowAt(n, 0);
    expect(tableCells(n).length).toBe(2);
    // The last row and column stay.
    const one = table([['x']]);
    removeRowAt(one, 0);
    removeColumnAt(one, 0);
    expect(tableCells(one)).toEqual([['x']]);
  });

  it('keep their rows in view when resized narrower', () => {
    const g = emptyGraph('m', 'projectMap', 'Карта');
    const n = table([['Очень длинное слово и ещё несколько слов', 'b']]);
    fitTable(n, true);
    g.nodes.push(n);
    const before = n.h;
    setRect(g, 'node', 't', { x: n.x, y: n.y, w: 120, h: 40 });
    expect(g.nodes[0].h).toBeGreaterThan(before);
  });
});

describe('charts', () => {
  it('are made whole from what the file holds', () => {
    const c = chartOf({
      id: 'c',
      kind: 'chart',
      title: '',
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      chart: { type: 'donut', series: ['A', 'B'], rows: [{ label: 'x', values: [1, 'two', 3] }, null] },
    });
    expect(c.type).toBe('bar');
    expect(c.rows).toEqual([
      { label: 'x', values: [1, null] },
      { label: '', values: [null, null] },
    ]);
  });

  it('get round steps from zero', () => {
    expect(niceTicks(0, 5, 4)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(3, 97, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(-30, 20, 4)).toEqual([-40, -20, 0, 20]);
    expect(niceTicks(0, 0, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('pen strokes', () => {
  it('keep their line relative to a box around it, and stretch with the box', () => {
    const n = makeInk([100, 100, 200, 100, 200, 150], '#e03131', 4);
    expect(n.kind).toBe('ink');
    expect([n.x, n.y]).toEqual([96, 96]);
    const ink = inkOf(n)!;
    expect(ink.points).toEqual([4, 4, 104, 4, 104, 54]);
    expect(inkLocalPoints({ w: n.w * 2, h: n.h }, ink)).toEqual([8, 4, 208, 4, 208, 54]);
  });

  it('take clicks on their line only: what is inside a ring stays reachable', () => {
    const g = emptyGraph('m', 'projectMap', 'Карта');
    const card: GraphNode = { id: 'c', kind: 'node', title: '', x: 140, y: 140, w: 40, h: 40 };
    const ring = makeInk([100, 100, 220, 100, 220, 220, 100, 220, 100, 100], '#e03131', 4);
    g.nodes.push(card, ring);
    const index = new GraphIndex(g);
    expect(inkHit(ring, 160, 100, 2)).toBe(true);
    expect(inkHit(ring, 160, 160, 2)).toBe(false);
    expect(g.nodes[index.nodeAt(160, 160)].id).toBe('c');
    expect(g.nodes[index.nodeAt(160, 101)].id).toBe(ring.id);
    expect(index.nodeAt(130, 130)).toBe(-1);
  });
});
