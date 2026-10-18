import { describe, expect, it } from 'vitest';
import { Store } from './store';

interface State {
  entities: Record<string, { name: string; trust: number }>;
  order: string[];
}

const initial = (): State => ({ entities: { a: { name: 'Мира', trust: 3 } }, order: ['a'] });

describe('Store', () => {
  it('100 random operations → 100 undos → 100 redos restores both ends exactly', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const store = new Store<State>(initial());
    const start = structuredClone(store.getState());
    for (let i = 0; i < 100; i++) {
      const op = Math.floor(rnd() * 4);
      store.dispatch(`op ${i}`, (d) => {
        const ids = Object.keys(d.entities);
        const id = ids[Math.floor(rnd() * ids.length)];
        if (op === 0) {
          const nid = `n${i}`;
          d.entities[nid] = { name: `Сущность ${i}`, trust: i };
          d.order.push(nid);
        } else if (op === 1 && id) d.entities[id].trust += 1;
        else if (op === 2 && id) d.entities[id].name += '!';
        else if (op === 3 && ids.length > 1) {
          delete d.entities[id];
          d.order.splice(d.order.indexOf(id), 1);
        } else d.order.reverse();
      });
    }
    const end = structuredClone(store.getState());
    let undone = 0;
    while (store.undo()) undone++;
    expect(store.getState()).toEqual(start);
    while (store.redo()) undone--;
    expect(undone).toBe(0);
    expect(store.getState()).toEqual(end);
  });

  it('merges rapid edits with the same key into one undo step', () => {
    let t = 0;
    const store = new Store<State>(initial(), 500, () => t);
    for (const ch of ' Ивановна') {
      t += 100;
      store.dispatch('Имя', (d) => void (d.entities.a.name += ch), { mergeKey: 'name:a' });
    }
    t += 5000;
    store.dispatch('Имя', (d) => void (d.entities.a.name += '!'), { mergeKey: 'name:a' });
    expect(store.getState().entities.a.name).toBe('Мира Ивановна!');
    store.undo();
    expect(store.getState().entities.a.name).toBe('Мира Ивановна');
    store.undo();
    expect(store.getState().entities.a.name).toBe('Мира');
    expect(store.canUndo).toBe(false);
  });

  it('transactions are one undo step and roll back on error', () => {
    const store = new Store<State>(initial());
    store.transact('Создать и связать', () => {
      store.dispatch('a', (d) => void (d.entities.b = { name: 'Борис', trust: 1 }));
      store.dispatch('b', (d) => void d.order.push('b'));
    });
    expect(store.undoLabel).toBe('Создать и связать');
    store.undo();
    expect(store.getState()).toEqual(initial());

    expect(() =>
      store.transact('Сломанное', () => {
        store.dispatch('x', (d) => void (d.entities.a.trust = 99));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.getState().entities.a.trust).toBe(3);
  });

  it('reports changed paths and clears redo after a new change', () => {
    const store = new Store<State>(initial());
    const paths: string[] = [];
    store.onChange((e) => paths.push(...e.patches.map((p) => `${e.source}:${p.path.join('/')}`)));
    store.dispatch('trust', (d) => void (d.entities.a.trust = 4));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch('name', (d) => void (d.entities.a.name = 'М.'));
    expect(store.canRedo).toBe(false);
    expect(paths).toEqual(['do:entities/a/trust', 'undo:entities/a/trust', 'do:entities/a/name']);
  });

  it('ignores recipes that change nothing', () => {
    const store = new Store<State>(initial());
    store.dispatch('noop', () => {});
    expect(store.canUndo).toBe(false);
  });
});
