import { describe, expect, it } from 'vitest';
import { fitBounds, lodFor, panToShow, toScreen, toWorld, zoomAt } from './camera';
import { curveDistance, edgeCurve } from './geometry';
import { GraphIndex } from './graphIndex';
import { portPosition } from './kinds';
import { emptyGraph, type GraphDoc } from './model';
import {
  alignNodes,
  connect,
  copySelection,
  createNode,
  defaultPort,
  deleteItems,
  findNodes,
  groupNodes,
  insertNodeIntoEdge,
  moveItems,
  nodeAtPort,
  pasteClipboard,
  resizeRect,
  type Selection,
} from './ops';

function sample(): GraphDoc {
  const g = emptyGraph('g1', 'story', 'Сценарий');
  const a = { ...createNode('node', 0, 0, 'Начало'), id: 'a' };
  const b = { ...createNode('node', 400, 0, 'Мельница'), id: 'b' };
  const c = { ...createNode('node', 400, 300, 'Лес'), id: 'c', text: 'Тропа уходит в шепчущий лес' };
  g.nodes.push(a, b, c);
  return g;
}

const sel = (nodes: string[] = [], edges: string[] = [], groups: string[] = []): Selection => ({
  nodes: new Set(nodes),
  edges: new Set(edges),
  groups: new Set(groups),
});

describe('graph operations', () => {
  it('connects any side and refuses duplicates, self loops and missing ports', () => {
    const g = sample();
    const edge = connect(g, { node: 'a', port: 'out' }, { node: 'b', port: 'in' });
    expect(typeof edge).toBe('object');
    expect(connect(g, { node: 'a', port: 'out' }, { node: 'b', port: 'in' })).toBe('duplicate');
    // All four side anchors are one output: pulling from the top does not make a second a→b edge.
    expect(connect(g, { node: 'a', port: 'top' }, { node: 'b', port: 'bottom' })).toBe('duplicate');
    expect(connect(g, { node: 'a', port: 'out' }, { node: 'a', port: 'in' })).toBe('same-node');
    expect(connect(g, { node: 'a', port: 'nowhere' }, { node: 'b', port: 'in' })).toBe('bad-port');
    // An edge pulled out of the left side is fine, and so is the way back.
    expect(typeof connect(g, { node: 'a', port: 'in' }, { node: 'c', port: 'top' })).toBe('object');
    expect(typeof connect(g, { node: 'b', port: 'in' }, { node: 'a', port: 'out' })).toBe('object');
    expect(g.edges).toHaveLength(3);
  });

  it('a node pulled out of a side lands on that side, its facing port on the drop point', () => {
    const left = nodeAtPort('node', { x: -100, y: 60 }, 'left', 'end', 'Слева');
    expect(left.port).toBe('out');
    expect(left.node.x + left.node.w).toBe(-100);
    const below = nodeAtPort('node', { x: 120, y: 300 }, 'bottom', 'end', 'Снизу');
    expect(below.port).toBe('top');
    expect([below.node.x + below.node.w / 2, below.node.y]).toEqual([120, 300]);
    const a = sample().nodes[0];
    expect(defaultPort(a, 'end', { x: a.x + a.w / 2, y: -500 })).toBe('top');
    expect(defaultPort(a, 'end', { x: -500, y: a.y })).toBe('in');
  });

  it('resizes from any of the eight handles, keeping the opposite side and a minimum size', () => {
    const start = { x: 0, y: 0, w: 200, h: 100 };
    const min = { w: 120, h: 60 };
    expect(resizeRect(start, 'se', 41, 19, min)).toEqual({ x: 0, y: 0, w: 240, h: 120 });
    expect(resizeRect(start, 'nw', -40, -20, min)).toEqual({ x: -40, y: -20, w: 240, h: 120 });
    expect(resizeRect(start, 'n', 0, 80, min)).toEqual({ x: 0, y: 40, w: 200, h: 60 });
    expect(resizeRect(start, 'w', 500, 0, min)).toEqual({ x: 80, y: 0, w: 120, h: 100 });
    expect(resizeRect(start, 'e', 7, 0, min, true)).toEqual({ x: 0, y: 0, w: 207, h: 100 });
  });

  it('deleting a node removes its edges and its group membership', () => {
    const g = sample();
    connect(g, { node: 'a', port: 'out' }, { node: 'b', port: 'in' });
    connect(g, { node: 'b', port: 'out' }, { node: 'c', port: 'in' });
    const group = groupNodes(g, ['b', 'c'], 'Глава')!;
    deleteItems(g, sel(['b']));
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(g.edges).toEqual([]);
    expect(g.groups.find((x) => x.id === group.id)?.members).toEqual(['c']);
  });

  it('moving a group moves its members once, even if they are selected too', () => {
    const g = sample();
    const group = groupNodes(g, ['b', 'c'], 'Глава')!;
    moveItems(g, ['b'], [group.id], 20, 40);
    expect(g.nodes.map((n) => [n.id, n.x, n.y])).toEqual([
      ['a', 0, 0],
      ['b', 420, 40],
      ['c', 420, 340],
    ]);
    expect(g.groups[0].x).toBe(group.x);
  });

  it('inserts a node into an edge, keeping the original edge id on the first half', () => {
    const g = sample();
    const edge = connect(g, { node: 'a', port: 'out' }, { node: 'b', port: 'in' });
    if (typeof edge === 'string') throw new Error(edge);
    edge.label = 'да';
    const mid = { ...createNode('node', 200, 0, 'Между'), id: 'm' };
    expect(insertNodeIntoEdge(g, edge.id, mid)).toBe(true);
    expect(g.edges.map((e) => `${e.from.node}->${e.to.node}`)).toEqual(['a->m', 'm->b']);
    expect(g.edges[0]).toMatchObject({ id: edge.id, label: 'да' });
  });

  it('copies 100 nodes with their internal edges and pastes them with new ids (FR-CNV-05)', () => {
    const g = emptyGraph('g', 'story', 'x');
    for (let i = 0; i < 100; i++) g.nodes.push({ ...createNode('node', i * 300, 0, `N${i}`), id: `n${i}` });
    for (let i = 0; i < 99; i++) connect(g, { node: `n${i}`, port: 'out' }, { node: `n${i + 1}`, port: 'in' });
    connect(g, { node: 'n99', port: 'out' }, { node: 'n0', port: 'in' });
    const outside = { ...createNode('node', 0, 900, 'outside'), id: 'out' };
    g.nodes.push(outside);
    connect(g, { node: 'n5', port: 'out' }, { node: 'out', port: 'in' });

    const clip = copySelection(g, sel(g.nodes.filter((n) => n.id !== 'out').map((n) => n.id)))!;
    expect(clip.nodes).toHaveLength(100);
    expect(clip.edges).toHaveLength(100);

    const target = emptyGraph('g2', 'chapter', 'y');
    const pasted = pasteClipboard(target, clip, { x: 1000, y: 2000 });
    expect(pasted.nodes).toHaveLength(100);
    expect(pasted.edges).toHaveLength(100);
    const ids = new Set(target.nodes.map((n) => n.id));
    const originals = new Set(g.nodes.map((n) => n.id));
    expect([...ids].some((id) => originals.has(id))).toBe(false);
    expect(ids.size).toBe(100);
    expect(target.edges.every((e) => ids.has(e.from.node) && ids.has(e.to.node))).toBe(true);
    expect(Math.min(...target.nodes.map((n) => n.x))).toBe(1000);
    expect(Math.min(...target.nodes.map((n) => n.y))).toBe(2000);
  });

  it('aligns and spreads nodes', () => {
    const g = sample();
    alignNodes(g, ['a', 'b', 'c'], 'top');
    expect(new Set(g.nodes.map((n) => n.y))).toEqual(new Set([0]));
    g.nodes[1].x = 1000;
    alignNodes(g, ['a', 'b', 'c'], 'hspread');
    const xs = g.nodes.map((n) => n.x).sort((p, q) => p - q);
    expect(xs[1] - xs[0] - 240).toBe(xs[2] - xs[1] - 240);
  });

  it('finds nodes by title, text and comment, ignoring case and ё', () => {
    const g = sample();
    g.nodes[0].comment = 'Здесь Ёжик';
    expect(findNodes(g, 'ЛЕС')).toEqual(['c']);
    expect(findNodes(g, 'шепчущий')).toEqual(['c']);
    expect(findNodes(g, 'ежик')).toEqual(['a']);
    expect(findNodes(g, '  ')).toEqual([]);
  });
});

describe('graph index', () => {
  it('finds nodes, ports and edges under the cursor', () => {
    const g = sample();
    connect(g, { node: 'a', port: 'out' }, { node: 'b', port: 'in' });
    const index = new GraphIndex(g);
    expect(g.nodes[index.nodeAt(10, 10)].id).toBe('a');
    expect(index.nodeAt(-50, -50)).toBe(-1);
    const out = portPosition(g.nodes[0], 'out')!;
    expect(index.portAt(out.x + 3, out.y - 2)).toMatchObject({ node: 'a', port: 'out', side: 'both', face: 'right' });
    const curve = index.curves[0]!;
    const mid = { x: (curve.x1 + curve.x2) / 2, y: (curve.y1 + curve.y2) / 2 };
    expect(index.edgeAt(mid.x, mid.y + 2, 6)).toBe(0);
    expect(index.edgeAt(mid.x, mid.y + 60, 6)).toBe(-1);
    expect(index.nodesInside({ minX: -10, minY: -10, maxX: 700, maxY: 200 })).toEqual([0, 1]);
  });

  it('survives an edge pointing to a missing node', () => {
    const g = sample();
    g.edges.push({ id: 'broken', from: { node: 'a', port: 'out' }, to: { node: 'ghost', port: 'in' } });
    expect(new GraphIndex(g).curves).toEqual([null]);
  });

  it('measures distance to a curve', () => {
    const c = edgeCurve({ x: 0, y: 0 }, { x: 200, y: 0 });
    expect(curveDistance(c, 100, 0)).toBeCloseTo(0, 5);
    expect(curveDistance(c, 100, 30)).toBeCloseTo(30, 0);
  });
});

describe('camera', () => {
  it('zooms to the cursor: the world point under it stays put', () => {
    const cam = { x: 100, y: 50, scale: 1 };
    const before = toWorld(cam, 400, 300);
    const zoomed = zoomAt(cam, 400, 300, 1.7);
    const after = toWorld(zoomed, 400, 300);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomAt(cam, 0, 0, 1000).scale).toBe(2.5);
  });

  it('fits bounds without blowing up a single node', () => {
    const cam = fitBounds({ minX: 0, minY: 0, maxX: 240, maxY: 120 }, 1200, 700);
    expect(cam.scale).toBe(1);
    const center = toScreen(cam, 120, 60);
    expect(center).toEqual({ x: 600, y: 350 });
  });

  it('pans just enough to show a rectangle', () => {
    const cam = panToShow({ x: 0, y: 0, scale: 1 }, { x: 1500, y: 100, w: 240, h: 120 }, 1200, 700);
    expect(cam.x).toBe(1200 - 40 - 1740);
    expect(cam.y).toBe(0);
  });

  it('switches level of detail with hysteresis', () => {
    expect(lodFor(0.6, 'mid')).toBe('mid');
    expect(lodFor(0.63, 'mid')).toBe('near');
    expect(lodFor(0.58, 'near')).toBe('near');
    expect(lodFor(0.5, 'near')).toBe('mid');
    expect(lodFor(0.1, 'near')).toBe('far');
  });
});
