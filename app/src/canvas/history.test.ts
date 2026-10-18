import { describe, expect, it } from 'vitest';
import { newProject } from '../core/project/create';
import type { ProjectData } from '../core/project/types';
import { Store } from '../core/store';
import { emptyGraph, type GraphDoc } from './model';
import {
  alignNodes,
  connect,
  createNode,
  deleteItems,
  groupNodes,
  moveItems,
  pasteClipboard,
  copySelection,
  setNodeProps,
} from './ops';

// F2-13: every canvas operation goes through the store, so 100 operations undo and redo exactly.
describe('canvas history', () => {
  it('100 operations → 100 undos → 100 redos', () => {
    const data = newProject({ name: 'P', appVersion: '0.1.0' });
    data.graphs.g = emptyGraph('g', 'story', 'S') as unknown as ProjectData['graphs'][string];
    const store = new Store<ProjectData>(data, 1000);
    const graph = () => store.getState().graphs.g as unknown as GraphDoc;
    const op = (label: string, fn: (g: GraphDoc) => unknown) =>
      store.dispatch(label, (d) => {
        fn(d.graphs.g as unknown as GraphDoc);
      });

    const snapshots: string[] = [JSON.stringify(graph())];
    for (let i = 0; i < 100; i++) {
      const g = graph();
      const ids = g.nodes.map((n) => n.id);
      switch (i % 8) {
        case 0:
        case 1:
          op('create', (d) => d.nodes.push(createNode('node', i * 40, i * 20, `N${i}`)));
          break;
        case 2:
          if (ids.length >= 2)
            op('connect', (d) => connect(d, { node: ids[0], port: 'out' }, { node: ids[ids.length - 1], port: 'in' }));
          else op('create', (d) => d.nodes.push(createNode('node', 0, 0, 'x')));
          break;
        case 3:
          op('move', (d) => moveItems(d, ids.slice(0, 3), [], 20, 40));
          break;
        case 4:
          op('rename', (d) => setNodeProps(d, ids.slice(-1), { title: `R${i}`, color: 'blue' }));
          break;
        case 5:
          op('align', (d) => alignNodes(d, ids, i % 16 < 8 ? 'top' : 'left'));
          break;
        case 6: {
          const clip = copySelection(g, { nodes: new Set(ids.slice(0, 2)), edges: new Set(), groups: new Set() });
          if (clip) op('paste', (d) => pasteClipboard(d, clip, { x: 2000 + i, y: 100 }));
          else op('create', (d) => d.nodes.push(createNode('node', 0, 0, 'y')));
          break;
        }
        default:
          if (i % 16 === 7) op('group', (d) => groupNodes(d, ids.slice(0, 2), `G${i}`));
          else
            op('delete', (d) => deleteItems(d, { nodes: new Set(ids.slice(-1)), edges: new Set(), groups: new Set() }));
      }
      snapshots.push(JSON.stringify(graph()));
    }

    for (let i = 100; i > 0; i--) {
      expect(store.undo()).toBe(true);
      expect(JSON.stringify(graph())).toBe(snapshots[i - 1]);
    }
    expect(store.canUndo).toBe(false);
    for (let i = 1; i <= 100; i++) {
      expect(store.redo()).toBe(true);
      expect(JSON.stringify(graph())).toBe(snapshots[i]);
    }
  });
});
